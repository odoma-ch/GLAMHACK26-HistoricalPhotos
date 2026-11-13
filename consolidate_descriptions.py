"""Add consolidated description columns to the photo workbook.

Reads the `Beschreibung` column of the first sheet and writes two columns back
into the same file:

  Beschreibung-consolidated           themes in English, separated by "; ",
                                      or "uncategorised" when no keyword matches
  Beschreibung-consolidated-keywords  the words of the original description that
                                      triggered those themes, untranslated

The rules are the ones from notebooks/explore_data_mappe.ipynb. Running the
script again overwrites the two columns, so it is safe to repeat.

Usage: python consolidate_descriptions.py data/Data_mappe.xlsx
"""
import os
import re
import sys
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

SOURCE_COLUMN = "Beschreibung"
CONSOLIDATED = "Beschreibung-consolidated"
CONSOLIDATED_KEYWORDS = "Beschreibung-consolidated-keywords"
NO_THEME = "uncategorised"
SEPARATOR = "; "

# Keywords per theme, matched without regard to case anywhere inside a word,
# so "kirch" finds "Kirchturm". The descriptions are in German, French and Italian.
THEMES = {
    "Church or chapel": [
        "kirch", "kichturm", "église", "eglise", "chiesa", "kapell", "chapelle", "temple", "münster",
        "collégiale", "collègiale", "kloster", "convento", "monastero", "synagoge", "campanile", "clocher",
    ],
    "School": ["schulhaus", "schule", "collège", "école", "ecole"],
    "Castle or ruin": ["schloss", "château", "chateau", "ruine", "torturm", "thorturm"],
    "Other building": [
        "haus", "häuschen", "villa", "hotel", "hôtel", r"pension\b", "fabrik", "kamin", "gebäude", "maison",
        "ferme", "casa", "scheune", "spital", "hôpital", "sägerei", "restaura", "café", "anstalt", "barrage",
        "salle", "halle", "macello", "birraria", "chalet", "stall", "hütte", "refuge", "bahnhof", "wirtschaft",
        "kaserne", "sanatorium", "türmchen", "tourelle", "clocheton", "aussichtsturm", r"\btour\b", "pylône",
        "observatoire", "pavillon",
    ],
    "Survey signal or marker": [
        "signal", "pyramide", "pfeiler", "steinmann", "beobachtungsturm", "beobachungsturm", "gerüst", "cippo",
        "incisione", "grenzstein", "borne", "bolzen", "fixpunkt", "versicherung", "zielpunkt", "zielknopf",
        "heliotrop", "blitzableiter", "paratonnerre", "stationspunkt", "fahnenstange",
    ],
    "Fieldwork and instruments": [
        "nivellement", "theodolit", "basismessung", "basisanfang", "triangulation", "instrument", "stativ",
        "messtisch", "transport", "biwak", "bivouac", "zeltlager", "aufstieg", "abstieg", "abmarsch",
        "komparator", "miren", "apparat", "sondierung", "photogrammetrie", "ballon", r"\brast\b", "schlitten",
        "kletterei", "messgruppe", "entfernungsmesser", "offsetpresse", "gravurring", "karussell",
    ],
    "Summit and terrain": [
        "gipfel", "panorama", "blick", "gletscher", "glacier", "firn", "frana", "rutsch", "bergsturz", "riss",
        "arbino", "felszahn", "landschaft", "sasso marcio", "verwerfung",
    ],
    "People": [
        "ingenieur", "portrait", "personenfoto", "gruppenbild", r"topograph\b", r"kartograph\b", "gehilfe",
        "beamter", "besuch", "oberst", "professor", "kupferstecher", "vorsteher", "personal", "mannschaft",
        r"\bgeneral\b",
    ],
}

# "Haus" and "Türmchen" also occur inside "Schulhaus" and "Kirche mit Türmchen",
# so the catch-all only applies when none of these named building types matched.
CATCH_ALL = "Other building"
NAMED_BUILDINGS = ("Church or chapel", "School", "Castle or ruin")

PATTERNS = {name: re.compile("|".join(stems), flags=re.IGNORECASE) for name, stems in THEMES.items()}


def consolidate(description):
    """Return (themes, keywords) for one description.

    `themes` is the list of English theme labels, in the order of THEMES.
    `keywords` is the list of words that triggered them: each match is widened
    to the whole word and kept as written, in the order it appears.
    """
    themes = [name for name, pattern in PATTERNS.items() if pattern.search(description)]
    if any(name in themes for name in NAMED_BUILDINGS):
        themes = [name for name in themes if name != CATCH_ALL]

    found = []
    for name in themes:
        for match in PATTERNS[name].finditer(description):
            start, end = match.span()
            while start > 0 and description[start - 1].isalpha():
                start -= 1
            while end < len(description) and description[end].isalpha():
                end += 1
            found.append((start, description[start:end]))
    keywords = list(dict.fromkeys(word for _, word in sorted(found)))
    return themes, keywords


def column_for(sheet, header):
    """Index of the column with this header in row 1, or the first free column after the headers."""
    last_header = 0
    for cell in sheet[1]:
        if cell.value is None:
            continue
        if str(cell.value).strip() == header:
            return cell.column
        last_header = cell.column
    return last_header + 1


def main(path):
    workbook = load_workbook(path)
    sheet = workbook.worksheets[0]

    headers = {str(cell.value).strip(): cell.column for cell in sheet[1] if cell.value is not None}
    if SOURCE_COLUMN not in headers:
        sys.exit(f"No '{SOURCE_COLUMN}' column in the first row of sheet '{sheet.title}' of {path}")
    source = headers[SOURCE_COLUMN]

    themes_column = column_for(sheet, CONSOLIDATED)
    sheet.cell(row=1, column=themes_column, value=CONSOLIDATED)
    keywords_column = column_for(sheet, CONSOLIDATED_KEYWORDS)
    sheet.cell(row=1, column=keywords_column, value=CONSOLIDATED_KEYWORDS)

    counts = Counter()
    for row in range(2, sheet.max_row + 1):
        value = sheet.cell(row=row, column=source).value
        description = "" if value is None else str(value).strip()
        if description in ("", "<Null>"):
            # Nothing to categorise: leave both cells empty.
            sheet.cell(row=row, column=themes_column, value=None)
            sheet.cell(row=row, column=keywords_column, value=None)
            counts["without a description"] += 1
            continue
        themes, keywords = consolidate(description)
        sheet.cell(row=row, column=themes_column, value=SEPARATOR.join(themes) or NO_THEME)
        sheet.cell(row=row, column=keywords_column, value=SEPARATOR.join(keywords) or None)
        counts["categorised" if themes else NO_THEME] += 1

    # Save next to the original first, then swap, so a failed save cannot damage the workbook.
    temporary = path.with_name(path.name + ".tmp")
    workbook.save(temporary)
    os.replace(temporary, path)

    total = sum(counts.values())
    summary = ", ".join(f"{count} {label}" for label, count in counts.items())
    print(f"{total} rows in sheet '{sheet.title}': {summary}")
    print(
        f"Wrote '{CONSOLIDATED}' to column {get_column_letter(themes_column)} and "
        f"'{CONSOLIDATED_KEYWORDS}' to column {get_column_letter(keywords_column)} of {path}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
