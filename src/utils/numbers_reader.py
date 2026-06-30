#!/usr/bin/env python3
"""
Bridge script: reads and writes .numbers files using numbers-parser and outputs JSON.
Called by the TypeScript MCP server via child_process.
"""

import sys
import json
import argparse
import os
from pathlib import Path

try:
    from numbers_parser import Document
except ImportError:
    print(json.dumps({
        "error": "numbers-parser not installed. Run: npm run setup"
    }))
    sys.exit(1)


def _atomic_save(doc, path):
    """Save a .numbers document atomically.

    numbers-parser's Document.save() rewrites the entire .numbers archive; an
    interrupted or failed save in place can leave the user's only copy
    truncated or corrupt (and several mutations, e.g. delete-rows, are not
    undoable). Because a .numbers file is a single zip archive, we write to a
    sibling temp file and os.replace() it onto the target — atomic on the same
    filesystem — so on any failure the original file is left untouched.
    """
    target = Path(path)
    tmp = target.parent / f".{target.stem}.tmp-{os.getpid()}.numbers"
    try:
        doc.save(str(tmp))
        os.replace(str(tmp), str(target))
    except BaseException:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        raise


def cell_to_serializable(cell):
    """Convert a numbers-parser cell to a JSON-serializable dict."""
    val = cell.value
    if val is None:
        return {"value": None, "type": "empty"}

    from datetime import datetime, date, time, timedelta
    if isinstance(val, bool):
        return {"value": val, "type": "boolean"}
    elif isinstance(val, (int, float)):
        # Round floats that are within epsilon of an integer
        if isinstance(val, float):
            rounded = round(val)
            if abs(val - rounded) < 1e-9:
                val = rounded
        return {"value": val, "type": "number"}
    elif isinstance(val, (datetime, date)):
        iso = val.isoformat()
        # Strip T00:00:00 from pure dates (no meaningful time component)
        if isinstance(val, datetime) and val.hour == 0 and val.minute == 0 and val.second == 0 and val.microsecond == 0:
            iso = val.date().isoformat()
        return {"value": iso, "type": "date"}
    elif isinstance(val, time):
        return {"value": val.isoformat(), "type": "duration"}
    elif isinstance(val, timedelta):
        return {"value": str(val), "type": "duration"}
    elif isinstance(val, str):
        return {"value": val, "type": "string"}
    else:
        return {"value": str(val), "type": "string"}


def _format_cell_value(val):
    """Format a raw cell value as a clean string (for headers, etc.)."""
    if val is None:
        return None
    from datetime import datetime, date
    if isinstance(val, datetime) and val.hour == 0 and val.minute == 0 and val.second == 0 and val.microsecond == 0:
        return val.date().isoformat()
    if isinstance(val, date):
        return val.isoformat()
    if isinstance(val, float):
        rounded = round(val)
        if abs(val - rounded) < 1e-9:
            return str(rounded)
    return str(val)


