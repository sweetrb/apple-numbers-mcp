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

## Two backends: values vs. formatting

This server has two backends and the split matters. It is a **values vs.
formatting** split, not a read vs. write one:

- **Reads and value/structure writes** use the `numbers-parser` Python library.
  They open the `.numbers` file directly off disk, offline, with no app and no
  special permission. This covers `set-cell`, `add-rows`, `create-spreadsheet`,
  `import-csv` and the rest — not just reads.
- **Formulas and formatting** drive **Numbers.app via AppleScript**. Only these
  eight tools require Numbers.app installed and the **Automation permission** (a
  one-time prompt the first time one of them runs): `set-formula`,
  `set-formulas-batch`, `set-cell-style`, `set-cells-style-batch`,
  `set-column-width`, `set-row-height`, `merge-cells`, `unmerge-cells`.

So you can inspect, search, export **and edit** a file with no setup beyond the
Python sidecar. Don't gate a `set-cell`, `add-rows` or `import-csv` on Numbers.app
or an Automation grant — those calls never send an Apple event.

## Available Tools

### Read (numbers-parser — no Numbers.app, no Automation permission)

| Tool | Purpose |
|------|---------|
| `health-check` | Verify Python 3 + numbers-parser are installed; report version |
| `doctor` | Full setup diagnostic - Python interpreter (path+version), read sidecar, Numbers.app, Automation permission |
| `get-file-info` | List sheets, tables, dimensions, header rows |
| `read-table` | Read rows (optional row range + column filter); defaults to first sheet/table |
| `get-cell` | One cell by 0-based row/col; `verbose: true` adds formula/format/merge |
| `search` | Case-insensitive substring search across every cell, optionally one sheet |
| `export-table` | Export a table to CSV / TSV / JSON |

### Write values and structure (numbers-parser — no Numbers.app, no Automation permission)

| Tool | Purpose |
|------|---------|
| `create-spreadsheet` | New `.numbers` file with headers + optional rows |
| `set-cell` / `set-cells-batch` | Write one cell / many cells (computed values) |
| `add-rows` | Append rows after the last existing row |
| `update-rows` | Replace whole rows by index (`{row, values}` entries) |
| `delete-rows` | Delete a 0-based inclusive row range |
| `add-sheet` / `add-table` | Add a sheet, or a table to a sheet |
| `rename-sheet` / `rename-table` | Rename a sheet or table |
| `import-csv` | Convert a CSV/TSV/JSON file into a **new** `.numbers` spreadsheet |

### Formulas and formatting (AppleScript -> Numbers.app — needs Numbers.app installed + Automation permission)

| Tool | Purpose |
|------|---------|
| `set-formula` / `set-formulas-batch` | Write live formula(s) (leading `=`) |
| `set-cell-style` / `set-cells-style-batch` | Font, color, number format, alignment |
| `set-column-width` / `set-row-height` | Dimensions in pixels (0-based index) |
| `merge-cells` / `unmerge-cells` | Merge / undo-merge a 0-based inclusive range |

These eight open the file in Numbers.app (launching it if it isn't running), save
the **whole document** — including any unsaved hand edits the user has open — and
leave it open afterwards.

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
- **Prefer batch tools.** Each formula/format call spins up Numbers.app scripting,
  and each sidecar call is its own Python process plus a full document load and
  save, so batching is much faster either way: `set-cells-batch` over many
  `set-cell`, `set-formulas-batch` over many `set-formula`, `update-rows` over
  per-row writes.
- **`add-sheet` / `add-table` geometry depends on `headers`.** With `headers` the
  new table is 1 row × `headers.length` columns; without them it is a **12 × 8**
  grid of empty cells. The response reports the dimensions either way.
- **`import-csv` auto-types CSV/TSV fields.** `01234` becomes the number `1234`
  and `1e5` becomes `100000.0`, so zero-padded identifiers lose their leading
  zeros. JSON input is passed through untouched.

## Core workflow: inspect, then act

The reliable pattern is to inspect first, then act against exact names:

```
1. get-file-info path="~/x.numbers"   -> sheet & table names, sizes
2. read-table / search / get-cell     -> see the data (header is row 0)
3. set-cells-batch / update-rows / ... -> write values (no Numbers.app needed)
4. set-formula / set-cell-style / ...  -> formulas & formatting (needs Numbers.app)
```

Sheet/table parameters are matched by name, so guessing leads to "not found"
errors. Call `get-file-info` first when unsure of names.

## Important Guidelines

1. **macOS only.** The package is macOS-only (it declares `os: ["darwin"]`). Reads
   *and* value/structure writes need just the Python sidecar; only formulas and
   formatting also require Numbers.app and the Automation permission.
2. **Run `doctor` when something fails.** It reports the resolved Python
   interpreter (path + version), the read sidecar, Numbers.app presence, and
   Automation permission as ok/warn/fail.
3. **`.numbers` extension required.** Every path must end in `.numbers`.

## Error Handling

- **"numbers-parser not installed"**: the Python read sidecar/venv is missing.
  Most often `python3` is older than 3.11 (stock macOS ships 3.9): install a
  newer Python (`brew install python@3.12`) and retry - the venv rebuilds
  automatically. Otherwise `pip3 install numbers-parser` (global install) or
  run `scripts/setup.sh` from a repo checkout. The `doctor` tool reports the
  resolved interpreter path + version.
- **"Not authorized to send Apple events to Numbers."**: the host app lacks the
  Automation permission for Numbers - grant it in System Settings -> Privacy &
  Security -> Automation, or reset with `tccutil reset AppleEvents`. Only the
  eight formula/format tools can produce this; if a `set-cell` or `import-csv`
  fails, the cause is something else.
- **Numbers can't be found / isn't running**: install Numbers.app, then retry.
  Only the formula/format tools need it, and they launch it themselves - it does
  not have to already be running. Reads and value/structure writes work without
  Numbers.app entirely.
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
-> import-csv inputPath="~/data.csv" outputPath="~/data.numbers"
   (both paths are required; the output file is created, overwriting any
    existing file at that path)
```
