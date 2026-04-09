#!/usr/bin/env python3
"""
Round-trip fidelity test: read real .numbers files, recreate them from scratch,
then compare every cell. Exposes gaps in write capabilities.
"""

import sys
import json
import subprocess
import tempfile
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
BRIDGE = PROJECT_ROOT / "src" / "utils" / "numbers_reader.py"
PYTHON = PROJECT_ROOT / "venv" / "bin" / "python3"

# Files to test
TEST_FILES = [
    os.path.expanduser(
        "~/Library/Mobile Documents/com~apple~Numbers/Documents/2025 Personal Cash.numbers"
    ),
    os.path.expanduser(
        "~/Library/Mobile Documents/com~apple~Numbers/Documents/Superior Tech 2025 Budget and Staffing.numbers"
    ),
]


def run_bridge(command, args):
    """Run a bridge command and return parsed JSON."""
    result = subprocess.run(
        [str(PYTHON), str(BRIDGE), command] + args,
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        return {"error": result.stderr or result.stdout}
    try:
        data = json.loads(result.stdout.strip())
        if "error" in data:
            return data
        return data
    except json.JSONDecodeError:
        return {"error": f"Bad JSON: {result.stdout[:200]}"}


def read_all_data(filepath):
    """Read complete file structure and all cell data."""
    info = run_bridge("info", [filepath])
    if "error" in info:
        print(f"  ERROR reading info: {info['error']}")
        return None

    file_data = {
        "sheets": [],
        "defaultSheet": info.get("defaultSheet", ""),
    }

    for sheet_info in info["sheets"]:
        sheet_name = sheet_info["name"]
        sheet_data = {"name": sheet_name, "tables": []}

        for table_info in sheet_info["tables"]:
            table_name = table_info["name"]
            num_rows = table_info["numRows"]
            num_cols = table_info["numCols"]

            # Read all data including header row
            read_result = run_bridge("read", [
                filepath,
                "--sheet", sheet_name,
                "--table", table_name,
                "--include-header-row",
            ])

            if "error" in read_result:
                print(f"  ERROR reading {sheet_name}/{table_name}: {read_result['error']}")
                table_data = {
                    "name": table_name,
                    "numRows": num_rows,
                    "numCols": num_cols,
                    "rows": [],
                    "error": read_result["error"],
                }
            else:
                # Use row 0 values as raw headers (preserves None for empty cells)
                raw_headers = read_result["rows"][0] if read_result["rows"] else read_result["headers"]
                table_data = {
                    "name": table_name,
                    "numRows": num_rows,
                    "numCols": num_cols,
                    "headers": raw_headers,
                    "rows": read_result["rows"],
                }

            sheet_data["tables"].append(table_data)

        file_data["sheets"].append(sheet_data)

    return file_data


def recreate_file(file_data, output_path):
    """Recreate the file from scratch using bridge write commands."""
    errors = []

    if not file_data["sheets"]:
        errors.append("No sheets to recreate")
        return errors

    def _write_table(sheet_name, table, is_first_table_in_first_sheet=False):
        """Write a single table's data. Returns list of errors."""
        errs = []
        headers = table.get("headers", [None] * table["numCols"])
        all_rows = table.get("rows", [])
        data_rows = all_rows[1:] if len(all_rows) > 1 else []

        if is_first_table_in_first_sheet:
            # Create the file with this table
            result = run_bridge("create", [
                output_path,
                json.dumps(headers),
                "--sheet-name", sheet_name,
                "--table-name", table["name"],
            ])
            if "error" in result:
                errs.append(f"CREATE failed: {result['error']}")
                return errs
        else:
            # Add table to existing sheet
            result = run_bridge("add-table", [
                output_path,
                "--sheet", sheet_name,
                "--table-name", table["name"],
                "--headers", json.dumps(headers),
            ])
            if "error" in result:
                errs.append(f"ADD-TABLE {sheet_name}/{table['name']}: {result['error']}")
                return errs

        # Add data rows in batches
        if data_rows:
            BATCH_SIZE = 50
            for i in range(0, len(data_rows), BATCH_SIZE):
                batch = data_rows[i:i + BATCH_SIZE]
                result = run_bridge("add-rows", [
                    output_path,
                    json.dumps(batch),
                    "--sheet", sheet_name,
                    "--table", table["name"],
                ])
                if "error" in result:
                    errs.append(f"ADD-ROWS {sheet_name}/{table['name']} batch {i}: {result['error']}")

        return errs

    # First sheet, first table creates the file
    first_sheet = file_data["sheets"][0]
    first_table = first_sheet["tables"][0]
    errors.extend(_write_table(first_sheet["name"], first_table, is_first_table_in_first_sheet=True))

    # Remaining tables in first sheet
    for table in first_sheet["tables"][1:]:
        errors.extend(_write_table(first_sheet["name"], table))

    # Remaining sheets
    for sheet in file_data["sheets"][1:]:
        if not sheet["tables"]:
            continue

        first_t = sheet["tables"][0]
        ft_headers = first_t.get("headers", [None] * first_t["numCols"])

        result = run_bridge("add-sheet", [
            output_path,
            sheet["name"],
            "--table-name", first_t["name"],
            "--headers", json.dumps(ft_headers),
        ])
        if "error" in result:
            errors.append(f"ADD-SHEET {sheet['name']}: {result['error']}")
            continue

        # Add data for first table
        ft_rows = first_t.get("rows", [])
        data_rows = ft_rows[1:] if len(ft_rows) > 1 else []
        if data_rows:
            BATCH_SIZE = 50
            for i in range(0, len(data_rows), BATCH_SIZE):
                batch = data_rows[i:i + BATCH_SIZE]
                result = run_bridge("add-rows", [
                    output_path,
                    json.dumps(batch),
                    "--sheet", sheet["name"],
                    "--table", first_t["name"],
                ])
                if "error" in result:
                    errors.append(f"ADD-ROWS {sheet['name']}/{first_t['name']} batch {i}: {result['error']}")

        # Additional tables in this sheet
        for table in sheet["tables"][1:]:
            errors.extend(_write_table(sheet["name"], table))

    return errors


def compare_files(original_data, recreated_path):
    """Compare original data against recreated file, cell by cell."""
    recreated_data = read_all_data(recreated_path)
    if recreated_data is None:
        return ["Failed to read recreated file"]

    diffs = []

    # Compare sheet count
    orig_sheets = {s["name"]: s for s in original_data["sheets"]}
    rec_sheets = {s["name"]: s for s in recreated_data["sheets"]}

    for name in orig_sheets:
        if name not in rec_sheets:
            diffs.append(f"MISSING SHEET: '{name}'")
            continue

    for name in rec_sheets:
        if name not in orig_sheets:
            diffs.append(f"EXTRA SHEET: '{name}'")

    # Compare each sheet's tables
    for sheet_name, orig_sheet in orig_sheets.items():
        if sheet_name not in rec_sheets:
            continue
        rec_sheet = rec_sheets[sheet_name]

        orig_tables = {t["name"]: t for t in orig_sheet["tables"]}
        rec_tables = {t["name"]: t for t in rec_sheet["tables"]}

        for tname in orig_tables:
            if tname not in rec_tables:
                diffs.append(f"MISSING TABLE: '{sheet_name}/{tname}'")
                continue

        for tname in rec_tables:
            if tname not in orig_tables:
                diffs.append(f"EXTRA TABLE: '{sheet_name}/{tname}'")

        # Compare cell data
        for table_name, orig_table in orig_tables.items():
            if table_name not in rec_tables:
                continue
            rec_table = rec_tables[table_name]

            if "error" in orig_table:
                continue

            orig_rows = orig_table.get("rows", [])
            rec_rows = rec_table.get("rows", [])

            # Compare dimensions
            if len(orig_rows) != len(rec_rows):
                diffs.append(
                    f"ROW COUNT: '{sheet_name}/{table_name}' "
                    f"orig={len(orig_rows)} rec={len(rec_rows)}"
                )

            if orig_rows and rec_rows:
                orig_cols = len(orig_rows[0]) if orig_rows else 0
                rec_cols = len(rec_rows[0]) if rec_rows else 0
                if orig_cols != rec_cols:
                    diffs.append(
                        f"COL COUNT: '{sheet_name}/{table_name}' "
                        f"orig={orig_cols} rec={rec_cols}"
                    )

            # Compare cells
            max_rows = min(len(orig_rows), len(rec_rows))
            cell_diffs = 0
            cell_diff_samples = []
            for r in range(max_rows):
                max_cols = min(
                    len(orig_rows[r]) if r < len(orig_rows) else 0,
                    len(rec_rows[r]) if r < len(rec_rows) else 0,
                )
                for c in range(max_cols):
                    orig_val = orig_rows[r][c]
                    rec_val = rec_rows[r][c]

                    # Normalize for comparison
                    match = False
                    if orig_val == rec_val:
                        match = True
                    elif orig_val is None and rec_val is None:
                        match = True
                    elif isinstance(orig_val, (int, float)) and isinstance(rec_val, (int, float)):
                        if abs(orig_val - rec_val) < 0.01:
                            match = True
                    elif str(orig_val) == str(rec_val):
                        match = True
                    # Empty string vs None
                    elif (orig_val == "" and rec_val is None) or (orig_val is None and rec_val == ""):
                        match = True

                    if not match:
                        cell_diffs += 1
                        if len(cell_diff_samples) < 5:
                            cell_diff_samples.append(
                                f"  ({r},{c}): orig={repr(orig_val)} rec={repr(rec_val)}"
                            )

            if cell_diffs > 0:
                diffs.append(
                    f"CELL DIFFS: '{sheet_name}/{table_name}' — {cell_diffs} cells differ"
                )
                for sample in cell_diff_samples:
                    diffs.append(sample)

    return diffs


def test_file(filepath):
    """Run the full round-trip test on one file."""
    basename = Path(filepath).stem
    print(f"\n{'='*70}")
    print(f"TESTING: {basename}")
    print(f"{'='*70}")

    if not Path(filepath).exists():
        print(f"  SKIP: File not found")
        return

    # Step 1: Read original
    print(f"  Reading original...")
    original_data = read_all_data(filepath)
    if original_data is None:
        print(f"  FAIL: Could not read original file")
        return

    total_sheets = len(original_data["sheets"])
    total_tables = sum(len(s["tables"]) for s in original_data["sheets"])
    total_rows = sum(
        len(t.get("rows", []))
        for s in original_data["sheets"]
        for t in s["tables"]
    )
    print(f"  Structure: {total_sheets} sheets, {total_tables} tables, {total_rows} total rows")

    # Step 2: Recreate
    with tempfile.NamedTemporaryFile(suffix=".numbers", delete=False) as f:
        output_path = f.name

    try:
        print(f"  Recreating from scratch...")
        write_errors = recreate_file(original_data, output_path)
        if write_errors:
            print(f"  WRITE ERRORS ({len(write_errors)}):")
            for err in write_errors:
                print(f"    {err}")

        # Step 3: Compare
        print(f"  Comparing cell-by-cell...")
        diffs = compare_files(original_data, output_path)

        if not diffs and not write_errors:
            print(f"  PASS: Perfect round-trip fidelity")
        elif diffs:
            print(f"  DIFFERENCES ({len(diffs)}):")
            for diff in diffs:
                print(f"    {diff}")
        else:
            print(f"  PARTIAL: Write errors but no comparison diffs")

    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass


def main():
    print("Round-Trip Fidelity Test")
    print(f"Python: {PYTHON}")
    print(f"Bridge: {BRIDGE}")

    for filepath in TEST_FILES:
        test_file(filepath)

    print(f"\n{'='*70}")
    print("DONE")


if __name__ == "__main__":
    main()