def get_table_info(table, sheet_name):
    """Get metadata about a table."""
    headers = []
    if table.num_rows > 0:
        for col in range(table.num_cols):
            cell = table.cell(0, col)
            formatted = _format_cell_value(cell.value)
            headers.append(formatted if formatted is not None else f"Column_{col}")
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
    """Read table data as rows, with optional range filtering."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)

    # Determine column indices to include
    col_indices = list(range(table.num_cols))
    if args.columns:
        requested = json.loads(args.columns)
        col_indices = []
        all_headers = []
        for c in range(table.num_cols):
            cell = table.cell(0, c)
            formatted = _format_cell_value(cell.value)
            all_headers.append(formatted if formatted is not None else f"Column_{c}")
        for col_ref in requested:
            if isinstance(col_ref, int):
                col_indices.append(col_ref)
            elif isinstance(col_ref, str):
                # Match by header name (case-insensitive)
                found = False
                for idx, h in enumerate(all_headers):
                    if h.lower() == col_ref.lower():
                        col_indices.append(idx)
                        found = True
                        break
                if not found:
                    raise ValueError(f"Column '{col_ref}' not found. Available: {all_headers}")

    headers = []
    for col in col_indices:
        cell = table.cell(0, col)
        formatted = _format_cell_value(cell.value)
        headers.append(formatted if formatted is not None else f"Column_{col}")

    # Determine row range
    default_start = 0 if args.include_header_row else 1
    start_row = int(args.start_row) if args.start_row is not None else default_start
    end_row = int(args.end_row) if args.end_row is not None else table.num_rows - 1

    rows = []
    for row_idx in range(start_row, min(end_row + 1, table.num_rows)):
        row = []
        for col_idx in col_indices:
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
        "numCols": len(col_indices),
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
                formatted = _format_cell_value(cell.value)
                headers.append(formatted if formatted is not None else f"Column_{col}")
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
        formatted = _format_cell_value(cell.value)
        headers.append(formatted if formatted is not None else f"Column_{col}")

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
    """Read a single cell value, optionally with metadata."""
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
    if args.verbose:
        result["formula"] = getattr(cell, "formula", None)
        result["isFormula"] = getattr(cell, "is_formula", False)
        result["isMerged"] = getattr(cell, "is_merged", False)
        fv = getattr(cell, "formatted_value", None)
        result["formattedValue"] = str(fv) if fv is not None else None
    print(json.dumps(result))


def _coerce_value(raw, type_hint=None, where=None):
    """Coerce a JSON value to the appropriate Python type for writing.

    `where` is an optional human-readable location (e.g. "cell (3,2)") that is
    woven into error messages so a bad value points the caller at the offending
    cell instead of surfacing a raw "could not convert string to float" error.
    """
    loc = f" at {where}" if where else ""
    if raw is None:
        return None
    if type_hint == "boolean" or (type_hint is None and isinstance(raw, bool)):
        return bool(raw)
    if type_hint == "number" or (type_hint is None and isinstance(raw, (int, float))):
        if isinstance(raw, float) and raw == int(raw):
            return int(raw)
        if isinstance(raw, (int, float)):
            return raw
        try:
            return float(raw)
        except (TypeError, ValueError):
            raise ValueError(
                f"Cannot write value {raw!r}{loc} as a number. "
                f"Provide a numeric value, or omit type=\"number\" to store it as text."
            )
    if type_hint == "date":
        from datetime import datetime
        if isinstance(raw, str):
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                raise ValueError(
                    f"Cannot write value {raw!r}{loc} as a date. "
                    f"Dates must be ISO 8601 (e.g. \"2025-06-01\" or a full ISO datetime)."
                )
        return raw
    # Default: string
    return str(raw)


def cmd_create(args):
    """Create a new .numbers file with headers and optional data rows."""
    headers = json.loads(args.headers)
    rows = json.loads(args.rows) if args.rows else []
    num_rows = 1 + len(rows)  # header row + data rows
    num_cols = len(headers)

    doc = Document(num_rows=num_rows, num_cols=num_cols)
    sheet = doc.sheets[0]
    if args.sheet_name:
        sheet.name = args.sheet_name
    table = sheet.tables[0]
    if args.table_name:
        table.name = args.table_name

    for col_idx, header in enumerate(headers):
        if header is not None:
            if header is not None:
                table.write(0, col_idx, str(header))

    rows_written = 0
    for row_idx, row in enumerate(rows, start=1):
        for col_idx, val in enumerate(row):
            coerced = _coerce_value(val, where=f"cell ({row_idx},{col_idx})")
            if coerced is not None:
                table.write(row_idx, col_idx, coerced)
        rows_written += 1

    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "numHeaders": len(headers),
        "numRows": rows_written,
    }
    print(json.dumps(result))


def cmd_set_cell(args):
    """Write a single cell value in an existing file."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    row, col = int(args.row), int(args.col)
    value = _coerce_value(json.loads(args.value), args.type, where=f"cell ({row},{col})")
    if value is not None:
        table.write(row, col, value)
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "row": row,
        "col": col,
        "value": str(value),
    }
    print(json.dumps(result))


