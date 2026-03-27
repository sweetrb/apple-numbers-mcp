#!/usr/bin/env python3
"""
Bridge script: reads .numbers files using numbers-parser and outputs JSON.
Called by the TypeScript MCP server via child_process.

Usage:
  python3 numbers_reader.py info <file_path>
  python3 numbers_reader.py read <file_path> [--sheet NAME] [--table NAME]
  python3 numbers_reader.py search <file_path> <query> [--sheet NAME]
  python3 numbers_reader.py export <file_path> <format> <output_path> [--sheet NAME] [--table NAME]
  python3 numbers_reader.py cell <file_path> <sheet> <table> <row> <col>
"""

import sys
import json
import argparse
from pathlib import Path

try:
    from numbers_parser import Document
except ImportError:
    print(json.dumps({
        "error": "numbers-parser not installed. Run: pip3 install numbers-parser"
    }))
    sys.exit(1)


def cell_to_serializable(cell):
    """Convert a numbers-parser cell to a JSON-serializable dict."""
    val = cell.value
    if val is None:
        return {"value": None, "type": "empty"}

    from datetime import datetime, date, time, timedelta
    if isinstance(val, bool):
        return {"value": val, "type": "boolean"}
    elif isinstance(val, (int, float)):
        return {"value": val, "type": "number"}
    elif isinstance(val, (datetime, date)):
        return {"value": val.isoformat(), "type": "date"}
    elif isinstance(val, time):
        return {"value": val.isoformat(), "type": "duration"}
    elif isinstance(val, timedelta):
        return {"value": str(val), "type": "duration"}
    elif isinstance(val, str):
        return {"value": val, "type": "string"}
    else:
        return {"value": str(val), "type": "string"}


def get_table_info(table, sheet_name):
    """Get metadata about a table."""
    headers = []
    if table.num_rows > 0:
        for col in range(table.num_cols):
            cell = table.cell(0, col)
            headers.append(str(cell.value) if cell.value is not None else f"Column_{col}")
    return {
        "name": table.name,
        "sheetName": sheet_name,
        "numRows": table.num_rows,
        "numCols": table.num_cols,
        "headerRow": headers,
    }


def cmd_info(args):
    """Get file structure: sheets, tables, dimensions."""
    doc = Document(args.file)
    sheets = []
    for sheet in doc.sheets:
        tables = [get_table_info(t, sheet.name) for t in sheet.tables]
        sheets.append({"name": sheet.name, "tables": tables})
    default_sheet = sheets[0]["name"] if sheets else ""
    dt = doc.default_table
    if dt:
        for s in doc.sheets:
            if any(t.name == dt.name for t in s.tables):
                default_sheet = s.name
                break
    result = {
        "path": str(Path(args.file).resolve()),
        "sheets": sheets,
        "defaultSheet": default_sheet,
    }
    print(json.dumps(result))


