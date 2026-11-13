"""Convertit Data_mappe.xlsx en data_photos.js (GeoJSON) pour la carte Leaflet.
Usage : python convertir_donnees.py Data_mappe.xlsx
"""
import sys, re, json, datetime
import pandas as pd

def lv95_vers_wgs84(e, n):
    """Formule approchée swisstopo (précision ~1 m), sans pyproj."""
    y = (e - 2600000) / 1e6
    x = (n - 1200000) / 1e6
    lon = (2.6779094 + 4.728982*y + 0.791484*y*x + 0.1306*y*x*x - 0.0436*y**3) * 100/36
    lat = (16.9023892 + 3.238272*x - 0.270978*y*y - 0.002528*x*x
           - 0.0447*y*y*x - 0.0140*x**3) * 100/36
    return round(lon, 6), round(lat, 6)

def premier_nombre(v):
    """'2593463; ' ou '2603726; 2601392' -> 2593463.0 (première valeur)."""
    if pd.isna(v):
        return None
    for part in str(v).split(';'):
        part = part.strip()
        if part:
            try:
                return float(part)
            except ValueError:
                pass
    return None

def premier_texte(v):
    if pd.isna(v):
        return None
    parts = [p.strip() for p in str(v).split(';') if p.strip()]
    return parts[0] if parts else None

def annee(v):
    """Jahr est mélangé : 1919, 1919.0, datetime, 'June 1914', '1935-1936', 'before 1906'."""
    if pd.isna(v):
        return None
    if isinstance(v, (datetime.datetime, pd.Timestamp)):
        return v.year
    if isinstance(v, (int, float)):
        return int(v)
    m = re.search(r'(1[89]\d\d|20\d\d)', str(v))
    return int(m.group(1)) if m else None

def texte(v):
    if pd.isna(v) or str(v).strip() in ('', '<Null>'):
        return None
    return str(v).strip()

df = pd.read_excel(sys.argv[1])

# 7 photos apparaissent deux fois (une ligne géolocalisée, une vide) : on garde la plus complète
df['_rempli'] = df.notna().sum(axis=1)
df = df.sort_values('_rempli', ascending=False).drop_duplicates('NAME').sort_values('Inv')

def lieu(r, prefixe):
    """Nom + coordonnées LV95/WGS84 d'un lieu (représenté ou prise de vue), ou None."""
    e, n = premier_nombre(r[f'{prefixe}_E_LV95']), premier_nombre(r[f'{prefixe}_N_LV95'])
    nom = premier_texte(r[f'{prefixe}_Name'])
    if not (e and n) and not nom:
        return None
    d = {'nom': nom}
    if e and n:
        d['e'], d['n'] = int(e), int(n)
        d['lon'], d['lat'] = lv95_vers_wgs84(e, n)
    return d

features = []
for _, r in df.iterrows():
    represente = lieu(r, 'Abgebildeter_Ort')
    prise_de_vue = lieu(r, 'Aufnahmeort')
    # point sur la carte : lieu de prise de vue s'il est connu, sinon lieu représenté
    geom, type_lieu = None, None
    for code, l in (('prise_de_vue', prise_de_vue), ('represente', represente)):
        if l and 'lon' in l:
            geom = {'type': 'Point', 'coordinates': [l['lon'], l['lat']]}
            type_lieu = code
            break
    jahr = r['Jahr']
    features.append({
        'type': 'Feature',
        'geometry': geom,
        'properties': {
            'inv': int(r['Inv']),
            'numero': str(r['nummer']),
            'titre': texte(r['Name2']),
            'description': texte(r['Beschreibung']),
            'annee': annee(jahr),
            'date_texte': jahr.strftime('%B %Y') if isinstance(jahr, (datetime.datetime, pd.Timestamp)) else texte(jahr),
            'auteur': (texte(r['Tags']) or '').replace('Author: ', '') or None,
            'remarque': texte(r['Bemerkungen ']),
            'type_lieu': type_lieu,
            'lieu_represente': represente,
            'lieu_prise_de_vue': prise_de_vue,
            'statut': texte(r['Ortsfinder_Status']),
        },
    })

geojson = {'type': 'FeatureCollection', 'features': features}
with open('data_photos.js', 'w', encoding='utf-8') as f:
    f.write('// Généré par convertir_donnees.py — © Data: swisstopo, Ortsfinder-Prototyp, résultats à vérifier\n')
    f.write('var photos = ' + json.dumps(geojson, ensure_ascii=False) + ';\n')

geo = [ft for ft in features if ft['geometry']]
ans = [ft['properties']['annee'] for ft in features if ft['properties']['annee']]
print(f"{len(features)} photos, {len(geo)} géolocalisées, années {min(ans)}–{max(ans)}")
print("prise de vue:", sum(f['properties']['type_lieu']=='prise_de_vue' for f in geo),
      "| représenté:", sum(f['properties']['type_lieu']=='represente' for f in geo),
      "| géoloc. sans année:", sum(f['properties']['annee'] is None for f in geo))
