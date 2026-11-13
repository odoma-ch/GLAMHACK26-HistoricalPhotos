"""Convertit Data_mappe.xlsx en data_photos.js (GeoJSON) pour la carte Leaflet.
Usage : python convertir_donnees.py Data_mappe.xlsx

Les thèmes et mots-clés des descriptions viennent des colonnes ajoutées au classeur
par consolidate_descriptions.py ; lancer ce script d'abord sur le même classeur.
"""
import sys, re, json, datetime
from math import asin, atan, atan2, cos, exp, hypot, log, pi, radians, degrees, sin, sqrt, tan
import pandas as pd

# Ellipsoïde de Bessel 1841 et projection suisse (origine : ancien observatoire de Berne)
BESSEL_A, BESSEL_E2 = 6377397.155, 0.006674372230614
BESSEL_E = sqrt(BESSEL_E2)
PHI0, LAMBDA0 = radians(46 + 57/60 + 8.66/3600), radians(7 + 26/60 + 22.5/3600)
SPHERE_R = BESSEL_A * sqrt(1 - BESSEL_E2) / (1 - BESSEL_E2 * sin(PHI0)**2)
ALPHA = sqrt(1 + BESSEL_E2 / (1 - BESSEL_E2) * cos(PHI0)**4)
B0 = asin(sin(PHI0) / ALPHA)
K = (log(tan(pi/4 + B0/2)) - ALPHA * log(tan(pi/4 + PHI0/2))
     + ALPHA * BESSEL_E / 2 * log((1 + BESSEL_E * sin(PHI0)) / (1 - BESSEL_E * sin(PHI0))))
# CH1903+ -> WGS84 : translation du centre de l'ellipsoïde (m), puis ellipsoïde WGS84
DX, DY, DZ = 674.374, 15.056, 405.346
WGS_A, WGS_E2 = 6378137.0, 0.00669437999014

def lv95_vers_wgs84(e, n):
    """Formules rigoureuses swisstopo, sans pyproj : mêmes résultats que EPSG:2056 -> EPSG:4326."""
    # projection cylindrique oblique inverse : plan -> sphère -> ellipsoïde de Bessel
    l_, b_ = (e - 2600000) / SPHERE_R, 2 * (atan(exp((n - 1200000) / SPHERE_R)) - pi/4)
    b = asin(cos(B0) * sin(b_) + sin(B0) * cos(b_) * cos(l_))
    l = atan2(sin(l_), cos(B0) * cos(l_) - sin(B0) * tan(b_))
    lam, phi = LAMBDA0 + l / ALPHA, b
    for _ in range(10):
        s = (log(tan(pi/4 + b/2)) - K) / ALPHA + BESSEL_E * log(tan(pi/4 + asin(BESSEL_E * sin(phi)) / 2))
        phi = 2 * atan(exp(s)) - pi/2
    # changement de datum par les coordonnées géocentriques (altitude 0)
    rn = BESSEL_A / sqrt(1 - BESSEL_E2 * sin(phi)**2)
    x, y, z = rn * cos(phi) * cos(lam) + DX, rn * cos(phi) * sin(lam) + DY, rn * (1 - BESSEL_E2) * sin(phi) + DZ
    p = hypot(x, y)
    lat = atan2(z, p * (1 - WGS_E2))
    for _ in range(10):
        rn = WGS_A / sqrt(1 - WGS_E2 * sin(lat)**2)
        lat = atan2(z + WGS_E2 * rn * sin(lat), p)
    return round(degrees(atan2(y, x)), 6), round(degrees(lat), 6)

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

def liste(v):
    """'Church or chapel; School' -> ['Church or chapel', 'School'] ; cellule vide ou colonne absente -> []."""
    if pd.isna(v):
        return []
    return [p.strip() for p in str(v).split(';') if p.strip()]

df = pd.read_excel(sys.argv[1])

# 7 photos apparaissent deux fois (une ligne géolocalisée, une vide) : on garde la plus complète
df['_rempli'] = df.notna().sum(axis=1)
df = df.sort_values('_rempli', ascending=False).drop_duplicates('NAME').sort_values('Inv')

# thèmes (en anglais) et mots-clés d'origine des descriptions, écrits dans le classeur par consolidate_descriptions.py
COL_THEMES, COL_MOTS_CLES = 'Beschreibung-consolidated', 'Beschreibung-consolidated-keywords'
manquantes = [c for c in (COL_THEMES, COL_MOTS_CLES) if c not in df.columns]
if manquantes:
    print(f"Attention : colonnes absentes du classeur ({', '.join(manquantes)}) : themes et mots_cles seront vides.")
    print(f"Lancer d'abord : python consolidate_descriptions.py {sys.argv[1]}")

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
            'themes': liste(r.get(COL_THEMES)),
            'mots_cles': liste(r.get(COL_MOTS_CLES)),
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
print("avec thèmes:", sum(bool(f['properties']['themes']) for f in features),
      "| dont uncategorised:", sum(f['properties']['themes'] == ['uncategorised'] for f in features))
