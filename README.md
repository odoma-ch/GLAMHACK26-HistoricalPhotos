# Historical photos – swisstopo (GLAMHack 2026)

A map of historical photographs from swisstopo (1,771 in the collection, 280 with a place on
the map), built from an Excel export of the collection. The photos themselves are loaded from
Memobase.

Three views, chosen with the tabs at the top:

- **Map**: one dot per photo; close photos merge into numbered circles, a lone photo shows a preview.
- **Swipe**: two synced maps side by side, today's map against a swisstopo historical map of any year.
- **Gallery**: photos as floating cards on a plain canvas, arranged freely, by decade or by canton.
  Click a decade or canton to open it as a full-size grid (back with *← All*, Esc or a click on the canvas).

All views use the year slider and the "undated photos" switch.

## View the map

```sh
python -m http.server 8000   # then open http://localhost:8000
```

The base map and the photos need an internet connection.

## How the data flows

```
data/Mappe2_v7.xlsx
   │  consolidate_descriptions.py   adds the theme and keyword columns to the workbook
   │  convertir_donnees.py          converts the workbook to GeoJSON
   │  add_cantons.py                adds the canton of every point to the GeoJSON
   ▼
data_photos.js  →  index.html + photomap.js
```

To rebuild the map data after the workbook changes, run from the repository root
(`data_photos.js` is written to the current directory):

```sh
python consolidate_descriptions.py data/Mappe2_v7.xlsx
python convertir_donnees.py data/Mappe2_v7.xlsx
python add_cantons.py
```

The first two scripts need Python with `pandas` and `openpyxl`; `add_cantons.py` uses only the
standard library. All three can be run again safely: the first overwrites its two columns in the
workbook, the second overwrites `data_photos.js` (and so drops the cantons), the third adds
them back. **Always run `add_cantons.py` after `convertir_donnees.py`**: the Gallery's "By
canton" view needs the `canton` property.

`add_cantons.py` needs an internet connection. It asks swisstopo's identify service
(`api3.geo.admin.ch`, layer swissBOUNDARIES3D cantons, no key needed) which canton contains each
point, one request per distinct point (about 190, roughly a minute). Photos that already have a
canton are skipped. A point outside Switzerland (border summits such as the Matterhorn) gets
`canton: null` and is looked up again on the next run, as is a point whose request failed
(the failure is printed).

## Files

| File | What it is |
| --- | --- |
| `index.html`, `photomap.js`, `photomap.css` | The map (MapLibre GL JS). |
| `data_photos.js` | Generated map data. Do not edit by hand. |
| `convertir_donnees.py` | Workbook → `data_photos.js`. |
| `add_cantons.py` | Adds `canton` to every photo in `data_photos.js` (swisstopo identify service; needs internet). |
| `consolidate_descriptions.py` | Adds `Beschreibung-consolidated` and `Beschreibung-consolidated-keywords` to a workbook. |
| `data/Mappe2_v7.xlsx` | Current workbook; the map is built from this one. |
| `data/Mappe2_v6_orte_orte.xlsx` | Previous workbook (112 fewer photos with a place). |
| `data/Data_mappe.xlsx`, `data/Data_mappe.csv` | Earlier export. Differs from v6 in the place columns of 14 rows; not compared with v7. |
| `data/places_descriptors_orte_orte_orte.csv` | Place table with WGS84 coordinates and Wikidata ids. Not read by any script yet. |
| `notebooks/explore_data_mappe.ipynb` | Exploration of the export: dates, titles, descriptions, places. Reads `data/Data_mappe.csv`. |
| `index_fix_iiif.js` | Earlier map code. Not loaded by `index.html`. |

## Properties in `data_photos.js`

One GeoJSON feature per photo. `geometry` is `null` for photos without coordinates
(1,491 of 1,771).

| Property | Workbook column | Notes |
| --- | --- | --- |
| `inv` | `Inv` | Inventory number; also gives the Memobase id. |
| `numero` | `nummer` | |
| `titre` | `Name2` | |
| `description` | `Beschreibung` | German, French or Italian. |
| `themes` | `Beschreibung-consolidated` | List of English themes, or `["uncategorised"]`. |
| `mots_cles` | `Beschreibung-consolidated-keywords` | List of the original words that triggered the themes; may be empty. |
| `annee` | `Jahr` | First year found, or `null` (217 photos are `N/A`). |
| `date_texte` | `Jahr` | The date as written. |
| `auteur` | `Tags` | |
| `remarque` | `Bemerkungen ` | The column name has a trailing space. |
| `type_lieu` | | `prise_de_vue` or `represente`: which place the point shows. |
| `lieu_represente` | `Abgebildeter_Ort_*` | Place shown in the photo: name, LV95 and WGS84 coordinates. |
| `lieu_prise_de_vue` | `Aufnahmeort_*` | Place the photo was taken from; preferred for the point when known. |
| `statut` | `Ortsfinder_Status` | |
| `canton` | | Two-letter canton code (`BE`, `VS`, ...) of the point, from `add_cantons.py`; `null` outside Switzerland (7 border summits). Only present after `add_cantons.py` has run. |

## Description themes

Themes are assigned by keyword matching on `Beschreibung`; the keyword lists are in
`consolidate_descriptions.py`. A description can have several themes. In the workbook they
are joined with `; `, in `data_photos.js` they are a list.

| Theme | Photos |
| --- | --- |
| Church or chapel | 904 |
| Survey signal or marker | 270 |
| Other building | 214 |
| Fieldwork and instruments | 106 |
| Summit and terrain | 103 |
| School | 94 |
| People | 85 |
| Castle or ruin | 60 |
| uncategorised | 75 |

`Other building` is only assigned when the description is not already a church, school or
castle. The notebook contains the same rules and the analysis behind them; if the keyword
lists change, change them in both places.

## Things to know

- **Duplicates**: the export has 1,778 rows for 1,771 photos. Seven photos appear twice;
  `convertir_donnees.py` and the notebook keep the more complete row.
- **Dates**: `Jahr` mixes years, real dates, ranges and text such as `before 1906`. In the
  CSV, 135 dates appear as `Apr-21` or `6/16/01`; in the workbook they are real dates.
- **Coordinates**: converted from LV95 with swisstopo's rigorous formulas, written out in
  `convertir_donnees.py` so that no extra library is needed. The results equal those of
  `pyproj` (EPSG:2056 → EPSG:4326) at the six decimals stored.
- **Tesserete (inv 389964)**: its coordinates are stored as `; 2718132` (an empty first
  entry, then a manually placed point). The script uses the first non-empty entry, so the
  photo has a point on the map.
- **Map does not use the themes yet**: `photomap.js` does not read `themes` or `mots_cles`.
- **Gallery**: only photos whose Memobase picture loads get a card (261 of the 280 at the last check); the others stay on the map. Cards use the 240 px IIIF picture.
- **Cantons at the border**: a point exactly on or just outside the boundary may get no canton and falls into the "Border / abroad" group.

## Open questions

- How was the `data_photos.js` of commit `a33653a` produced? Its coordinates are an exact
  LV95 → WGS84 conversion, while the script at that commit used an approximate formula
  (up to 2 m off), and Tesserete had no point. The script now reproduces that file exactly
  except for Tesserete, so nothing is lost, but the tool that made it is not in the repository.
- Should `data/Data_mappe.xlsx` and `data/Data_mappe.csv` be kept now that the map is built
  from `Mappe2_v7.xlsx`? The notebook still reads the CSV.