def cmd_set_cells(args):
    """Write multiple cell values in one operation."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    updates = json.loads(args.updates)
    cells_written = 0
    for upd in updates:
        row, col = int(upd["row"]), int(upd["col"])
        value = _coerce_value(upd["value"], upd.get("type"), where=f"cell ({row},{col})")
        if value is not None:
            table.write(row, col, value)
        cells_written += 1
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "cellsWritten": cells_written,
    }
    print(json.dumps(result))


def cmd_add_rows(args):
    """Append rows of data to an existing table."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    rows = json.loads(args.rows)
    start_row = table.num_rows
    for row_offset, row in enumerate(rows):
        has_value = False
        for col_idx, val in enumerate(row):
            coerced = _coerce_value(val, where=f"cell ({start_row + row_offset},{col_idx})")
            if coerced is not None:
                table.write(start_row + row_offset, col_idx, coerced)
                has_value = True
        # Ensure empty rows still expand the table
        if not has_value:
            table.write(start_row + row_offset, 0, "")
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "rowsAdded": len(rows),
        "startRow": start_row,
        "newTotalRows": table.num_rows,
    }
    print(json.dumps(result))


def cmd_delete_rows(args):
    """Delete rows from a table by index range."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    start_row = int(args.start_row)
    end_row = int(args.end_row)
    if start_row > end_row:
        raise ValueError(f"start_row ({start_row}) must be <= end_row ({end_row})")
    if start_row >= table.num_rows or end_row >= table.num_rows:
        raise ValueError(f"Row range [{start_row},{end_row}] out of bounds. Table has {table.num_rows} rows.")
    num_to_delete = end_row - start_row + 1
    # delete_row(num_rows, start_row) deletes num_rows starting at start_row
    table.delete_row(num_to_delete, start_row)
    rows_deleted = num_to_delete
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "rowsDeleted": rows_deleted,
        "newTotalRows": table.num_rows,
    }
    print(json.dumps(result))


def cmd_add_sheet(args):
    """Add a new sheet to an existing file."""
    doc = Document(args.file)
    headers = json.loads(args.headers) if args.headers else None
    num_rows = int(args.num_rows) if args.num_rows else (1 if headers else 12)
    num_cols = int(args.num_cols) if args.num_cols else (len(headers) if headers else 8)
    doc.add_sheet(args.sheet_name, num_rows=num_rows, num_cols=num_cols)
    sheet = doc.sheets[-1]
    table = sheet.tables[0]
    if args.table_name:
        table.name = args.table_name
    if headers:
        for col_idx, header in enumerate(headers):
            if header is not None:
                table.write(0, col_idx, str(header))
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "numRows": table.num_rows,
        "numCols": table.num_cols,
    }
    print(json.dumps(result))


def cmd_add_table(args):
    """Add a new table to an existing sheet."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    headers = json.loads(args.headers) if args.headers else None
    num_rows = int(args.num_rows) if args.num_rows else (1 if headers else 12)
    num_cols = int(args.num_cols) if args.num_cols else (len(headers) if headers else 8)
    table_name = args.table_name or None
    sheet.add_table(table_name, num_rows=num_rows, num_cols=num_cols)
    table = sheet.tables[-1]
    if headers:
        for col_idx, header in enumerate(headers):
            if header is not None:
                table.write(0, col_idx, str(header))
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "numRows": table.num_rows,
        "numCols": table.num_cols,
    }
    print(json.dumps(result))


