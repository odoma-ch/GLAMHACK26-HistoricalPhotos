/* PhotoMap: map of historical photos (MapLibre GL JS).
 *
 *   PhotoMap.mount(element, { data: <GeoJSON FeatureCollection> })
 *
 * Needs `maplibregl` (global) and photomap.css. The only global it adds is `PhotoMap`.
 * Each feature is expected to carry the properties written by convertir_donnees.py
 * (inv, titre, description, annee, date_texte, type_lieu, lieu_represente, ...).
 * Those data keys are French on purpose: renaming them means regenerating data_photos.js.
 */
(function (global) {
    'use strict';

    var DEFAULTS = {
        title: 'Historical photos',
        subtitle: '',
        styleUrl: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json',
        bounds: [[5.95, 45.8], [10.5, 47.82]],           // [south-west, north-east] as [lon, lat]
        // one accent colour for circles and rings; the place type (`type_lieu`) is shown by the ring style:
        // prise_de_vue = where the photo was taken (dashed ring),
        // represente = place shown in the photo, shooting place unknown (solid ring)
        color: '#89CFF0',
        links: {
            // Memobase only exists in fr/de/it (the /en/ path returns 404)
            page: function (inv) { return 'https://memobase.ch/fr/object/' + memobaseId(inv); },
            // direct IIIF image, 600 px wide
            image: function (inv) { return 'https://media.memobase.ch/memo/' + memobaseId(inv) + '-1/iiif/full/600,/0/default.jpg'; },
            // small preview shown on the map when zoomed in, 120 px wide
            thumb: function (inv) { return 'https://media.memobase.ch/memo/' + memobaseId(inv) + '-1/iiif/full/120,/0/default.jpg'; },
            // picture on a gallery card, 240 px wide (sharp on high-density screens)
            card: function (inv) { return 'https://media.memobase.ch/memo/' + memobaseId(inv) + '-1/iiif/full/240,/0/default.jpg'; }
        },
        // font for the numbers in the cluster circles; the left (historical) map needs the glyph URL too
        font: ['Frutiger Neue Condensed Bold'],
        glyphs: 'https://vectortiles.geo.admin.ch/fonts/{fontstack}/{range}.pbf',
        credit: '',   // optional extra text in front of the swisstopo credit
        // swisstopo geodata is open government data (OGD): free to use, source reference mandatory
        ogdUrl: 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
        // swisstopo "Journey through time – Topographic maps" (WMTS, Web Mercator): one map per year, 1844-2021.
        // `tiles(year)` returns a MapLibre tile URL template; replace it to use another historical map service.
        timeTravel: {
            minYear: 1844,
            maxYear: 2021,
            leftYear: 1914,
            tiles: function (year) {
                return 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.zeitreihen/default/' + year + '1231/3857/{z}/{x}/{y}.png';
            }
        }
    };

    // canton codes (`canton` property, added by add_cantons.py) -> names shown in the gallery
    var CANTON_NAMES = {
        AG: 'Aargau', AI: 'Appenzell Innerrhoden', AR: 'Appenzell Ausserrhoden', BE: 'Bern', BL: 'Basel-Landschaft',
        BS: 'Basel-Stadt', FR: 'Fribourg', GE: 'Geneva', GL: 'Glarus', GR: 'Grisons', JU: 'Jura', LU: 'Lucerne',
        NE: 'Neuchâtel', NW: 'Nidwalden', OW: 'Obwalden', SG: 'St. Gallen', SH: 'Schaffhausen', SO: 'Solothurn',
        SZ: 'Schwyz', TG: 'Thurgau', TI: 'Ticino', UR: 'Uri', VD: 'Vaud', VS: 'Valais', ZG: 'Zug', ZH: 'Zurich'
    };

    // Memobase id = "blt-001-" + inventory number padded to 9 digits
    function memobaseId(inv) { return 'blt-001-' + String(inv).padStart(9, '0'); }

    // data comes from external files: escape everything that goes into HTML
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function stepperHtml(label) {
        return '<span class="pm-step-label">' + label + '</span>' +
            '<div class="pm-step-box">' +
              '<button type="button" class="pm-prev" aria-label="Previous year">◀</button>' +
              '<select class="pm-step-select" aria-label="' + label + ' year"></select>' +
              '<button type="button" class="pm-next" aria-label="Next year">▶</button>' +
            '</div>';
    }

    function mergeOptions(opts) {
        var o = Object.assign({}, DEFAULTS, opts);
        o.links = Object.assign({}, DEFAULTS.links, opts.links);
        o.timeTravel = Object.assign({}, DEFAULTS.timeTravel, opts.timeTravel);
        return o;
    }

    function mount(container, options) {
        if (!options || !options.data) throw new Error('PhotoMap.mount: missing "data" option');
        var o = mergeOptions(options);
        var tt = o.timeTravel;

        // only geolocated photos go on the map
        var photos = o.data.features.filter(function (f) { return f.geometry != null; });
        // MapLibre turns nested properties into strings: look the original up by `inv` instead
        var byInv = new Map(photos.map(function (f) { return [f.properties.inv, f.properties]; }));
        var years = photos.map(function (f) { return f.properties.annee; }).filter(function (y) { return y != null; });
        var YEAR_MIN = Math.min.apply(null, years);
        var YEAR_MAX = Math.max.apply(null, years);
        // themes (`themes` list, English labels): most common first, "uncategorised" last
        var themeCount = {};
        photos.forEach(function (f) { (f.properties.themes || []).forEach(function (t) { themeCount[t] = (themeCount[t] || 0) + 1; }); });
        var THEMES = Object.keys(themeCount).sort(function (a, b) {
            return (a === 'uncategorised') - (b === 'uncategorised') || themeCount[b] - themeCount[a];
        });

        container.innerHTML =
            '<div class="pm-root">' +
              '<div class="pm-map-hist"></div>' +
              '<div class="pm-map"></div>' +
              '<div class="pm-divider" role="slider" tabindex="0" aria-label="Compare maps: drag to move the divider" aria-valuemin="0" aria-valuemax="100">' +
                '<span class="pm-handle">◀ ▶</span>' +
              '</div>' +
              '<div class="pm-gallery">' +
                '<div class="pm-gcanvas" aria-label="Photos grouped by canton or decade"></div>' +
                '<button type="button" class="pm-gback">← All</button>' +
                '<div class="pm-arrange" role="group" aria-label="Arrange photos">' +
                  '<button type="button" data-arrange="free" aria-pressed="true">Free</button>' +
                  '<button type="button" data-arrange="decade" aria-pressed="false">By decade</button>' +
                  '<button type="button" data-arrange="canton" aria-pressed="false">By canton</button>' +
                  '<button type="button" data-arrange="theme" aria-pressed="false">By theme</button>' +
                '</div>' +
              '</div>' +
              '<div class="pm-modes" role="tablist">' +
                '<button type="button" role="tab" class="pm-active" data-mode="map" aria-selected="true">Map</button>' +
                '<button type="button" role="tab" data-mode="compare" aria-selected="false">Swipe</button>' +
                '<button type="button" role="tab" data-mode="gallery" aria-selected="false">Gallery</button>' +
              '</div>' +
              '<div class="pm-top">' +
                '<div class="pm-title">' + esc(o.title) + '</div>' +
                (o.subtitle ? '<div class="pm-subtitle">' + esc(o.subtitle) + '</div>' : '') +
                // one chip row: theme tabs, then the undated toggle
                '<div class="pm-filters">' +
                  (THEMES.length ? '<div class="pm-themes" role="tablist" aria-label="Filter by theme"></div>' : '') +
                  '<label class="pm-pill"><input type="checkbox" class="pm-undated" checked> Undated photos</label>' +
                '</div>' +
                '<div class="pm-step pm-step-left">' + stepperHtml('Left · map of') + '</div>' +
              '</div>' +
              '<div class="pm-legend">' +
                '<button type="button" class="pm-legend-item" data-type="prise_de_vue" aria-pressed="true"><span class="pm-dot pm-dot-taken"></span>Place where the photo was taken</button>' +
                '<button type="button" class="pm-legend-item" data-type="represente" aria-pressed="true"><span class="pm-dot"></span>Place shown (shooting place unknown)</button>' +
              '</div>' +
              '<div class="pm-step pm-step-right">' + stepperHtml('Right · map of') + '</div>' +
              '<div class="pm-timeline">' +
                '<span class="pm-year pm-year-start"></span>' +
                '<div class="pm-double">' +
                  '<input type="range" step="1" class="pm-slider-start" aria-label="Start year">' +
                  '<input type="range" step="1" class="pm-slider-end" aria-label="End year">' +
                '</div>' +
                '<span class="pm-year pm-year-end"></span>' +
              '</div>' +
              '<aside class="pm-panel"><button class="pm-close" type="button" aria-label="Close">×</button><div class="pm-info"></div></aside>' +
              // one credit line for both the vector basemap and the Journey through time maps
              '<div class="pm-credit">' + (o.credit ? esc(o.credit) + ' · ' : '') +
                'Maps: © swisstopo, <a href="' + esc(o.ogdUrl) + '" target="_blank" rel="noopener">free geodata (OGD)</a></div>' +
            '</div>';

        var $ = function (sel) { return container.querySelector(sel); };
        var root = $('.pm-root');
        root.style.setProperty('--pm-accent', o.color);   // rings and legend swatches follow the `color` option
        var sliderStart = $('.pm-slider-start'), sliderEnd = $('.pm-slider-end');
        var undatedBox = $('.pm-undated');
        // theme filter: one tab per theme (+ "All"); several can be on, `themeSel` empty = all
        var THEME_ICONS = {   // 24x24 stroke paths; unknown themes fall back to a dot
            'Church or chapel': 'M12 2v5M9.5 4.5h5M5 21V12l7-5 7 5v9M10 21v-5h4v5',
            'Other building': 'M4 21V4h10v17M14 9h6v12M8 8h2M8 12h2M8 16h2M2 21h20',
            'Survey signal or marker': 'M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 9.5v3',
            'School': 'M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5',
            'Fieldwork and instruments': 'M12 3v8M8.5 5h7M12 11l-6 10M12 11l6 10M12 11v10',
            'Summit and terrain': 'M2 20l7-13 4 7 3-4 6 10z',
            'People': 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .8 3.5 2.7 3.5 5.5',
            'Castle or ruin': 'M4 21V7h3v3h3V7h4v3h3V7h3v14zM10 21v-5h4v5',
            'uncategorised': 'M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 18h.01'
        };
        var themeSel = new Set();
        var themeBox = $('.pm-themes');
        if (themeBox) {
            var tab = function (key, label, n, icon) {
                return '<button type="button" role="tab" class="pm-themetab" data-theme="' + esc(key) + '" title="' + esc(label) + '">' +
                    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + icon + '"/></svg>' +
                    '<span>' + esc(label) + '</span><span class="pm-themen">' + n + '</span></button>';
            };
            themeBox.innerHTML = tab('', 'All', photos.length, 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z') +
                THEMES.map(function (t) { return tab(t, t, themeCount[t], THEME_ICONS[t] || 'M12 12h.01'); }).join('');
            themeBox.addEventListener('click', function (e) {
                var btn = e.target.closest('.pm-themetab');
                if (!btn) return;
                var t = btn.dataset.theme;
                if (t) { if (!themeSel.delete(t)) themeSel.add(t); }
                else if (themeSel.size) themeSel.clear();   // "All" resets the selection...
                else {                                       // ...and with nothing selected it folds / unfolds the list
                    btn.setAttribute('aria-expanded', !themeBox.classList.toggle('pm-themes-closed'));
                    return;
                }
                Array.from(themeBox.children).forEach(function (b) {
                    b.setAttribute('aria-selected', b.dataset.theme ? themeSel.has(b.dataset.theme) : !themeSel.size);
                });
                filterDates();
            });
            themeBox.firstChild.setAttribute('aria-selected', 'true');
            themeBox.firstChild.setAttribute('aria-expanded', 'true');
        }
        // legend entries double as a filter on type_lieu (a type switched off is hidden)
        var typeOff = new Set();
        container.querySelector('.pm-legend').addEventListener('click', function (e) {
            var btn = e.target.closest('.pm-legend-item');
            if (!btn) return;
            var t = btn.dataset.type;
            if (!typeOff.delete(t)) typeOff.add(t);
            btn.setAttribute('aria-pressed', !typeOff.has(t));
            filterDates();
        });
        function activeThemes() { return new Set(themeSel.size ? themeSel : THEMES); }
        function themesOf(p) { return p.themes && p.themes.length ? p.themes : ['uncategorised']; }
        var panel = $('.pm-panel'), info = $('.pm-info');

        // ---------- map ----------
        var b = o.bounds;
        var map = new maplibregl.Map({
            container: $('.pm-map'),
            style: o.styleUrl,
            bounds: b,
            fitBoundsOptions: { padding: 20 },
            // wide margin: a tall screen (phone) needs a lot of room north/south to frame all of Switzerland
            maxBounds: [[b[0][0] - 3, b[0][1] - 3], [b[1][0] + 3, b[1][1] + 3]],
            minZoom: 5,
            maxZoom: 18,
            attributionControl: false
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

        var ready = false;
        var selected = null;  // inv of the photo open in the panel
        var stack = null;     // inv list of the photos stacked on the clicked spot
        var visible = null;   // inv list that passes the current filter (null until the first filter run)

        // swipe mode: `map` is the right side, `histMap` (created on first use) the left side
        var mode = 'map';
        var histMap = null, histReady = false;
        var leftYear = clampYear(tt.leftYear), rightYear = null; // rightYear null = today's map
        var syncing = false;

        function clampYear(y) { return Math.min(tt.maxYear, Math.max(tt.minYear, y)); }
        // maps that currently have the photo layers
        function liveMaps() { return [ready && map, histReady && histMap].filter(Boolean); }

        // ---------- basemap look ----------
        // Turn the swisstopo basemap into a pale, near-monochrome grey backdrop (faint relief, thin borders,
        // no roads, small labels) so the accent-coloured photo markers are the only saturated colour.
        // Works on the swisstopo layer names; layers another style does not have are simply not touched.
        var PAPER = '#f3f3f2', WATER = '#e1e3e4', BORDER = '#a3a3a3', LABEL = '#5f5f5f';
        var HIDE_LAYERS = /scree|contour|pattern|hillshade_yellow|hazard|hachure|park|landcover|landuse|aeroway|construct|building_ln|poi_|peaks|spot_elevation|aerodrome|area_name|road_number|transportation_label/;
        function stylizeBasemap(m) {
            m.getStyle().layers.forEach(function (l) {
                var id = l.id, set = function (prop, val) { m.setPaintProperty(id, prop, val); };
                if (l.type === 'background') set('background-color', PAPER);
                else if (l['source-layer'] === 'transportation' || HIDE_LAYERS.test(id)) m.setLayoutProperty(id, 'visibility', 'none');
                else if (id === 'hillshade_grey') {   // faint relief: light grey shadows only
                    set('fill-color', '#7d7d7d');
                    set('fill-opacity', ['interpolate', ['linear'], ['get', 'luminosity'], -15, 0.13, -1, 0.01]);
                } else if (l.type === 'symbol') {
                    if (!l.paint || l.paint['text-color'] === undefined) return;
                    set('text-color', /water/.test(id) ? '#8a9094' : LABEL);
                    set('text-halo-color', 'rgba(243,243,242,0.9)');
                    set('text-halo-width', 1.5);
                    set('text-halo-blur', 0.5);
                    if (l.layout && l.layout['icon-image'] !== undefined) set('icon-opacity', 0);   // no town dots
                    if (/^place_/.test(id)) m.setLayoutProperty(id, 'text-size', id === 'place_city'
                        ? ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 14]
                        : ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 12]);
                } else if (/boundary/.test(id)) {
                    set('line-color', BORDER);
                    set('line-blur', 0);
                    set('line-width', ['match', ['get', 'admin_level'], 2, 1.2, 0.6]);
                } else if (/^water/.test(id)) set(l.type === 'fill' ? 'fill-color' : 'line-color', WATER);
                else if (l.type === 'fill') set('fill-color', '#e6e6e5');     // buildings
                else if (l.type === 'line') set('line-color', '#dadada');    // building outlines and the like
            });
        }

        // ---------- clustering ----------
        // Photos that are close on screen merge into a numbered circle (size grows with the count).
        // A photo that is alone shows a small preview picture instead of a dot.
        // Clustering goes all the way to MAX_ZOOM, so photos on the very same coordinate stay merged
        // (clicking that circle opens the pick-list).
        var MAX_ZOOM = 18;
        var isPoint = ['!', ['has', 'point_count']];
        var thumbSets = [];   // one preview-marker manager per map

        // the source holds only the photos that pass the filter, so cluster counts stay right
        function visibleFeatures() {
            if (!visible) return photos;
            var set = new Set(visible);
            return photos.filter(function (f) { return set.has(f.properties.inv); });
        }
        function setPhotoData(m) {
            m.getSource('pm-photos').setData({ type: 'FeatureCollection', features: visibleFeatures() });
        }

        function addPhotoLayers(m) {
            m.addSource('pm-photos', {
                type: 'geojson', data: { type: 'FeatureCollection', features: visibleFeatures() },
                cluster: true, clusterRadius: 50, clusterMaxZoom: MAX_ZOOM, maxzoom: MAX_ZOOM + 1
            });
            m.addLayer({   // soft halo under the number circles
                id: 'pm-cluster-halo', type: 'circle', source: 'pm-photos',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': '#000',
                    'circle-opacity': 0.14,
                    'circle-blur': 0.7,
                    'circle-radius': ['+', 22, ['*', 3, ['sqrt', ['get', 'point_count']]]]
                }
            });
            m.addLayer({   // soft accent glow around every circle
                id: 'pm-cluster-glow', type: 'circle', source: 'pm-photos',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': o.color,
                    'circle-opacity': 0.4,
                    'circle-blur': 0.9,
                    'circle-radius': ['+', 26, ['*', 4, ['sqrt', ['get', 'point_count']]]]
                }
            });
            m.addLayer({
                id: 'pm-clusters', type: 'circle', source: 'pm-photos',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': o.color,
                    'circle-opacity': 0.72,
                    'circle-blur': 0.45,   // soft edge that melts into the glow
                    'circle-radius': ['+', 12, ['*', 3, ['sqrt', ['get', 'point_count']]]]
                }
            });
            m.addLayer({
                id: 'pm-cluster-count', type: 'symbol', source: 'pm-photos',
                filter: ['has', 'point_count'],
                layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': o.font, 'text-size': 14, 'text-allow-overlap': true },
                paint: { 'text-color': '#0d2b3e' }
            });
            m.on('mouseenter', 'pm-clusters', function () { m.getCanvas().style.cursor = 'pointer'; });
            m.on('mouseleave', 'pm-clusters', function () { m.getCanvas().style.cursor = ''; });
            m.on('click', function (e) { // single photos are DOM markers with their own click handler
                var hit = m.queryRenderedFeatures(e.point, { layers: ['pm-clusters'] })[0];
                if (hit) openCluster(m, hit); else closePanel();
            });
            thumbSets.push(createThumbs(m));
        }

        // click on a circle: zoom in until it splits; if it never does (same spot), list its photos
        function openCluster(m, f) {
            var src = m.getSource('pm-photos'), id = f.properties.cluster_id;
            src.getClusterExpansionZoom(id).then(function (z) {
                if (z <= MAX_ZOOM) return m.easeTo({ center: f.geometry.coordinates, zoom: z });
                return src.getClusterLeaves(id, 100, 0).then(function (leaves) {
                    stack = leaves.map(function (l) { return l.properties.inv; });
                    selected = null;
                    showStack();
                });
            });
        }

        // small preview pictures (DOM markers) for the photos that are not part of a cluster
        function createThumbs(m) {
            var markers = new Map(); // inv -> { marker, el }
            function update() {
                var seen = new Set();
                m.querySourceFeatures('pm-photos', { filter: isPoint }).forEach(function (f) {
                    var inv = f.properties.inv;
                    if (seen.has(inv)) return; // same feature can come from several tiles
                    seen.add(inv);
                    if (markers.has(inv)) return;
                    var el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'pm-thumb';
                    el.setAttribute('aria-label', 'Photo ' + inv);
                    if (f.properties.type_lieu === 'prise_de_vue') el.classList.add('pm-thumb-taken');
                    var img = new Image();
                    img.alt = '';
                    img.onerror = function () { el.classList.add('pm-thumb-none'); }; // no picture: plain dot
                    img.src = o.links.thumb(inv);
                    el.appendChild(img);
                    el.addEventListener('click', function (e) { e.stopPropagation(); stack = null; openPhoto(inv); });
                    markers.set(inv, { el: el, marker: new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(m) });
                });
                markers.forEach(function (x, inv) { if (!seen.has(inv)) { x.marker.remove(); markers.delete(inv); } });
                mark();
            }
            function mark() {
                markers.forEach(function (x, inv) { x.el.classList.toggle('pm-thumb-sel', inv === selected); });
            }
            m.on('moveend', update);
            m.on('sourcedata', function (e) { if (e.sourceId === 'pm-photos' && e.isSourceLoaded) update(); });
            return { mark: mark };
        }

        map.on('load', function () {
            // historical map overlay for the right side of the swipe (hidden while it shows today's map)
            map.addSource('pm-tt', { type: 'raster', tiles: [tt.tiles(tt.maxYear)], tileSize: 256, maxzoom: 18 });
            map.addLayer({ id: 'pm-tt', type: 'raster', source: 'pm-tt', layout: { visibility: 'none' } });
            try { stylizeBasemap(map); } catch (err) { /* another basemap style: keep it as it is */ }
            addPhotoLayers(map);
            root.classList.add('pm-ready');   // fades the map in
            ready = true;
            filterDates();
            // intro: start a little further out and glide in (skipped for reduced motion)
            if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                var z = map.getZoom();
                map.jumpTo({ zoom: z - 1 });
                map.easeTo({ zoom: z, duration: 2200, easing: function (t) { return 1 - Math.pow(1 - t, 3); } });
            }
        });

        // ---------- swipe mode (two synced maps, the top one clipped at the divider) ----------
        function createHistMap() {
            histMap = new maplibregl.Map({
                container: $('.pm-map-hist'),
                style: {
                    version: 8,
                    glyphs: o.glyphs,
                    sources: { 'pm-tt': { type: 'raster', tiles: [tt.tiles(leftYear)], tileSize: 256, maxzoom: 18 } },
                    layers: [
                        { id: 'bg', type: 'background', paint: { 'background-color': '#e3e3e3' } },
                        { id: 'pm-tt', type: 'raster', source: 'pm-tt' }
                    ]
                },
                center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
                maxBounds: map.getMaxBounds(), minZoom: 5, maxZoom: 18,
                attributionControl: false
            });
            histMap.on('load', function () {
                addPhotoLayers(histMap);
                histReady = true;
            });
            link(map, histMap);
            link(histMap, map);
        }

        // copy the camera of one map to the other (the flag stops the echo)
        function link(from, to) {
            from.on('move', function () {
                if (syncing) return;
                syncing = true;
                to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
                syncing = false;
            });
        }

        // swipe mode starts the year slider on the decade of the left map (still adjustable)
        var mapRange = null; // slider range to restore when leaving swipe mode
        function presetDecade() {
            var d0 = Math.floor(leftYear / 10) * 10, d1 = d0 + 9;
            if (d1 < YEAR_MIN || d0 > YEAR_MAX) return; // no photos in that decade: leave the slider alone
            sliderStart.value = Math.max(YEAR_MIN, d0);
            sliderEnd.value = Math.min(YEAR_MAX, d1);
        }

        function setMode(m) {
            // the swipe preset changes the year slider: put it back only when leaving swipe mode
            if (m === 'compare') { mapRange = [sliderStart.value, sliderEnd.value]; presetDecade(); }
            else if (mode === 'compare' && mapRange) { sliderStart.value = mapRange[0]; sliderEnd.value = mapRange[1]; mapRange = null; }
            mode = m;
            root.classList.toggle('pm-compare', m === 'compare');
            root.classList.toggle('pm-gallery-on', m === 'gallery');
            container.querySelectorAll('.pm-modes button').forEach(function (b) {
                var on = b.dataset.mode === m;
                b.classList.toggle('pm-active', on);
                b.setAttribute('aria-selected', on);
            });
            closePanel();
            if (m === 'compare') {
                if (!histMap) createHistMap();
                else histMap.resize();
            }
            map.resize();
            filterDates();   // also lays out the gallery
            alignSteppers();
        }

        container.querySelector('.pm-modes').addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (b && b.dataset.mode !== mode) setMode(b.dataset.mode);
        });

        // year pickers: left = historical map, right = historical map or "Today"
        function fillSelect(sel, withToday, value) {
            var html = '';
            for (var y = tt.minYear; y <= tt.maxYear; y++) html += '<option value="' + y + '">' + y + '</option>';
            if (withToday) html += '<option value="today">Today</option>';
            sel.innerHTML = html;
            sel.value = value;
        }
        function bindStepper(box, onChange) {
            var sel = box.querySelector('select');
            sel.addEventListener('change', function () { onChange(sel.value); });
            box.addEventListener('click', function (e) {
                var b = e.target.closest('button');
                if (!b) return;
                var i = sel.selectedIndex + (b.classList.contains('pm-next') ? 1 : -1);
                if (i >= 0 && i < sel.options.length) { sel.selectedIndex = i; onChange(sel.value); }
            });
        }
        fillSelect($('.pm-step-left select'), false, leftYear);
        fillSelect($('.pm-step-right select'), true, 'today');
        bindStepper($('.pm-step-left'), function (v) {
            leftYear = +v;
            if (histMap) histMap.getSource('pm-tt').setTiles([tt.tiles(leftYear)]);
            presetDecade();
            filterDates(); // the slider follows the left map's decade
        });
        bindStepper($('.pm-step-right'), function (v) {
            rightYear = v === 'today' ? null : +v;
            if (rightYear != null) map.getSource('pm-tt').setTiles([tt.tiles(rightYear)]);
            map.setLayoutProperty('pm-tt', 'visibility', rightYear != null ? 'visible' : 'none');
        });

        // the left picker flows under the title, so its height varies: put the right picker on the same row
        var stepLeft = $('.pm-step-left'), stepRight = $('.pm-step-right');
        function alignSteppers() {
            if (mode !== 'compare') return;
            stepRight.style.top = (stepLeft.getBoundingClientRect().top - root.getBoundingClientRect().top) + 'px';
        }
        if (global.ResizeObserver) {
            var ro = new ResizeObserver(alignSteppers);
            ro.observe($('.pm-top'));
            ro.observe(root);
        }

        // divider: drag, or arrow keys when focused
        var divider = $('.pm-divider');
        function setSplit(f) {
            f = Math.min(0.95, Math.max(0.05, f));
            root.style.setProperty('--pm-split', (f * 100) + '%');
            divider.setAttribute('aria-valuenow', Math.round(f * 100));
        }
        setSplit(0.5);
        divider.addEventListener('pointerdown', function (e) {
            divider.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        divider.addEventListener('pointermove', function (e) {
            if (!divider.hasPointerCapture(e.pointerId)) return;
            var r = root.getBoundingClientRect();
            setSplit((e.clientX - r.left) / r.width);
        });
        divider.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            setSplit(+divider.getAttribute('aria-valuenow') / 100 + (e.key === 'ArrowLeft' ? -0.03 : 0.03));
            e.preventDefault();
        });


        // ---------- gallery mode ----------
        // Photo cards float on a plain canvas and can be arranged freely, by decade, or by canton
        // (cantons sit where they are on the map). Cards follow the same date filter as the map.
        var gal = { arrange: 'free', cards: null, failed: new Set(), focus: null };   // focus = key of the group shown full size
        var gcanvas = $('.pm-gcanvas');
        var SPREAD = 0.2;      // how far cards fan out from the middle of a group (smaller = tighter stack)
        var GOLDEN = 2.39996;   // golden angle: cards spiral out from the centre of a group

        function galleryBuild() {
            gal.cards = new Map();
            photos.forEach(function (f) {
                var inv = f.properties.inv;
                var el = document.createElement('button');
                el.type = 'button';
                el.className = 'pm-card';
                el.setAttribute('aria-label', f.properties.titre ?? 'Photo ' + inv);
                var img = new Image();
                img.alt = '';
                img.draggable = false;
                // no picture on Memobase for this one: drop the card instead of showing an empty frame
                img.onerror = function () { gal.failed.add(inv); el.classList.add('pm-card-off'); galleryLayout(); };
                img.src = o.links.card(inv);
                el.appendChild(img);
                el.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // in a grouped view the first click on a pile opens that group; the next ones open photos
                    if (gal.arrange !== 'free' && gal.focus == null) return focusGroup(groupOf(f.properties));
                    stack = null; openPhoto(inv);
                });
                gcanvas.appendChild(el);
                gal.cards.set(inv, el);
            });
        }

        // group key + label for one photo, by arrangement
        function groupOf(p) {
            if (gal.arrange === 'decade') return p.annee == null ? 'Undated' : Math.floor(p.annee / 10) * 10;
            if (gal.arrange === 'canton') return p.canton ?? 'Elsewhere';
            // theme: a photo can have several, a card only sits in one pile (the filtered theme, else its first)
            if (gal.arrange === 'theme') {
                var on = activeThemes(), ts = themesOf(p);
                return ts.filter(function (t) { return on.has(t); })[0] ?? ts[0];
            }
            return 'all';
        }
        function groupLabel(key) {
            if (gal.arrange === 'theme') return key;
            if (gal.arrange === 'decade') return key === 'Undated' ? 'Undated' : key + 's';
            return key === 'Elsewhere' ? 'Border / abroad' : (CANTON_NAMES[key] || key);
        }

        // centre of every group, as pixels inside the box `a` = {x, y, w, h}; `cell` = room per group (decade grid only)
        var cell = null;
        function groupCenters(keys, members, a) {
            var centers = new Map();
            cell = null;
            if (gal.arrange !== 'canton') {   // decade and theme: a plain grid
                var cols = a.w < 600 ? 3 : Math.min(keys.length, 5), rows = Math.ceil(keys.length / cols);
                keys.forEach(function (k, i) {
                    centers.set(k, { x: a.x + a.w * ((i % cols) + 0.5) / cols, y: a.y + a.h * (Math.floor(i / cols) + 0.5) / rows });
                });
                cell = { w: a.w / cols, h: a.h / rows };
                return centers;
            }
            // canton: mean position of its photos, scaled to the map bounds (same aspect as the map)
            var b = o.bounds, cosLat = Math.cos((b[0][1] + b[1][1]) / 2 * Math.PI / 180);
            var spanX = (b[1][0] - b[0][0]) * cosLat, spanY = b[1][1] - b[0][1];
            var k = Math.min(a.w / spanX, a.h / spanY);
            keys.forEach(function (key) {
                var m = members.get(key), lon = 0, lat = 0;
                m.forEach(function (f) { lon += f.geometry.coordinates[0]; lat += f.geometry.coordinates[1]; });
                lon /= m.length; lat /= m.length;
                centers.set(key, key === 'Elsewhere'
                    ? { x: a.x + a.w * 0.08, y: a.y + a.h * 0.92 }
                    : { x: a.x + a.w / 2 + ((lon - (b[0][0] + b[1][0]) / 2) * cosLat) * k,
                        y: a.y + a.h / 2 - (lat - (b[0][1] + b[1][1]) / 2) * k });
            });
            return centers;
        }

        function focusGroup(key) {
            gal.focus = key;
            closePanel();
            galleryLayout();
        }

        // biggest card size that fits n cards (4:3 plus frame) into a w x h box, and the column count that gives it
        function fitGrid(n, w, h) {
            var best = { size: 30, cols: 1 };
            for (var cols = 1; cols <= n; cols++) {
                var rows = Math.ceil(n / cols);
                var s = Math.min(w / cols / 1.1, h / rows / (0.75 * 1.12));
                if (s > best.size) best = { size: s, cols: cols };
            }
            best.size = Math.min(best.size, 220);
            return best;
        }

        var Y_SQUASH = 0.72;   // spirals are flatter than they are wide
        // radius of a group in card sizes: spiral extent + half a card
        function groupRadius(count) { return Math.sqrt(count + 0.5) * SPREAD + 0.55; }

        // canton view: push group centres apart until no two groups overlap (they start where the cantons are)
        function separate(centers, keys, members, size, area) {
            var home = {};
            keys.forEach(function (k) { home[k] = { x: centers.get(k).x, y: centers.get(k).y / Y_SQUASH }; });
            var c = {};   // y is stretched by 1/Y_SQUASH, so every group is a plain circle
            keys.forEach(function (k) { c[k] = { x: home[k].x, y: home[k].y, r: groupRadius(members.get(k).length) * size }; });
            for (var it = 0; it < 300; it++) {
                for (var a = 0; a < keys.length; a++) for (var b = a + 1; b < keys.length; b++) {
                    var p = c[keys[a]], q = c[keys[b]];
                    var dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, gap = p.r + q.r - d;
                    if (gap <= 0) continue;
                    var ux = dx / d, uy = dy / d;
                    // the bigger group moves less
                    var wp = q.r / (p.r + q.r), wq = p.r / (p.r + q.r);
                    p.x -= ux * gap * wp; p.y -= uy * gap * wp;
                    q.x += ux * gap * wq; q.y += uy * gap * wq;
                }
                keys.forEach(function (k) {
                    var g = c[k];
                    g.x += (home[k].x - g.x) * 0.02; g.y += (home[k].y - g.y) * 0.02;   // drift back towards the real position
                    g.x = Math.max(area.x, Math.min(area.x + area.w, g.x));
                    g.y = Math.max(area.y / Y_SQUASH, Math.min((area.y + area.h) / Y_SQUASH, g.y));
                });
            }
            keys.forEach(function (k) { centers.set(k, { x: c[k].x, y: c[k].y * Y_SQUASH }); });
        }

        function galleryLayout() {
            if (mode !== 'gallery') return;
            if (!gal.cards) galleryBuild();
            var w = gcanvas.clientWidth, h = gcanvas.clientHeight;
            if (!w) return;
            var narrow = w < 600;
            var shown = visible ? new Set(visible) : null;
            var items = photos.filter(function (f) {
                var inv = f.properties.inv;
                return !gal.failed.has(inv) && (!shown || shown.has(inv));
            });
            var top = narrow ? 275 : 215;   // room for the title and the two filter pills
            var members = new Map();
            items.forEach(function (f) {
                var key = groupOf(f.properties);
                if (!members.has(key)) members.set(key, []);
                members.get(key).push(f);
            });
            // focus: show only one group, big, in the middle
            if (gal.arrange === 'free' || !members.has(gal.focus)) gal.focus = null;
            var focused = gal.focus != null;
            root.classList.toggle('pm-gfocus', focused);
            if (focused) members = new Map([[gal.focus, members.get(gal.focus).slice().sort(function (a, b) {
                return (a.properties.annee ?? 9999) - (b.properties.annee ?? 9999);
            })]]);
            var size = (narrow ? Math.max(44, w * 0.135) : Math.min(112, w * 0.078)) * (gal.arrange === 'canton' ? 0.8 : 1);
            if (gal.arrange === 'canton' && !focused) { // shrink the cards until all the groups fit side by side
                var units = 0;
                members.forEach(function (list) { var u = groupRadius(list.length); units += Math.PI * u * u * Y_SQUASH; });
                size = Math.max(30, Math.min(size, Math.sqrt(0.5 * (w - 48) * (h - top - 100) / units)));
            }
            var area = { x: 24 + size / 2, y: top, w: w - 48 - size, h: h - top - 100 };  // keep clear of the title and the timeline

            var keys = Array.from(members.keys());
            if (gal.arrange === 'decade') keys.sort(function (a, b) { return (a === 'Undated') - (b === 'Undated') || a - b; });
            if (gal.arrange === 'theme') keys.sort(function (a, b) { return THEMES.indexOf(a) - THEMES.indexOf(b); });
            var centers = gal.arrange === 'free' || focused ? null : groupCenters(keys, members, area);
            if (gal.arrange === 'canton' && !focused) separate(centers, keys, members, size, area);

            // how far cards spread from the group centre, per card: a big group in a small cell piles up instead of spilling out
            function spread(count) {
                var s = SPREAD;
                // the cards themselves stick out half a card (and the label ~20px) beyond the spiral
                if (cell) s = Math.max(0.02, Math.min(s, Math.min(cell.w / 2 - size * 0.5, (cell.h / 2 - size * 0.4 - 20) / 0.72) / (Math.sqrt(count + 0.5) * size)));
                return s;
            }

            var pos = new Map();
            var labelAt = new Map();   // group -> { x: mean x of its cards, y: top edge of its highest card }
            if (focused) {
                var fl = members.get(gal.focus), box = { w: w - 48, h: h - top - 100 - 40 };
                var g = fitGrid(fl.length, box.w, box.h);
                size = g.size;
                var cw = size * 1.1, rh = size * 0.75 * 1.12, rows = Math.ceil(fl.length / g.cols);
                var y0 = top + 40 + (box.h - rows * rh) / 2 + rh / 2, sx = 0;
                fl.forEach(function (f, n) {
                    var row = Math.floor(n / g.cols), inRow = Math.min(g.cols, fl.length - row * g.cols);
                    var x = w / 2 + ((n % g.cols) - (inRow - 1) / 2) * cw;
                    pos.set(f.properties.inv, { x: x, y: y0 + row * rh, i: photos.indexOf(f) });
                    sx += x;
                });
                labelAt.set(gal.focus, { x: w / 2, y: y0 - rh / 2 + 4 });
            } else members.forEach(function (list, key) {
                var sp = spread(list.length), sumX = 0, minY = Infinity;
                list.forEach(function (f, n) {
                    var i = photos.indexOf(f), x, y;
                    if (!centers) { // free: a fixed scatter, so a photo keeps its place when the filter changes
                        x = area.x + (i * 0.61803398875 % 1) * area.w;
                        y = area.y + (i * 0.754877666 % 1) * area.h;
                    } else {
                        var c = centers.get(key), angle = n * GOLDEN + i * 0.07, r = Math.sqrt(n + 0.5) * size * sp;
                        x = c.x + Math.cos(angle) * r;
                        y = c.y + Math.sin(angle) * r * 0.72;
                    }
                    x = Math.max(size * 0.7, Math.min(w - size * 0.7, x));
                    y = Math.max(size * 0.65, Math.min(h - size * 0.65, y));
                    pos.set(f.properties.inv, { x: x, y: y, i: i });
                    sumX += x; minY = Math.min(minY, y);
                });
                labelAt.set(key, { x: sumX / list.length, y: minY - size * 0.375 });
            });

            gal.cards.forEach(function (el, inv) {
                var p = pos.get(inv);
                el.classList.toggle('pm-card-off', !p);
                if (!p) return;   // filtered out: fades away where it was
                el.style.width = size + 'px';
                el.style.zIndex = p.i + 1;
                el.style.transform = 'translate(' + (p.x - size / 2) + 'px,' + (p.y - size * 0.375) + 'px) rotate(' + (Math.sin(p.i * 17) * 11) + 'deg)';
            });

            gcanvas.querySelectorAll('.pm-glabel').forEach(function (el) { el.remove(); });
            if (gal.arrange === 'free') return;
            keys.forEach(function (key) {
                var at = labelAt.get(key), n = members.get(key).length;
                var label = document.createElement(focused ? 'span' : 'button');
                label.className = 'pm-glabel';
                if (!focused) { label.type = 'button'; label.addEventListener('click', function (e) { e.stopPropagation(); focusGroup(key); }); }
                label.appendChild(document.createTextNode(groupLabel(key)));
                var count = document.createElement('span');   // the count is its own badge, apart from the title
                count.className = 'pm-gcount';
                count.textContent = n;
                label.appendChild(count);
                label.style.left = at.x + 'px';
                label.style.top = Math.max(20, at.y - 16) + 'px';
                gcanvas.appendChild(label);
            });
        }

        container.querySelector('.pm-arrange').addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (!b) return;
            gal.arrange = b.dataset.arrange;
            gal.focus = null;
            container.querySelectorAll('.pm-arrange button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
            galleryLayout();
        });
        // empty canvas: close the panel first, then leave the focused group
        gcanvas.addEventListener('click', function () { if (selected != null || stack) closePanel(); else if (gal.focus != null) focusGroup(null); });
        $('.pm-gback').addEventListener('click', function () { focusGroup(null); });
        container.addEventListener('keydown', function (e) { if (e.key === 'Escape' && mode === 'gallery' && gal.focus != null) focusGroup(null); });
        if (global.ResizeObserver) new ResizeObserver(galleryLayout).observe(gcanvas);

        // ---------- date filter ----------
        [sliderStart, sliderEnd].forEach(function (s) {
            s.min = YEAR_MIN; s.max = YEAR_MAX;
            s.addEventListener('input', function () { filterDates(s); });
        });
        sliderStart.value = YEAR_MIN;
        sliderEnd.value = YEAR_MAX;
        undatedBox.addEventListener('change', function () { filterDates(); });

        function filterDates(source) {
            // the two handles cannot cross
            if (+sliderStart.value > +sliderEnd.value) {
                if (source === sliderStart) sliderStart.value = sliderEnd.value;
                else sliderEnd.value = sliderStart.value;
            }
            var from = +sliderStart.value, to = +sliderEnd.value;
            $('.pm-year-start').textContent = from;
            $('.pm-year-end').textContent = to;

            var on = activeThemes();
            var themeOk = function (p) { return !themeSel.size || themesOf(p).some(function (t) { return on.has(t); }); };

            // single source of truth: the list of visible `inv` feeds both the map filter and the counter
            visible = photos.filter(function (f) {
                var y = f.properties.annee;
                if (!themeOk(f.properties) || typeOff.has(f.properties.type_lieu)) return false;
                return y == null ? undatedBox.checked : (y >= from && y <= to);
            }).map(function (f) { return f.properties.inv; });

            liveMaps().forEach(setPhotoData);
            galleryLayout();

            // the open photo (or the stack list) fell out of the filter: close the panel
            if ((selected != null && visible.indexOf(selected) < 0) || (selected == null && stack)) closePanel();
        }

        // ---------- selection ----------
        function highlight() { // outline on the selected photo's preview
            thumbSets.forEach(function (t) { t.mark(); });
            if (gal.cards) gal.cards.forEach(function (el, inv) { el.classList.toggle('pm-card-sel', inv === selected); });
        }

        function closePanel() {
            selected = null; stack = null;
            panel.classList.remove('pm-open');
            highlight();
        }

        function openPhoto(inv) {
            selected = inv;
            highlight();
            showInfo(byInv.get(inv));
        }

        panel.addEventListener('click', function (e) {
            if (e.target.closest('.pm-close')) closePanel();
        });

        // ---------- panel ----------
        function placeText(p) {
            if (!p) return null;
            var t = esc(p.nom ?? '');
            if (p.e) t += ' <span class="pm-coord">(' + p.e.toLocaleString('en-CH') + ' / ' + p.n.toLocaleString('en-CH') + ')</span>';
            return t;
        }

        function chips(p) {
            return (p.themes || []).map(function (t) { return '<span class="pm-chip">' + esc(t) + '</span>'; }).join('');
        }

        // several photos on one spot: show all of them at once, oldest first, no extra click
        function showStack() {
            highlight();
            var list = stack.map(function (inv) { return byInv.get(inv); }).sort(function (a, b) {
                return (a.annee ?? 9999) - (b.annee ?? 9999) || a.inv - b.inv;
            });
            var place = list[0].lieu_represente || list[0].lieu_prise_de_vue;   // same coordinate for all of them
            var html = '<h3 class="pm-h3">' + list.length + ' photos at this spot</h3>';
            if (place && place.nom) html += '<div class="pm-spot">' + esc(place.nom) + '</div>';
            list.forEach(function (p) {
                html += '<article class="pm-entry">' +
                    '<div class="pm-image"><span class="pm-loading">Loading image…</span></div>' +
                    '<div class="pm-entry-head"><strong>' + esc(p.titre ?? 'Untitled') + '</strong>' +
                      '<span class="pm-date">' + esc(p.date_texte ?? (p.annee ?? 'date unknown')) + '</span></div>' +
                    (p.description ? '<div class="pm-desc">' + esc(p.description) + '</div>' : '') +
                    '<div class="pm-chips">' + chips(p) + '</div>' +
                    '<a href="' + esc(o.links.page(p.inv)) + '" target="_blank" rel="noopener">View on Memobase ↗</a>' +
                  '</article>';
            });
            info.innerHTML = html;
            panel.classList.add('pm-open');
            panel.scrollTop = 0;
            var boxes = info.querySelectorAll('.pm-image');
            list.forEach(function (p, i) { loadImage(p.inv, boxes[i]); });
        }

        function showInfo(p) {
            var rows = [
                ['Description', esc(p.description ?? '')],
                ['Theme', (p.themes || []).map(esc).join(', ')],
                ['Date', esc(p.date_texte ?? (p.annee ? String(p.annee) : 'unknown'))],
                ['Place shown', placeText(p.lieu_represente)]
            ];
            var html = '<h3 class="pm-h3">' + esc(p.titre ?? 'Untitled') + '</h3>';
            html += '<div class="pm-image"><span class="pm-loading">Loading image…</span></div>';
            html += '<a href="' + esc(o.links.page(p.inv)) + '" target="_blank" rel="noopener">View on Memobase ↗</a>';
            html += '<table class="pm-table">';
            rows.forEach(function (r) {
                if (r[1]) html += '<tr><td class="pm-label">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
            });
            html += '</table>';
            info.innerHTML = html;
            panel.classList.add('pm-open');
            loadImage(p.inv, info.querySelector('.pm-image'));
        }

        // ---------- image from Memobase (direct IIIF) ----------
        function loadImage(inv, box) {
            var img = new Image();
            img.alt = 'Photo ' + inv;
            // the box is replaced when another photo is clicked meanwhile: ignore late answers
            var isCurrent = function () { return info.contains(box); };
            img.onload = function () {
                if (!isCurrent()) return;
                var a = document.createElement('a');
                a.href = o.links.page(inv);
                a.target = '_blank';
                a.rel = 'noopener';
                a.appendChild(img);
                box.replaceChildren(a);
            };
            img.onerror = function () {
                if (isCurrent()) box.innerHTML = '<span class="pm-loading">Image not available here.</span>';
            };
            img.src = o.links.image(inv);
        }

        filterDates(); // show the year labels right away, before the map has finished loading

        return {
            map: map,
            destroy: function () { map.remove(); if (histMap) histMap.remove(); container.innerHTML = ''; }
        };
    }

    global.PhotoMap = { mount: mount };
})(window);
