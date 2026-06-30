# CLAUDE.md - Apple Numbers MCP Server

This file provides guidance for AI agents (Claude, etc.) when using this MCP server.

## Overview

This MCP server lets AI assistants **read, write, search, format, and import**
Apple Numbers (`.numbers`) spreadsheets. All operations are **local** — nothing
leaves the user's machine. It has two backends, and the split matters:

- **Reads** use [numbers-parser](https://pypi.org/project/numbers-parser/) (Python).
  They open the `.numbers` file **directly off disk**, **offline**, with **no app
  and no special permission** — and work on macOS *or* Linux.
- **Writes & formatting** drive **Numbers.app via AppleScript** (numbers-parser
  can't write styles/formulas reliably). These require **macOS + Numbers.app
  installed + the Automation permission**.

Internalize that read-vs-write split: you can fully inspect, search, and export a
file with zero setup beyond the Python sidecar, but the moment you **change or
format** a file you need Numbers.app and Automation permission.

## Related Documentation

- **[docs/AUTOMATION-PERMISSION.md](./docs/AUTOMATION-PERMISSION.md)** — which tools
  need Automation permission, how the prompt appears, how to grant/reset it
  (`tccutil reset AppleEvents`), what failure looks like, and how to verify.
  Required reading when a write tool fails with *"Not authorized to send Apple
  events to Numbers."*
- **[docs/LIMITATIONS.md](./docs/LIMITATIONS.md)** — what the server can and can't
  do (read-vs-write split, formulas/styles are AppleScript-only, no
  charts/conditional-formatting, indexing, dates, format lag, concurrent edits).

## First-run requirements

1. **Python read sidecar installed.** All reads shell out to numbers-parser
   (Python). On a source clone, run `pnpm run setup` to create the project-local
   venv at `./venv` with numbers-parser. On a global install,
   `pip3 install numbers-parser`. Without it, **every read** fails.
2. **For writes only: Numbers.app + Automation permission.** Write/format tools
   script Numbers.app, so the app must be installed and the **host app** (Claude,
   Terminal, iTerm, VS Code) must have Automation permission to control Numbers —
   granted via a one-time prompt on the first write, or manually in **System
   Settings → Privacy & Security → Automation**. See
   [docs/AUTOMATION-PERMISSION.md](./docs/AUTOMATION-PERMISSION.md).

When in doubt, run **`doctor`** — it's the richest diagnostic, reporting three
checks as ok/warn/fail: `numbers_parser` (read sidecar present), `numbers_app`
(Numbers.app present, needed for writes), and `automation_permission`
(informational reminder that write tools need it). `health-check` is the lighter
check (numbers-parser version only).

## Conventions and behaviors to know

- **`path` is a file path with `~` expansion.** Every tool takes an explicit
  `path` (the `.numbers` file). A leading `~` is expanded to the home directory, so
  `~/Documents/budget.numbers` works. Files must end in `.numbers`.
- **Sheet/table default to the first.** Most read and value-write tools accept
  optional `sheet` / `table`; omit them to target the **first sheet** and **first
  table**. The AppleScript tools (`set-formula`, `set-cell-style`, dimensions,
  merge) generally **require** explicit `sheet` and `table`. When unsure of names,
  call `get-file-info` first.
- **Indexing is 0-based, ranges inclusive.** Every `row`/`col` (and
  `startRow`/`endRow`/`startCol`/`endCol`) is **0-based**. The **header is row 0**,
  so the first data row is **row 1** (which is why `read-table` defaults `startRow`
  to `1`). A "row 5" a human sees in Numbers.app is index `4` here. Ranges include
  both ends.
- **Dates are ISO 8601.** Dates come back as ISO 8601 (`YYYY-MM-DD`, or full
  datetime). To write a date, type the value as `date` and pass an ISO 8601 string.
- **Values vs. formulas.** `set-cell`/`set-cells-batch`/`add-rows`/`update-rows`
  write **computed values** — passing `"=SUM(...)"` writes the literal text. Use
  `set-formula` / `set-formulas-batch` for live formulas (these need Numbers.app).
- **Prefer batch tools.** Each AppleScript write spins up Numbers.app scripting, so
  batching is much faster. Use `set-cells-batch` over many `set-cell` calls,
  `set-formulas-batch` over many `set-formula`, `set-cells-style-batch` over many
  `set-cell-style`, and `update-rows` (which can carry multiple `{row, values}`
  entries) over per-row writes.

## Tools at a glance

**Read (numbers-parser — no Numbers.app, no Automation permission, cross-platform):**

| Tool | Purpose |
|------|---------|
| `health-check` | Verify Python 3 + numbers-parser are installed; report version |
| `doctor` | Full setup diagnostic — read sidecar, Numbers.app, Automation permission, each ok/warn/fail (richer than `health-check`) |
| `get-file-info` | List sheets, tables, dimensions, header rows |
| `read-table` | Read rows (optional row range + column filter), defaults to first sheet/table |
| `get-cell` | One cell by 0-based row/col; `verbose: true` adds formula/format/merge |
| `search` | Case-insensitive substring search across every cell, optionally one sheet |
| `export-table` | Export a table to CSV / TSV / JSON |

**Write & format (AppleScript → Numbers.app — needs macOS + Automation permission):**

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
| `merge-cells` / `unmerge-cells` | Merge/undo-merge a 0-based inclusive range |
| `import-csv` | Convert a CSV/TSV/JSON file into a new `.numbers` spreadsheet |

## Core workflow: inspect, then act

The reliable pattern is **inspect first**: call `get-file-info` to learn the sheet
and table names (and dimensions), then read/search/write against those exact names.
Sheet/table parameters are matched by name, so guessing leads to "not found"
errors.

```
1. get-file-info path="~/x.numbers"   → sheet & table names, sizes
2. read-table / search / get-cell     → see the data (header is row 0)
3. set-cells-batch / set-formula / …   → write or format (needs Numbers.app)
```

## Error Handling

| Error | Likely cause | What to do |
|-------|--------------|------------|
| "numbers-parser not installed. Run: npm run setup" | Python read sidecar/venv missing | Run `pnpm run setup` (source clone) or `pip3 install numbers-parser` (global) |
| "Not authorized to send Apple events to Numbers." | Host app lacks Automation permission for Numbers | Grant it (System Settings → Privacy & Security → Automation) or reset with `tccutil reset AppleEvents`; see [docs/AUTOMATION-PERMISSION.md](./docs/AUTOMATION-PERMISSION.md) |
| "Numbers.app not running" / Numbers.app not found | Numbers.app not installed/openable (writes only) | Install/open Numbers.app once, then retry; reads still work without it |
| "File not found" | Wrong path, or `~` not expanded by the caller | Check the path; ensure it ends in `.numbers` |
| "Sheet not found" / "Table not found" | Sheet/table name doesn't match | Call `get-file-info` first to get exact names; omit `sheet`/`table` to use the first |

## Quick reference: getting the most from a request

- "What's in this file?" → `get-file-info`, then `read-table`
- "Find X" → `search`
- "What's in cell B5?" → `get-cell` (remember: 0-based, header is row 0)
- "Set / append / format cells" → batch tools (`set-cells-batch`,
  `set-formulas-batch`, `set-cells-style-batch`, `update-rows`) — needs Numbers.app
- "Export that table" → `export-table` (CSV/TSV/JSON)
- "Import this CSV" → `import-csv`
- "Is my setup OK?" → `doctor`

## Recurring macOS permission prompts → offer the official-Node fix

If a user reports being **repeatedly** prompted for Full Disk Access or
Automation for "node" (especially after a `brew upgrade`), or that this MCP
loses its permissions every so often, the cause is almost always an **ad-hoc
signed Node** (typically Homebrew's) whose cdhash changes on every update, so
macOS TCC keeps treating it as a brand-new binary.

Detect it:

```bash
codesign -dvvv "$(which node)" 2>&1 | grep -E 'Signature=adhoc|TeamIdentifier=not set'
```

If that matches (ad-hoc / no Team ID), **offer to migrate this MCP to the
official Developer-ID-signed Node** per
[`docs/NODE-RUNTIME-AND-TCC-PERMISSIONS.md`](docs/NODE-RUNTIME-AND-TCC-PERMISSIONS.md):
install an official LTS Node to a stable path (e.g. `~/mcp-runtime/node-current`),
repoint this server's `command` at it, and have the user grant the permission
once — it then persists across Node updates. Do not repoint `npx`-launched
servers that don't need Full Disk Access.