def cmd_import(args):
    """Import a CSV/TSV/JSON file into a new .numbers file."""
    import csv as csv_mod
    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    fmt = args.format
    if fmt == "auto":
        ext = input_path.suffix.lower()
        fmt = {"csv": "csv", ".csv": "csv", ".tsv": "tsv", ".json": "json"}.get(ext, "csv")

    headers = []
    rows = []
    if fmt in ("csv", "tsv"):
        delimiter = "\t" if fmt == "tsv" else ","
        with open(input_path, newline="", encoding="utf-8") as f:
            reader = csv_mod.reader(f, delimiter=delimiter)
            headers = next(reader, [])
            for row in reader:
                converted = []
                for val in row:
                    converted.append(_auto_convert(val))
                rows.append(converted)
    elif fmt == "json":
        data = json.loads(input_path.read_text(encoding="utf-8"))
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
            headers = list(data[0].keys())
            for item in data:
                rows.append([item.get(h) for h in headers])
        elif isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
            headers = [f"Column_{i}" for i in range(len(data[0]))]
            rows = data
        else:
            raise ValueError("JSON must be an array of objects or array of arrays")

    num_rows = 1 + len(rows)
    num_cols = len(headers) if headers else 1
    doc = Document(num_rows=num_rows, num_cols=num_cols)
    sheet = doc.sheets[0]
    if args.sheet_name:
        sheet.name = args.sheet_name
    table = sheet.tables[0]
    if args.table_name:
        table.name = args.table_name

    for col_idx, header in enumerate(headers):
        table.write(0, col_idx, str(header))
    for row_idx, row in enumerate(rows, start=1):
        for col_idx, val in enumerate(row):
            coerced = _coerce_value(val)
            if coerced is not None:
                table.write(row_idx, col_idx, coerced)

    _atomic_save(doc, args.output)
    result = {
        "path": str(Path(args.output).resolve()),
        "inputPath": str(input_path.resolve()),
        "format": fmt,
        "sheetName": sheet.name,
        "tableName": table.name,
        "numHeaders": len(headers),
        "numRows": len(rows),
    }
    print(json.dumps(result))


def _auto_convert(val):
    """Try to convert a CSV string value to its natural type."""
    if val == "":
        return None
    if val.lower() in ("true", "false"):
        return val.lower() == "true"
    try:
        iv = int(val)
        return iv
    except ValueError:
        pass
    try:
        fv = float(val)
        return fv
    except ValueError:
        pass
    return val


def cmd_update_rows(args):
    """Write full rows by index."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    updates = json.loads(args.updates)
    rows_updated = 0
    for upd in updates:
        row_idx = int(upd["row"])
        values = upd["values"]
        for col_idx, val in enumerate(values):
            coerced = _coerce_value(val, where=f"cell ({row_idx},{col_idx})")
            if coerced is not None:
                table.write(row_idx, col_idx, coerced)
        rows_updated += 1
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "tableName": table.name,
        "rowsUpdated": rows_updated,
    }
    print(json.dumps(result))


def cmd_rename_sheet(args):
    """Rename a sheet."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    old_name = sheet.name
    sheet.name = args.new_name
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "oldName": old_name,
        "newName": sheet.name,
    }
    print(json.dumps(result))


