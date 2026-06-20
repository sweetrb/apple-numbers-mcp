# Limitations

Apple Numbers MCP is a **hybrid** bridge to `.numbers` spreadsheets: it **reads**
them offline with [numbers-parser](https://pypi.org/project/numbers-parser/)
(Python, no app required), and **writes/formats** them by scripting **Numbers.app**
via AppleScript (because numbers-parser can't write styles or formulas). That split
is the source of most of the limitations below.

This page documents the real limitations — what the server can't do and why — so
they aren't re-investigated every release. These agree with the README's
[Known Limitations](../README.md#known-limitations); this page adds the *why* and
*what to do* for each.

## Writes & formatting require Numbers.app + Automation permission (reads don't)

**Why:** numbers-parser can read a `.numbers` file directly off disk, but it does
**not** write styles, formulas, or cell-dimension changes reliably. To do those,
the server scripts **Numbers.app** through AppleScript. That means every
write/format tool needs (a) **Numbers.app installed** and (b) the host app to have
**Automation** permission to control Numbers. Read tools (`get-file-info`,
`read-table`, `get-cell`, `search`, `export-table`) use only numbers-parser and
need **neither** — they work on macOS or Linux with no Automation grant.

**What to do:** For inspection/search/export, nothing special is needed. For any
write — `set-cell(s)`, `add/update/delete-rows`, `add-sheet`/`add-table`,
`rename-*`, `set-formula(s)`, `set-*-style`, `set-column-width`/`set-row-height`,
`merge`/`unmerge`, `create-spreadsheet`, `import-csv` — install Numbers.app and
grant Automation permission. Full steps in
[AUTOMATION-PERMISSION.md](./AUTOMATION-PERMISSION.md). Verify with `doctor`.

## Formulas and styling are AppleScript-only

**Why:** Writing a formula (`set-formula`, `set-formulas-batch`) or a style
(`set-cell-style`, `set-cells-style-batch`, `set-column-width`, `set-row-height`,
`merge-cells`/`unmerge-cells`) cannot be done through the Python read path —
numbers-parser doesn't expose reliable writes for these. They go exclusively
through Numbers.app via AppleScript, so they inherit the macOS-only + Automation
requirements above and can't run on Linux.

**What to do:** Run formula/format tools on macOS with Numbers.app. If you only
have the Python path available (e.g. Linux), you can still read formulas and
formatted values (via `get-cell verbose: true`) — you just can't set them.

## Values vs. formulas

**Why:** The value-writing tools (`set-cell`, `set-cells-batch`, `add-rows`,
`update-rows`) write **computed values**, not formulas. Passing `"=SUM(...)"` as a
value writes the literal string, not a live formula.

**What to do:** Use `set-formula` / `set-formulas-batch` to write actual formulas
(these require Numbers.app). Use the value tools for plain data.

## No charts, images, or conditional formatting

**Why:** numbers-parser doesn't expose charts, embedded images, or
conditional-formatting rules, and the AppleScript layer here doesn't implement
them either. There is no tool to create, read, or edit a chart, an image, or a
conditional-format rule.

**What to do:** Build charts / conditional formatting by hand in Numbers.app on the
data this server writes. The server can populate and format the underlying cells;
the visualization layer stays manual.

## Sheet deletion is not supported

**Why:** numbers-parser doesn't expose sheet removal, so there's no `delete-sheet`
tool. (Rows can be deleted with `delete-rows`; whole sheets cannot.)

**What to do:** Delete a sheet manually in Numbers.app.

## Indexing is 0-based for rows and columns

**Why:** Every tool that takes a `row`/`col` (or `startRow`/`endRow`/`startCol`/
`endCol`) uses **0-based** indices — verified throughout `src/index.ts` (e.g.
`row: z.number().int().min(0).describe("Row index (0-based)")`). The header row is
**row 0**, so the first data row is **row 1**. This is why `read-table` defaults
`startRow` to `1` (i.e. "skip the header"). Ranges are **inclusive** on both ends
(e.g. `delete-rows startRow: 1 endRow: 3` deletes three rows).

**What to do:** Treat the header as row 0. A spreadsheet "row 5" that a human sees
in Numbers.app (1-based, header included) is index `4` here. When in doubt, call
`read-table` or `get-cell` first to confirm what's at a given index.

## Dates are ISO 8601

**Why:** The Python layer normalizes all dates to **ISO 8601** on read
(`val.isoformat()`), collapsing a pure date with no time to `YYYY-MM-DD` and
keeping the full datetime otherwise. On write, a value typed as `date` is parsed
with `datetime.fromisoformat`, so date inputs must be ISO 8601 too.

**What to do:** Pass dates as `"2025-06-01"` or a full ISO datetime, and expect ISO
8601 back. Locale-formatted dates (e.g. `"6/1/25"`) are not parsed as dates.

## numbers-parser may lag the newest Numbers file format

**Why:** Apple periodically changes the `.numbers` on-disk format with new
Numbers.app releases. numbers-parser is a third-party library that has to catch up
to each new format version. A file saved by a very new Numbers.app can occasionally
read incompletely (or error) on an older numbers-parser.

**What to do:** Keep numbers-parser current (`pip3 install -U numbers-parser`, or
re-run `npm run setup`). If a read fails or looks wrong on a freshly-saved file,
upgrade numbers-parser first. Check the installed version with `health-check` /
`doctor`.

## Concurrent edits while Numbers.app has the file open

**Why:** Two backends can touch the same file. The read path (numbers-parser) reads
whatever is on disk, and the write path drives Numbers.app. If Numbers.app has the
file **open with unsaved changes**, what numbers-parser reads off disk can be
stale, and a write through AppleScript targets the app's in-memory copy — the two
can disagree, and saves can race.

**What to do:** Prefer to **close the file in Numbers.app** before reading or doing
bulk writes through the server, so disk and app agree. If you must keep it open,
read back with `read-table` / `get-cell` after writes to confirm the result landed,
and avoid editing the same cells by hand in Numbers.app at the same time.

## macOS-only for writes; reads are cross-platform

**Why:** Reads run anywhere numbers-parser runs (macOS or Linux). Writes/formatting
script Numbers.app, which only exists on macOS.

**What to do:** Run write/format workloads on a Mac with Numbers.app installed and
Automation permission granted. See
[AUTOMATION-PERMISSION.md](./AUTOMATION-PERMISSION.md).
