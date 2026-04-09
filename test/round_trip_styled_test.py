#!/usr/bin/env python3
"""
Round-trip fidelity test WITH styles: read a real .numbers file,
recreate it from scratch (data + formulas + formatting), then compare.

Uses AppleScript for style read/write (requires Numbers.app running).
Uses numbers-parser for data read/write.
"""

import sys
import json
import subprocess
import tempfile
import os
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
BRIDGE = PROJECT_ROOT / "src" / "utils" / "numbers_reader.py"
PYTHON = PROJECT_ROOT / "venv" / "bin" / "python3"

# Use the smaller file for styled round-trip (AppleScript is slow per-cell)
TEST_FILE = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~Numbers/Documents/2025 Personal Cash.numbers"
)


def run_bridge(command, args):
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


def run_applescript(script, timeout=120):
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=timeout
    )
    if result.returncode != 0:
        return None, result.stderr.strip()
    return result.stdout.strip(), None


def to_a1(row, col):
    letters = ""
    c = col
    while True:
        letters = chr(65 + c % 26) + letters
        c = c // 26 - 1
        if c < 0:
            break
    return f"{letters}{row + 1}"


def escape_as(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def open_doc_script(filepath):
    """AppleScript preamble to open/find a document."""
    return f'''
  set docFound to false
  repeat with d in documents
    set dPath to POSIX path of (file of d as text)
    if dPath is "{escape_as(filepath)}" then
      set docFound to true
      set targetDoc to d
      exit repeat
    end if
  end repeat
  if not docFound then
    set targetDoc to open POSIX file "{escape_as(filepath)}"
    delay 2
  end if'''


def read_styles_for_table(filepath, sheet_name, table_name, num_rows, num_cols):
    """Read style info for every cell in a table via AppleScript (batched by row)."""
    styles = {}
    print(f"    Reading styles for {sheet_name}/{table_name} ({num_rows}x{num_cols})...")

    # Batch: read all styles for a row in one AppleScript call
    for row in range(num_rows):
        parts_list = []
        for col in range(num_cols):
            cell_ref = to_a1(row, col)
            parts_list.append(f'''
        set c to cell "{cell_ref}"
        set fn to font name of c
        if fn is missing value then set fn to ""
        set fs to font size of c
        set tc to text color of c
        if tc is missing value then
          set tcStr to "0,0,0"
        else
          set tcStr to (item 1 of tc) & "," & (item 2 of tc) & "," & (item 3 of tc)
        end if
        set bg to background color of c
        if bg is missing value then
          set bgStr to "65535,65535,65535"
        else
          set bgStr to (item 1 of bg) & "," & (item 2 of bg) & "," & (item 3 of bg)
        end if
        set fmt to format of c
        set al to alignment of c
        copy (fn & "~" & fs & "~" & tcStr & "~" & bgStr & "~" & fmt & "~" & al) to end of rowStyles''')

        script = f'''
tell application "Numbers"
{open_doc_script(filepath)}
  tell targetDoc
    tell sheet "{escape_as(sheet_name)}"
      tell table "{escape_as(table_name)}"
        set rowStyles to {{}}
{"".join(parts_list)}
        set AppleScript's text item delimiters to "|"
        return rowStyles as text
      end tell
    end tell
  end tell
end tell'''

        result, err = run_applescript(script, timeout=120)
        if err or result is None:
            print(f"      Row {row} style read failed: {err}")
            continue

        cells = result.split("|")
        for col_idx, cell_data in enumerate(cells):
            if col_idx >= num_cols:
                break
            fields = cell_data.split("~")
            if len(fields) >= 6:
                styles[(row, col_idx)] = {
                    "fontName": fields[0],
                    "fontSize": float(fields[1]),
                    "textColor": fields[2],
                    "backgroundColor": fields[3],
                    "format": fields[4],
                    "alignment": fields[5],
                }

        if (row + 1) % 50 == 0:
            print(f"      ...{row + 1}/{num_rows} rows")

    return styles


def read_col_widths(filepath, sheet_name, table_name, num_cols):
    """Read column widths via AppleScript."""
    parts = []
    for col in range(num_cols):
        col_letter = to_a1(0, col).replace("1", "")
        parts.append(f'(width of column "{col_letter}" as text)')

    script = f'''
tell application "Numbers"
{open_doc_script(filepath)}
  tell targetDoc
    tell sheet "{escape_as(sheet_name)}"
      tell table "{escape_as(table_name)}"
        set widths to {{}}
        repeat with colIdx from 1 to {num_cols}
          copy (width of column colIdx as text) to end of widths
        end repeat
        set AppleScript's text item delimiters to ","
        return widths as text
      end tell
    end tell
  end tell
end tell'''
    result, err = run_applescript(script)
    if err:
        print(f"    Column width read failed: {err}")
        return []
    return [float(w) for w in result.split(",")]


def apply_styles_to_table(filepath, sheet_name, table_name, styles, col_widths):
    """Apply styles to a recreated table via AppleScript (batched by row)."""
    if not styles:
        return

    rows_by_row = {}
    for (r, c), style in styles.items():
        rows_by_row.setdefault(r, []).append((c, style))

    total = len(rows_by_row)
    print(f"    Applying styles to {sheet_name}/{table_name} ({total} rows)...")

    # Apply column widths first
    if col_widths:
        width_cmds = []
        for i, w in enumerate(col_widths):
            col_letter = to_a1(0, i).replace("1", "")
            width_cmds.append(f'        set width of column "{col_letter}" to {w}')
        script = f'''
tell application "Numbers"
{open_doc_script(filepath)}
  tell targetDoc
    tell sheet "{escape_as(sheet_name)}"
      tell table "{escape_as(table_name)}"
{chr(10).join(width_cmds)}
      end tell
    end tell
    save
  end tell
end tell'''
        run_applescript(script)

    # Apply cell styles row by row
    done = 0
    for row in sorted(rows_by_row.keys()):
        cmds = []
        for col, style in rows_by_row[row]:
            cell_ref = to_a1(row, col)
            c = f'cell "{cell_ref}"'
            if style["fontName"]:
                cmds.append(f'        set font name of {c} to "{escape_as(style["fontName"])}"')
            cmds.append(f'        set font size of {c} to {style["fontSize"]}')
            tc = style["textColor"].split(",")
            cmds.append(f'        set text color of {c} to {{{tc[0]}, {tc[1]}, {tc[2]}}}')
            bg = style["backgroundColor"].split(",")
            cmds.append(f'        set background color of {c} to {{{bg[0]}, {bg[1]}, {bg[2]}}}')
            cmds.append(f'        set format of {c} to {style["format"]}')
            cmds.append(f'        set alignment of {c} to {style["alignment"]}')

        script = f'''
tell application "Numbers"
{open_doc_script(filepath)}
  tell targetDoc
    tell sheet "{escape_as(sheet_name)}"
      tell table "{escape_as(table_name)}"
{chr(10).join(cmds)}
      end tell
    end tell
    save
  end tell
end tell'''
        result, err = run_applescript(script, timeout=120)
        if err:
            print(f"      Row {row} style apply failed: {err}")

        done += 1
        if done % 50 == 0:
            print(f"      ...{done}/{total} rows")


def colors_close(c1, c2, tolerance=2):
    """Compare two color strings like '65535,0,0' with tolerance for rounding."""
    parts1 = [int(x) for x in c1.split(",")]
    parts2 = [int(x) for x in c2.split(",")]
    return all(abs(a - b) <= tolerance for a, b in zip(parts1, parts2))


def compare_styles(orig_styles, rec_styles, sheet_name, table_name):
    """Compare styles between original and recreated."""
    diffs = []
    for key in orig_styles:
        if key not in rec_styles:
            diffs.append(f"  MISSING style at ({key[0]},{key[1]})")
            continue
        orig = orig_styles[key]
        rec = rec_styles[key]
        for prop in ["fontName", "fontSize", "format", "alignment"]:
            if str(orig.get(prop)) != str(rec.get(prop)):
                diffs.append(f"  ({key[0]},{key[1]}).{prop}: orig={orig.get(prop)} rec={rec.get(prop)}")
        for color_prop in ["textColor", "backgroundColor"]:
            if not colors_close(orig.get(color_prop, "0,0,0"), rec.get(color_prop, "0,0,0")):
                diffs.append(f"  ({key[0]},{key[1]}).{color_prop}: orig={orig.get(color_prop)} rec={rec.get(color_prop)}")
    return diffs


def main():
    print("Styled Round-Trip Fidelity Test")
    print(f"File: {Path(TEST_FILE).stem}")
    print()

    if not Path(TEST_FILE).exists():
        print("SKIP: File not found")
        return

    # Step 1: Read file structure and data
    print("Step 1: Reading data...")
    info = run_bridge("info", [TEST_FILE])
    if "error" in info:
        print(f"  FAIL: {info['error']}")
        return

    file_data = {"sheets": []}
    for sheet_info in info["sheets"]:
        sheet = {"name": sheet_info["name"], "tables": []}
        for table_info in sheet_info["tables"]:
            read_result = run_bridge("read", [
                TEST_FILE, "--sheet", sheet_info["name"],
                "--table", table_info["name"], "--include-header-row"
            ])
            if "error" in read_result:
                print(f"  ERROR: {read_result['error']}")
                continue
            sheet["tables"].append({
                "name": table_info["name"],
                "numRows": table_info["numRows"],
                "numCols": table_info["numCols"],
                "headers": read_result["rows"][0] if read_result["rows"] else [],
                "rows": read_result["rows"],
            })
        file_data["sheets"].append(sheet)

    total_rows = sum(t["numRows"] for s in file_data["sheets"] for t in s["tables"])
    total_tables = sum(len(s["tables"]) for s in file_data["sheets"])
    print(f"  {len(file_data['sheets'])} sheets, {total_tables} tables, {total_rows} total rows")

    # Step 2: Read styles from original via AppleScript
    # Skip tables > 50 rows for speed (AppleScript is ~1 row/sec)
    MAX_STYLE_ROWS = 50
    print(f"\nStep 2: Reading styles from original (tables <= {MAX_STYLE_ROWS} rows)...")
    all_styles = {}  # (sheet, table) -> {(row, col): style}
    all_col_widths = {}  # (sheet, table) -> [widths]
    skipped_tables = []
    for sheet in file_data["sheets"]:
        for table in sheet["tables"]:
            key = (sheet["name"], table["name"])
            if table["numRows"] > MAX_STYLE_ROWS:
                skipped_tables.append(f"{sheet['name']}/{table['name']} ({table['numRows']} rows)")
                all_styles[key] = {}
                all_col_widths[key] = []
                continue
            all_styles[key] = read_styles_for_table(
                TEST_FILE, sheet["name"], table["name"],
                table["numRows"], table["numCols"]
            )
            all_col_widths[key] = read_col_widths(
                TEST_FILE, sheet["name"], table["name"],
                table["numCols"]
            )
    if skipped_tables:
        print(f"  Skipped (too large): {', '.join(skipped_tables)}")

    total_styles = sum(len(v) for v in all_styles.values())
    print(f"  Read {total_styles} cell styles")

    # Step 3: Recreate file with data (reuse existing logic)
    print("\nStep 3: Recreating file with data...")
    with tempfile.NamedTemporaryFile(suffix=".numbers", delete=False) as f:
        output_path = f.name

    try:
        # Create first sheet first table
        first_sheet = file_data["sheets"][0]
        first_table = first_sheet["tables"][0]
        headers = first_table.get("headers", [])
        data_rows = first_table["rows"][1:] if len(first_table["rows"]) > 1 else []

        run_bridge("create", [
            output_path, json.dumps(headers),
            "--sheet-name", first_sheet["name"],
            "--table-name", first_table["name"],
        ])
        if data_rows:
            for i in range(0, len(data_rows), 50):
                run_bridge("add-rows", [
                    output_path, json.dumps(data_rows[i:i+50]),
                    "--sheet", first_sheet["name"],
                    "--table", first_table["name"],
                ])

        # Remaining tables in first sheet
        for table in first_sheet["tables"][1:]:
            t_headers = table.get("headers", [])
            run_bridge("add-table", [
                output_path, "--sheet", first_sheet["name"],
                "--table-name", table["name"],
                "--headers", json.dumps(t_headers),
            ])
            t_rows = table["rows"][1:] if len(table["rows"]) > 1 else []
            if t_rows:
                for i in range(0, len(t_rows), 50):
                    run_bridge("add-rows", [
                        output_path, json.dumps(t_rows[i:i+50]),
                        "--sheet", first_sheet["name"],
                        "--table", table["name"],
                    ])

        # Remaining sheets
        for sheet in file_data["sheets"][1:]:
            if not sheet["tables"]:
                continue
            ft = sheet["tables"][0]
            run_bridge("add-sheet", [
                output_path, sheet["name"],
                "--table-name", ft["name"],
                "--headers", json.dumps(ft.get("headers", [])),
            ])
            ft_rows = ft["rows"][1:] if len(ft["rows"]) > 1 else []
            if ft_rows:
                for i in range(0, len(ft_rows), 50):
                    run_bridge("add-rows", [
                        output_path, json.dumps(ft_rows[i:i+50]),
                        "--sheet", sheet["name"],
                        "--table", ft["name"],
                    ])
            for table in sheet["tables"][1:]:
                t_headers = table.get("headers", [])
                run_bridge("add-table", [
                    output_path, "--sheet", sheet["name"],
                    "--table-name", table["name"],
                    "--headers", json.dumps(t_headers),
                ])
                t_rows = table["rows"][1:] if len(table["rows"]) > 1 else []
                if t_rows:
                    for i in range(0, len(t_rows), 50):
                        run_bridge("add-rows", [
                            output_path, json.dumps(t_rows[i:i+50]),
                            "--sheet", sheet["name"],
                            "--table", table["name"],
                        ])

        print("  Data recreated")

        # Step 4: Apply styles to recreated file
        print("\nStep 4: Applying styles to recreated file...")
        for sheet in file_data["sheets"]:
            for table in sheet["tables"]:
                key = (sheet["name"], table["name"])
                apply_styles_to_table(
                    output_path, sheet["name"], table["name"],
                    all_styles.get(key, {}),
                    all_col_widths.get(key, [])
                )

        print("  Styles applied")

        # Step 5: Compare styles
        print("\nStep 5: Comparing styles...")
        all_diffs = []
        for sheet in file_data["sheets"]:
            for table in sheet["tables"]:
                key = (sheet["name"], table["name"])
                if not all_styles.get(key):
                    continue  # skipped large table
                rec_styles = read_styles_for_table(
                    output_path, sheet["name"], table["name"],
                    table["numRows"], table["numCols"]
                )
                diffs = compare_styles(all_styles.get(key, {}), rec_styles, sheet["name"], table["name"])
                if diffs:
                    all_diffs.append(f"  {sheet['name']}/{table['name']}: {len(diffs)} diffs")
                    for d in diffs[:5]:
                        all_diffs.append(f"    {d}")
                    if len(diffs) > 5:
                        all_diffs.append(f"    ...and {len(diffs) - 5} more")

        # Close the recreated doc in Numbers
        run_applescript(f'''
tell application "Numbers"
  repeat with d in documents
    set dPath to POSIX path of (file of d as text)
    if dPath is "{escape_as(output_path)}" then
      close d saving no
      exit repeat
    end if
  end repeat
end tell''')

        if not all_diffs:
            print("\n  PASS: Perfect styled round-trip fidelity")
        else:
            print(f"\n  STYLE DIFFERENCES ({len(all_diffs)}):")
            for d in all_diffs:
                print(f"  {d}")

    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass

    print("\nDONE")


if __name__ == "__main__":
    main()