def cmd_rename_table(args):
    """Rename a table."""
    doc = Document(args.file)
    sheet = _find_sheet(doc, args.sheet)
    table = _find_table(sheet, args.table)
    old_name = table.name
    table.name = args.new_name
    _atomic_save(doc, args.file)
    result = {
        "path": str(Path(args.file).resolve()),
        "sheetName": sheet.name,
        "oldName": old_name,
        "newName": table.name,
    }
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
    p_read.add_argument("--start-row", default=None, help="Start row index (0-based, inclusive)")
    p_read.add_argument("--end-row", default=None, help="End row index (0-based, inclusive)")
    p_read.add_argument("--columns", default=None, help="JSON array of column indices or header names")

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
    p_cell.add_argument("--verbose", action="store_true")

    # create
    p_create = subparsers.add_parser("create")
    p_create.add_argument("file")
    p_create.add_argument("headers", help="JSON array of header strings")
    p_create.add_argument("--sheet-name", default=None)
    p_create.add_argument("--table-name", default=None)
    p_create.add_argument("--rows", default=None, help="JSON array of row arrays")

    # set-cell
    p_set_cell = subparsers.add_parser("set-cell")
    p_set_cell.add_argument("file")
    p_set_cell.add_argument("row")
    p_set_cell.add_argument("col")
    p_set_cell.add_argument("value", help="JSON-encoded value")
    p_set_cell.add_argument("--sheet", default=None)
    p_set_cell.add_argument("--table", default=None)
    p_set_cell.add_argument("--type", default=None, choices=["string", "number", "boolean", "date"])

    # set-cells
    p_set_cells = subparsers.add_parser("set-cells")
    p_set_cells.add_argument("file")
    p_set_cells.add_argument("updates", help="JSON array of {row, col, value, type?}")
    p_set_cells.add_argument("--sheet", default=None)
    p_set_cells.add_argument("--table", default=None)

    # add-rows
    p_add_rows = subparsers.add_parser("add-rows")
    p_add_rows.add_argument("file")
    p_add_rows.add_argument("rows", help="JSON array of row arrays")
    p_add_rows.add_argument("--sheet", default=None)
    p_add_rows.add_argument("--table", default=None)

    # delete-rows
    p_del_rows = subparsers.add_parser("delete-rows")
    p_del_rows.add_argument("file")
    p_del_rows.add_argument("start_row")
    p_del_rows.add_argument("end_row")
    p_del_rows.add_argument("--sheet", default=None)
    p_del_rows.add_argument("--table", default=None)

    # add-sheet
    p_add_sheet = subparsers.add_parser("add-sheet")
    p_add_sheet.add_argument("file")
    p_add_sheet.add_argument("sheet_name")
    p_add_sheet.add_argument("--table-name", default=None)
    p_add_sheet.add_argument("--headers", default=None, help="JSON array of header strings")
    p_add_sheet.add_argument("--num-rows", default=None)
    p_add_sheet.add_argument("--num-cols", default=None)

    # add-table
    p_add_table = subparsers.add_parser("add-table")
    p_add_table.add_argument("file")
    p_add_table.add_argument("--sheet", default=None)
    p_add_table.add_argument("--table-name", default=None)
    p_add_table.add_argument("--headers", default=None, help="JSON array of header strings")
    p_add_table.add_argument("--num-rows", default=None)
    p_add_table.add_argument("--num-cols", default=None)

    # import
    p_import = subparsers.add_parser("import")
    p_import.add_argument("input", help="Path to CSV/TSV/JSON file")
    p_import.add_argument("output", help="Path for output .numbers file")
    p_import.add_argument("--format", default="auto", choices=["auto", "csv", "tsv", "json"])
    p_import.add_argument("--sheet-name", default=None)
    p_import.add_argument("--table-name", default=None)

    # update-rows
    p_upd_rows = subparsers.add_parser("update-rows")
    p_upd_rows.add_argument("file")
    p_upd_rows.add_argument("updates", help='JSON array of {row, values: [...]}')
    p_upd_rows.add_argument("--sheet", default=None)
    p_upd_rows.add_argument("--table", default=None)

    # rename-sheet
    p_ren_sheet = subparsers.add_parser("rename-sheet")
    p_ren_sheet.add_argument("file")
    p_ren_sheet.add_argument("new_name")
    p_ren_sheet.add_argument("--sheet", default=None)

    # rename-table
    p_ren_table = subparsers.add_parser("rename-table")
    p_ren_table.add_argument("file")
    p_ren_table.add_argument("new_name")
    p_ren_table.add_argument("--sheet", default=None)
    p_ren_table.add_argument("--table", default=None)

    args = parser.parse_args()
    commands = {
        "info": cmd_info, "read": cmd_read, "search": cmd_search,
        "export": cmd_export, "cell": cmd_cell, "create": cmd_create,
        "set-cell": cmd_set_cell, "set-cells": cmd_set_cells,
        "add-rows": cmd_add_rows, "delete-rows": cmd_delete_rows,
        "add-sheet": cmd_add_sheet, "add-table": cmd_add_table,
        "import": cmd_import, "update-rows": cmd_update_rows,
        "rename-sheet": cmd_rename_sheet, "rename-table": cmd_rename_table,
    }
    try:
        commands[args.command](args)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
