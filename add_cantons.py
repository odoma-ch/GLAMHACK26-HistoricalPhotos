"""Adds a `canton` property (two-letter code, e.g. "ZH") to every geolocated photo in data_photos.js.

Usage: python3 add_cantons.py

Looks each distinct point up in swisstopo's swissBOUNDARIES3D (identify API, no key needed) and
rewrites data_photos.js in place; every other value is left as it is. Points outside Switzerland
(or when the lookup fails) get `canton: null`. Safe to run again: photos that already have a
canton are skipped, the others (abroad or failed lookup) are tried again. Stdlib only.
"""
import json, urllib.request, urllib.parse

FILE = 'data_photos.js'
API = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?'


def canton_at(lon, lat):
    q = urllib.parse.urlencode({
        'geometryType': 'esriGeometryPoint', 'geometry': f'{lon},{lat}', 'sr': 4326,
        'layers': 'all:ch.swisstopo.swissboundaries3d-kanton-flaeche.fill',
        'tolerance': 0, 'returnGeometry': 'false',
    })
    with urllib.request.urlopen(API + q, timeout=20) as r:
        results = json.load(r)['results']
    return results[0]['attributes']['ak'] if results else None


text = open(FILE, encoding='utf-8').read()
head, body = text.split('var photos = ', 1)
data = json.loads(body.rstrip().rstrip(';'))

cache = {}
for f in data['features']:
    if not f['geometry'] or f['properties'].get('canton'):
        continue
    key = tuple(f['geometry']['coordinates'])
    if key not in cache:
        try:
            cache[key] = canton_at(*key)
        except Exception as e:  # network / API problem: leave unknown, do not abort the whole run
            print('lookup failed', key, e)
            cache[key] = None
    f['properties']['canton'] = cache[key]

with open(FILE, 'w', encoding='utf-8') as out:
    out.write(head + 'var photos = ' + json.dumps(data, ensure_ascii=False) + ';\n')

counts = {}
for f in data['features']:
    if f['geometry']:
        c = f['properties'].get('canton')
        counts[c] = counts.get(c, 0) + 1
print(len(cache), 'points looked up;', dict(sorted(counts.items(), key=lambda kv: -kv[1])))
