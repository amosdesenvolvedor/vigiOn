#!/usr/bin/env python3
"""Read plain cell values from an XLSX without evaluating formulas or macros."""

import json
import re
import sys
from pathlib import Path
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_XML_BYTES = 5 * 1024 * 1024
MAX_ROWS = 10_000
MAX_COLUMNS = 100
MAX_CELL_LENGTH = 8_000


def fail(message: str) -> None:
    raise ValueError(message)


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if not letters:
        fail("invalid cell reference")
    result = 0
    for char in letters.group(0):
        result = result * 26 + ord(char) - 64
    return result - 1


def parse(path: Path) -> list[dict[str, str]]:
    if not path.is_file() or path.suffix.lower() != ".xlsx":
        fail("input must be an existing .xlsx file")
    if path.stat().st_size > MAX_FILE_BYTES:
        fail("xlsx exceeds size limit")
    try:
        with ZipFile(path) as archive:
            names = set(archive.namelist())
            if any(name.lower().endswith(("vbaproject.bin", ".xlsm")) for name in names):
                fail("macro-enabled workbook is not accepted")
            sheet_name = "xl/worksheets/sheet1.xml"
            if sheet_name not in names:
                fail("first worksheet is missing")
            info = archive.getinfo(sheet_name)
            if info.file_size > MAX_XML_BYTES:
                fail("worksheet exceeds uncompressed size limit")
            root = ET.fromstring(archive.read(sheet_name))
    except (BadZipFile, ET.ParseError) as error:
        fail(f"malformed xlsx: {error}")

    rows: list[list[str]] = []
    for row_element in root.findall(f".//{NS}row"):
        if len(rows) >= MAX_ROWS:
            fail("worksheet exceeds row limit")
        row: list[str] = []
        for cell in row_element.findall(f"{NS}c"):
            if cell.find(f"{NS}f") is not None:
                fail(f"formula rejected at {cell.attrib.get('r', '?')}")
            index = column_index(cell.attrib.get("r", ""))
            if index >= MAX_COLUMNS:
                fail("worksheet exceeds column limit")
            while len(row) <= index:
                row.append("")
            value = cell.find(f"{NS}v")
            text = "" if value is None or value.text is None else value.text
            if len(text) > MAX_CELL_LENGTH:
                fail(f"cell exceeds length limit at {cell.attrib.get('r', '?')}")
            row[index] = text
        rows.append(row)
    if not rows:
        fail("worksheet is empty")
    headers = [value.strip() for value in rows[0]]
    if not all(headers) or len(set(headers)) != len(headers):
        fail("headers must be non-empty and unique")
    return [
        {headers[index]: (row[index].strip() if index < len(row) else "") for index in range(len(headers))}
        for row in rows[1:]
        if any(value.strip() for value in row)
    ]


if __name__ == "__main__":
    try:
        source = Path(sys.argv[1]).resolve(strict=True) if len(sys.argv) == 2 else None
        if source is None:
            fail("usage: parse-camera-catalog-xlsx.py FILE.xlsx")
        json.dump(parse(source), sys.stdout, ensure_ascii=False, indent=2)
        print()
    except (OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
