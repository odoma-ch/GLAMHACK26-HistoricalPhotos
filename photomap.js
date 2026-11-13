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
        subtitle: 'Click a photo to see the details',
        styleUrl: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json',
        bounds: [[5.95, 45.8], [10.5, 47.82]],           // [south-west, north-east] as [lon, lat]
        // keys match the `type_lieu` values in the data: prise_de_vue = where the photo was taken,
        // represente = place shown in the photo (used when the shooting place is unknown)
        colors: { prise_de_vue: '#e4572e', represente: '#0382d1' },
        links: {
            // Memobase only exists in fr/de/it (the /en/ path returns 404)
            page: function (inv) { return 'https://memobase.ch/fr/object/' + memobaseId(inv); },
            // direct IIIF image, 600 px wide
            image: function (inv) { return 'https://media.memobase.ch/memo/' + memobaseId(inv) + '-1/iiif/full/600,/0/default.jpg'; },
            // small preview shown on the map when zoomed in, 120 px wide
            thumb: function (inv) { return 'https://media.memobase.ch/memo/' + memobaseId(inv) + '-1/iiif/full/120,/0/default.jpg'; }
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
        o.colors = Object.assign({}, DEFAULTS.colors, opts.colors);
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

        container.innerHTML =
            '<div class="pm-root">' +
              '<div class="pm-map-hist"></div>' +
              '<div class="pm-map"></div>' +
              '<div class="pm-divider" role="slider" tabindex="0" aria-label="Compare maps: drag to move the divider" aria-valuemin="0" aria-valuemax="100">' +
                '<span class="pm-handle">◀ ▶</span>' +
              '</div>' +
              '<div class="pm-modes" role="tablist">' +
                '<button type="button" role="tab" class="pm-active" data-mode="map" aria-selected="true">Map</button>' +
                '<button type="button" role="tab" data-mode="compare" aria-selected="false">Swipe</button>' +
              '</div>' +
              '<div class="pm-top">' +
                '<div class="pm-title">' + esc(o.title) + '</div>' +
                '<div class="pm-subtitle">' + esc(o.subtitle) + '</div>' +
                '<div class="pm-filters">' +
                  '<label class="pm-pill"><input type="checkbox" class="pm-undated" checked> undated photos</label>' +
                '</div>' +
                '<div class="pm-legend">' +
                  '<div><span class="pm-dot" style="background:' + esc(o.colors.prise_de_vue) + '"></span>Place where the photo was taken</div>' +
                  '<div><span class="pm-dot" style="background:' + esc(o.colors.represente) + '"></span>Place shown (shooting place unknown)</div>' +
                '</div>' +
                '<div class="pm-step pm-step-left">' + stepperHtml('Left · map of') + '</div>' +
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
        var sliderStart = $('.pm-slider-start'), sliderEnd = $('.pm-slider-end');
        var undatedBox = $('.pm-undated');
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
            m.addLayer({
                id: 'pm-clusters', type: 'circle', source: 'pm-photos',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': o.colors.represente,
                    'circle-opacity': 0.9,
                    'circle-radius': ['+', 12, ['*', 3, ['sqrt', ['get', 'point_count']]]],
                    'circle-stroke-color': '#fff',
                    'circle-stroke-width': 2
                }
            });
            m.addLayer({
                id: 'pm-cluster-count', type: 'symbol', source: 'pm-photos',
                filter: ['has', 'point_count'],
                layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': o.font, 'text-size': 14, 'text-allow-overlap': true },
                paint: { 'text-color': '#fff' }
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
                    el.style.borderColor = f.properties.type_lieu === 'prise_de_vue' ? o.colors.prise_de_vue : o.colors.represente;
                    var img = new Image();
                    img.alt = '';
                    img.onerror = function () { el.classList.add('pm-thumb-none'); }; // no picture: plain dot
                    img.src = o.links.thumb(inv);
                    el.appendChild(img);
                    el.addEventListener('click', function (e) { e.stopPropagation(); stack = null; openPhoto(inv, false); });
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
            addPhotoLayers(map);
            ready = true;
            filterDates();
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
            if (m === 'compare') { mapRange = [sliderStart.value, sliderEnd.value]; presetDecade(); }
            else if (mapRange) { sliderStart.value = mapRange[0]; sliderEnd.value = mapRange[1]; }
            mode = m;
            root.classList.toggle('pm-compare', m === 'compare');
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
            filterDates();
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
            if (!ready) return;

            // single source of truth: the list of visible `inv` feeds both the map filter and the counter
            visible = photos.filter(function (f) {
                var y = f.properties.annee;
                return y == null ? undatedBox.checked : (y >= from && y <= to);
            }).map(function (f) { return f.properties.inv; });

            liveMaps().forEach(setPhotoData);

            // the open photo (or the stack list) fell out of the filter: close the panel
            if ((selected != null && visible.indexOf(selected) < 0) || (selected == null && stack)) closePanel();
        }

        // ---------- selection ----------
        function highlight() { // outline on the selected photo's preview
            thumbSets.forEach(function (t) { t.mark(); });
        }

        function closePanel() {
            selected = null; stack = null;
            panel.classList.remove('pm-open');
            highlight();
        }

        function openPhoto(inv, fromStack) {
            selected = inv;
            highlight();
            showInfo(byInv.get(inv), fromStack);
        }

        panel.addEventListener('click', function (e) {
            var btn = e.target.closest('button');
            if (!btn) return;
            if (btn.classList.contains('pm-close')) closePanel();
            else if (btn.classList.contains('pm-back')) { selected = null; highlight(); showStack(); }
            else if (btn.dataset.inv) openPhoto(+btn.dataset.inv, true);
        });

        // ---------- panel ----------
        function placeText(p) {
            if (!p) return null;
            var t = esc(p.nom ?? '');
            if (p.e) t += ' <span class="pm-coord">(' + p.e.toLocaleString('en-CH') + ' / ' + p.n.toLocaleString('en-CH') + ')</span>';
            return t;
        }

        function showStack() {
            highlight();
            var html = '<h3 class="pm-h3">' + stack.length + ' photos at this spot</h3>';
            stack.forEach(function (inv) {
                var p = byInv.get(inv);
                html += '<button type="button" class="pm-item" data-inv="' + inv + '">' + esc(p.titre ?? 'Untitled') +
                    '<br><small>' + esc(p.date_texte ?? (p.annee ?? 'date unknown')) + '</small></button>';
            });
            info.innerHTML = html;
            panel.classList.add('pm-open');
        }

        function showInfo(p, fromStack) {
            var rows = [
                ['Description', esc(p.description ?? '')],
                ['Date', esc(p.date_texte ?? (p.annee ? String(p.annee) : 'unknown'))],
                ['Place shown', placeText(p.lieu_represente)]
            ];
            var html = fromStack && stack ? '<button type="button" class="pm-back">← Other photos here</button>' : '';
            html += '<h3 class="pm-h3">' + esc(p.titre ?? 'Untitled') + '</h3>';
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
            var isCurrent = function () { return info.querySelector('.pm-image') === box; };
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