def cmd_read(args):
    """Read table data as rows."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)

    headers = []
    for col in range(table.num_cols):
        cell = table.cell(0, col)
        headers.append(str(cell.value) if cell.value is not None else f"Column_{col}")

    rows = []
    start_row = 1 if not args.include_header_row else 0
    for row_idx in range(start_row, table.num_rows):
        row = []
        for col_idx in range(table.num_cols):
            cell = table.cell(row_idx, col_idx)
            converted = cell_to_serializable(cell)
            row.append(converted["value"])
        rows.append(row)

    result = {
        "sheetName": sheet.name,
        "tableName": table.name,
        "headers": headers,
        "rows": rows,
        "numRows": len(rows),
        "numCols": table.num_cols,
    }
    print(json.dumps(result))


def cmd_search(args):
    """Search for a value across all cells."""
    doc = Document(args.file)
    query = args.query.lower()
    results = []
    sheets_to_search = [_find_sheet(doc, args.sheet)] if args.sheet else doc.sheets

    for sheet in sheets_to_search:
        for table in sheet.tables:
            headers = []
            for col in range(table.num_cols):
                cell = table.cell(0, col)
                headers.append(str(cell.value) if cell.value is not None else f"Column_{col}")
            for row_idx in range(table.num_rows):
                for col_idx in range(table.num_cols):
                    cell = table.cell(row_idx, col_idx)
                    if cell.value is not None and query in str(cell.value).lower():
                        results.append({
                            "sheetName": sheet.name,
                            "tableName": table.name,
                            "row": row_idx,
                            "col": col_idx,
                            "header": headers[col_idx] if col_idx < len(headers) else f"Column_{col_idx}",
                            "value": cell_to_serializable(cell)["value"],
                        })
    print(json.dumps({"results": results, "count": len(results)}))


def cmd_export(args):
    """Export a table to CSV, TSV, or JSON."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    output_path = Path(args.output)

    headers = []
    for col in range(table.num_cols):
        cell = table.cell(0, col)
        headers.append(str(cell.value) if cell.value is not None else f"Column_{col}")

    rows = []
    for row_idx in range(1, table.num_rows):
        row = []
        for col_idx in range(table.num_cols):
            cell = table.cell(row_idx, col_idx)
            row.append(cell_to_serializable(cell)["value"])
        rows.append(row)

    if args.format == "json":
        data = [dict(zip(headers, row)) for row in rows]
        output_path.write_text(json.dumps(data, indent=2, default=str))
    elif args.format in ("csv", "tsv"):
        import csv
        delimiter = "\t" if args.format == "tsv" else ","
        with open(output_path, "w", newline="") as f:
            writer = csv.writer(f, delimiter=delimiter)
            writer.writerow(headers)
            for row in rows:
                writer.writerow([str(v) if v is not None else "" for v in row])

    result = {
        "outputPath": str(output_path.resolve()),
        "format": args.format,
        "rowCount": len(rows),
        "sheetName": sheet.name,
        "tableName": table.name,
    }
    print(json.dumps(result))


def cmd_cell(args):
    """Read a single cell value."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    row, col = int(args.row), int(args.col)
    if row >= table.num_rows or col >= table.num_cols:
        print(json.dumps({"error": f"Cell ({row},{col}) out of range. Table is {table.num_rows}x{table.num_cols}"}))
        return
    cell = table.cell(row, col)
    result = cell_to_serializable(cell)
    result["row"] = row
    result["col"] = col
    print(json.dumps(result))


def _find_sheet(doc, sheet_name=None):
    if not sheet_name:
        return doc.sheets[0]
    for s in doc.sheets:
        if s.name.lower() == sheet_name.lower():
            return s
    names = [s.name for s in doc.sheets]
    raise ValueError(f"Sheet '{sheet_name}' not found. Available: {names}")


def _find_table(sheet, table_name=None):
    if not table_name:
        return sheet.tables[0]
    for t in sheet.tables:
        if t.name.lower() == table_name.lower():
            return t
    names = [t.name for t in sheet.tables]
    raise ValueError(f"Table '{table_name}' not found in sheet '{sheet.name}'. Available: {names}")


def main():
    parser = argparse.ArgumentParser(description="Apple Numbers file reader")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # info
    p_info = subparsers.add_parser("info")
    p_info.add_argument("file")

    # read
    p_read = subparsers.add_parser("read")
    p_read.add_argument("file")
    p_read.add_argument("--sheet", default=None)
    p_read.add_argument("--table", default=None)
    p_read.add_argument("--include-header-row", action="store_true")

    # search
    p_search = subparsers.add_parser("search")
    p_search.add_argument("file")
    p_search.add_argument("query")
    p_search.add_argument("--sheet", default=None)

    # export
    p_export = subparsers.add_parser("export")
    p_export.add_argument("file")
    p_export.add_argument("format", choices=["csv", "tsv", "json"])
    p_export.add_argument("output")
    p_export.add_argument("--sheet", default=None)
    p_export.add_argument("--table", default=None)

    # cell
    p_cell = subparsers.add_parser("cell")
    p_cell.add_argument("file")
    p_cell.add_argument("sheet")
    p_cell.add_argument("table")
    p_cell.add_argument("row")
    p_cell.add_argument("col")

    args = parser.parse_args()
    try:
        {"info": cmd_info, "read": cmd_read, "search": cmd_search,
         "export": cmd_export, "cell": cmd_cell}[args.command](args)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
