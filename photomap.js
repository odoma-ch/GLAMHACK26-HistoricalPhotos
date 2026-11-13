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
        subtitle: 'Click a dot to see the photo',
        styleUrl: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json',
        bounds: [[5.95, 45.8], [10.5, 47.82]],           // [south-west, north-east] as [lon, lat]
        // keys match the `type_lieu` values in the data: prise_de_vue = where the photo was taken,
        // represente = place shown in the photo (used when the shooting place is unknown)
        colors: { prise_de_vue: '#e4572e', represente: '#0382d1' },
        links: {
            // Memobase only exists in fr/de/it (the /en/ path returns 404)
            page: function (inv) { return 'https://memobase.ch/fr/object/' + memobaseId(inv); },
            // direct IIIF image, 600 px wide
            image: function (inv) { return 'https://media.memobase.ch/memo/' + memobaseId(inv) + '-1/iiif/full/600,/0/default.jpg'; }
        },
        credit: '© Data: swisstopo – Ortsfinder prototype, results to be verified'
    };

    // Memobase id = "blt-001-" + inventory number padded to 9 digits
    function memobaseId(inv) { return 'blt-001-' + String(inv).padStart(9, '0'); }

    // data comes from external files: escape everything that goes into HTML
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function mergeOptions(opts) {
        var o = Object.assign({}, DEFAULTS, opts);
        o.colors = Object.assign({}, DEFAULTS.colors, opts.colors);
        o.links = Object.assign({}, DEFAULTS.links, opts.links);
        return o;
    }

    function mount(container, options) {
        if (!options || !options.data) throw new Error('PhotoMap.mount: missing "data" option');
        var o = mergeOptions(options);

        // only geolocated photos go on the map
        var photos = o.data.features.filter(function (f) { return f.geometry != null; });
        // MapLibre turns nested properties into strings: look the original up by `inv` instead
        var byInv = new Map(photos.map(function (f) { return [f.properties.inv, f.properties]; }));
        var years = photos.map(function (f) { return f.properties.annee; }).filter(function (y) { return y != null; });
        var YEAR_MIN = Math.min.apply(null, years);
        var YEAR_MAX = Math.max.apply(null, years);

        container.innerHTML =
            '<div class="pm-root">' +
              '<div class="pm-map"></div>' +
              '<div class="pm-top">' +
                '<div class="pm-title">' + esc(o.title) + '</div>' +
                '<div class="pm-subtitle">' + esc(o.subtitle) + '</div>' +
                '<div class="pm-filters">' +
                  '<label class="pm-pill"><input type="checkbox" class="pm-undated" checked> undated photos</label>' +
                  '<span class="pm-count"></span>' +
                '</div>' +
                '<div class="pm-legend">' +
                  '<div><span class="pm-dot" style="background:' + esc(o.colors.prise_de_vue) + '"></span>Place where the photo was taken</div>' +
                  '<div><span class="pm-dot" style="background:' + esc(o.colors.represente) + '"></span>Place shown (shooting place unknown)</div>' +
                  '<div>' + photos.length + ' of ' + o.data.features.length + ' photos in the collection are geolocated</div>' +
                '</div>' +
              '</div>' +
              '<div class="pm-timeline">' +
                '<span class="pm-year pm-year-start"></span>' +
                '<div class="pm-double">' +
                  '<input type="range" step="1" class="pm-slider-start" aria-label="Start year">' +
                  '<input type="range" step="1" class="pm-slider-end" aria-label="End year">' +
                '</div>' +
                '<span class="pm-year pm-year-end"></span>' +
              '</div>' +
              '<aside class="pm-panel"><button class="pm-close" type="button" aria-label="Close">×</button><div class="pm-info"></div></aside>' +
              '<div class="pm-credit">' + esc(o.credit) + '</div>' +
            '</div>';

        var $ = function (sel) { return container.querySelector(sel); };
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
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

        var ready = false;
        var selected = null;  // inv of the photo open in the panel
        var stack = null;     // inv list of the photos stacked on the clicked spot

        map.on('load', function () {
            map.addSource('pm-photos', { type: 'geojson', data: { type: 'FeatureCollection', features: photos } });

            map.addLayer({
                id: 'pm-points', type: 'circle', source: 'pm-photos',
                paint: {
                    'circle-color': ['match', ['get', 'type_lieu'], 'prise_de_vue', o.colors.prise_de_vue, o.colors.represente],
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 7, 16, 10],
                    'circle-stroke-color': '#fff',
                    'circle-stroke-width': 1.5
                }
            });
            // black ring around the selected point(s)
            map.addLayer({
                id: 'pm-sel', type: 'circle', source: 'pm-photos',
                filter: ['in', ['get', 'inv'], ['literal', []]],
                paint: {
                    'circle-color': 'rgba(0,0,0,0)',
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 8, 12, 12, 16, 15],
                    'circle-stroke-color': '#000',
                    'circle-stroke-width': 3
                }
            });
            ready = true;
            filterDates();
        });

        map.on('mouseenter', 'pm-points', function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'pm-points', function () { map.getCanvas().style.cursor = ''; });

        map.on('click', function (e) {
            if (!ready) return;
            var hits = map.queryRenderedFeatures(e.point, { layers: ['pm-points'] })
                .map(function (f) { return f.properties.inv; });
            var invs = hits.filter(function (inv, i) { return hits.indexOf(inv) === i; }); // same feature can come from several tiles
            if (!invs.length) return closePanel();
            if (invs.length === 1) { stack = null; openPhoto(invs[0], false); }
            else { stack = invs; selected = null; showStack(); }
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
            var visible = photos.filter(function (f) {
                var y = f.properties.annee;
                return y == null ? undatedBox.checked : (y >= from && y <= to);
            }).map(function (f) { return f.properties.inv; });

            map.setFilter('pm-points', ['in', ['get', 'inv'], ['literal', visible]]);
            $('.pm-count').textContent = visible.length + ' photos shown';

            // the open photo (or the stack list) fell out of the filter: close the panel
            if ((selected != null && visible.indexOf(selected) < 0) || (selected == null && stack)) closePanel();
        }

        // ---------- selection ----------
        function highlight() {
            if (!ready) return;
            var ids = selected != null ? [selected] : (stack || []);
            map.setFilter('pm-sel', ['in', ['get', 'inv'], ['literal', ids]]);
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
                ['Place shown', placeText(p.lieu_represente)],
                ['Shooting place', placeText(p.lieu_prise_de_vue)],
                ['Author', p.auteur && esc(p.auteur)],
                ['Remark', p.remarque && esc(p.remarque)],
                ['Inventory no.', esc(p.inv)],
                ['Number', esc(p.numero)],
                ['Status', p.statut && esc(p.statut)]
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
            destroy: function () { map.remove(); container.innerHTML = ''; }
        };
    }

    global.PhotoMap = { mount: mount };
})(window);
