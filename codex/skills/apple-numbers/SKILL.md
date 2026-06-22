---
name: apple-numbers
description: Use this skill when the user wants to work with Apple Numbers spreadsheets on macOS - reading tables and cells, searching, creating files, writing or formatting cells, managing sheets and tables, writing formulas, importing CSV/TSV/JSON, or exporting data. This skill provides access to the apple-numbers MCP server.
---

# Apple Numbers Skill

This skill enables you to read and write Apple Numbers (`.numbers`) spreadsheets through natural language. Use it whenever the user mentions a Numbers file, a spreadsheet, or wants to read, search, edit, format, or convert tabular data stored in Numbers.

## When to Use This Skill

Use this skill when the user:
- Wants to read what is in a `.numbers` file (tables, cells, sheet structure)
- Asks to find or search for a value across a spreadsheet
- Wants to create a new Numbers spreadsheet
- Needs to set or update cell values, append rows, or delete rows
- Wants to write live formulas or format cells (font, color, number format, alignment)
- Wants to add, rename, or organize sheets and tables
- Wants to import a CSV/TSV/JSON file into Numbers, or export a table out
- Mentions Apple Numbers, the Numbers app, or "my spreadsheet"

## Two backends: read vs. write

This server has two backends and the split matters:

- **Reads** use the `numbers-parser` Python library. They open the `.numbers`
  file directly off disk, offline, with no app and no special permission.
- **Writes and formatting** drive **Numbers.app via AppleScript**. These require
  macOS, Numbers.app installed, and the **Automation permission** (a one-time
  prompt the first time a write tool runs).

So you can fully inspect, search, and export a file with no setup beyond the
Python read sidecar, but the moment you change or format a file you need
Numbers.app and the Automation permission.

## Available Tools

### Read (numbers-parser — no Numbers.app, no Automation permission)

| Tool | Purpose |
|------|---------|
| `health-check` | Verify Python 3 + numbers-parser are installed; report version |
| `doctor` | Full setup diagnostic - read sidecar, Numbers.app, Automation permission |
| `get-file-info` | List sheets, tables, dimensions, header rows |
| `read-table` | Read rows (optional row range + column filter); defaults to first sheet/table |
| `get-cell` | One cell by 0-based row/col; `verbose: true` adds formula/format/merge |
| `search` | Case-insensitive substring search across every cell, optionally one sheet |
| `export-table` | Export a table to CSV / TSV / JSON |

### Write and format (AppleScript -> Numbers.app — needs macOS + Automation permission)

| Tool | Purpose |
|------|---------|
| `create-spreadsheet` | New `.numbers` file with headers + optional rows |
| `set-cell` / `set-cells-batch` | Write one cell / many cells (computed values) |
| `add-rows` | Append rows after the last existing row |
| `update-rows` | Replace whole rows by index (`{row, values}` entries) |
| `delete-rows` | Delete a 0-based inclusive row range |
| `add-sheet` / `add-table` | Add a sheet, or a table to a sheet |
| `rename-sheet` / `rename-table` | Rename a sheet or table |
| `set-formula` / `set-formulas-batch` | Write live formula(s) (leading `=`) |
| `set-cell-style` / `set-cells-style-batch` | Font, color, number format, alignment |
| `set-column-width` / `set-row-height` | Dimensions in pixels (0-based index) |
| `merge-cells` / `unmerge-cells` | Merge / undo-merge a 0-based inclusive range |
| `import-csv` | Convert a CSV/TSV/JSON file into a new `.numbers` spreadsheet |

## Conventions to know

- **`path` is a file path with `~` expansion.** Every tool takes an explicit
  `path` to the `.numbers` file; a leading `~` expands to the home directory.
  Files must end in `.numbers`.
- **Sheet/table default to the first.** Most read and value-write tools accept
  optional `sheet` / `table`; omit them to target the first sheet and first
  table. The AppleScript tools generally require explicit `sheet` and `table`.
- **Indexing is 0-based, ranges inclusive.** Header is row 0, so the first data
  row is row 1. A "row 5" a human sees in Numbers is index 4 here.
- **Dates are ISO 8601.** Dates come back as ISO 8601; to write a date, type the
  value as `date` and pass an ISO 8601 string.
- **Values vs. formulas.** `set-cell` / `set-cells-batch` / `add-rows` /
  `update-rows` write computed values - passing `"=SUM(...)"` writes the literal
  text. Use `set-formula` / `set-formulas-batch` for live formulas.
- **Prefer batch tools.** Each AppleScript write spins up Numbers.app scripting,
  so batching is much faster: `set-cells-batch` over many `set-cell`,
  `set-formulas-batch` over many `set-formula`, `update-rows` over per-row writes.

## Core workflow: inspect, then act

The reliable pattern is to inspect first, then act against exact names:

```
1. get-file-info path="~/x.numbers"   -> sheet & table names, sizes
2. read-table / search / get-cell     -> see the data (header is row 0)
3. set-cells-batch / set-formula / ... -> write or format (needs Numbers.app)
```

Sheet/table parameters are matched by name, so guessing leads to "not found"
errors. Call `get-file-info` first when unsure of names.

## Important Guidelines

1. **macOS Only for writes.** Reads work on macOS or Linux; writes/formatting
   require macOS with Numbers.app and the Automation permission.
2. **Run `doctor` when something fails.** It reports the read sidecar,
   Numbers.app presence, and Automation permission as ok/warn/fail.
3. **`.numbers` extension required.** Every path must end in `.numbers`.

## Error Handling

- **"numbers-parser not installed. Run: npm run setup"**: the Python read
  sidecar/venv is missing - run `npm run setup` (source clone) or
  `pip3 install numbers-parser` (global install).
- **"Not authorized to send Apple events to Numbers."**: the host app lacks the
  Automation permission for Numbers - grant it in System Settings -> Privacy &
  Security -> Automation, or reset with `tccutil reset AppleEvents`.
- **"Numbers.app not running" / not found**: install or open Numbers.app, then
  retry; reads still work without it.
- **"File not found"**: check the path and that it ends in `.numbers`.
- **"Sheet not found" / "Table not found"**: call `get-file-info` first to get
  exact names, or omit `sheet` / `table` to use the first.

## Examples

### Read and total a column

```
User: "What's the total of column B in my budget spreadsheet?"
-> 1. get-file-info to learn sheet/table names
-> 2. read-table to read the rows
-> 3. sum column B (header is row 0, first data row is row 1)
```

### Find a value

```
User: "Where does 'overdue' appear in this file?"
-> search query="overdue" path="~/invoices.numbers"
```

### Import a CSV

```
User: "Turn this CSV into a Numbers spreadsheet"
-> import-csv path="~/data.csv" (creates a new .numbers file)
```
