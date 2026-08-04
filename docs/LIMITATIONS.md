# Limitations

Apple Numbers MCP is a **hybrid** bridge to `.numbers` spreadsheets: it **reads**
them *and writes their values and structure* offline with
[numbers-parser](https://pypi.org/project/numbers-parser/) (Python, no app
required), and **formats** them — styles, live formulas, column/row dimensions,
merges — by scripting **Numbers.app** via AppleScript (because numbers-parser
can't write those). That split is the source of most of the limitations below.
Note it is a **values-vs-formatting** split, not a read-vs-write one.

This page documents the real limitations — what the server can't do and why — so
they aren't re-investigated every release. These agree with the README's
[Known Limitations](../README.md#known-limitations); this page adds the *why* and
*what to do* for each.

## Formulas & formatting require Numbers.app + Automation permission (nothing else does)

**Why:** numbers-parser can read a `.numbers` file directly off disk *and* write
values, rows, sheets and tables into it — but it does **not** write styles,
formulas, or cell-dimension changes reliably. To do those, the server scripts
**Numbers.app** through AppleScript. That means the eight formula/format tools
need (a) **Numbers.app installed** and (b) the host app to have **Automation**
permission to control Numbers. Every other tool — the reads (`get-file-info`,
`read-table`, `get-cell`, `search`, `export-table`) *and* the value/structure
writes (`set-cell(s)`, `add/update/delete-rows`, `add-sheet`/`add-table`,
`rename-*`, `create-spreadsheet`, `import-csv`) — uses only numbers-parser and
needs **neither**: no Numbers.app, no Automation grant, no Apple event.

**What to do:** For inspection/search/export, and for ordinary value and structure
edits, nothing special is needed. Only for `set-formula(s)`, `set-*-style`,
`set-column-width`/`set-row-height` and `merge`/`unmerge` do you have to install
Numbers.app and grant Automation permission. Full steps in
[AUTOMATION-PERMISSION.md](./AUTOMATION-PERMISSION.md). Verify with `doctor` — and
test the grant with a *formula/format* tool, since a `set-cell` succeeds without
it and so proves nothing.

## Formulas and styling are AppleScript-only

**Why:** Writing a formula (`set-formula`, `set-formulas-batch`) or a style
(`set-cell-style`, `set-cells-style-batch`, `set-column-width`, `set-row-height`,
`merge-cells`/`unmerge-cells`) cannot be done through the Python read path —
numbers-parser doesn't expose reliable writes for these. They go exclusively
through Numbers.app via AppleScript, so they inherit the macOS-only + Automation
requirements above and can't run on Linux.

**What to do:** Run formula/format tools on macOS with Numbers.app installed.
Where only the Python path is available, you can still *read* formulas and
formatted values (via `get-cell verbose: true`) — you just can't set them. Note
the npm package declares `os: ["darwin"]`, so Linux isn't a supported install
target even for that read-only subset (see "macOS only" below).

## Values vs. formulas

**Why:** The value-writing tools (`set-cell`, `set-cells-batch`, `add-rows`,
`update-rows`) write **computed values**, not formulas. Passing `"=SUM(...)"` as a
value writes the literal string, not a live formula.

**What to do:** Use `set-formula` / `set-formulas-batch` to write actual formulas
(these require Numbers.app). Use the value tools for plain data.

## `import-csv` auto-types CSV/TSV fields, so leading zeros are lost

**Why:** For a `csv` or `tsv` source, every field is passed through the sidecar's
`_auto_convert()` before it is written: `""` becomes an empty cell, `true`/`false`
become booleans, and anything Python's `int()` or `float()` accepts becomes a
number. That is deliberately *less* conservative than the value-write tools
(`set-cell`, `set-cells-batch`, `add-rows`, `update-rows`), which reject
leading-zero integers so identifier-like strings keep their exact text. So a zip
code `01234` imports as the number `1234`, `007` imports as `7`, and a part number
`1e5` imports as `100000.0`. There is no per-column type control on import, and the
conversion isn't reversible once the `.numbers` file is written.

A `json` source does **not** do this — those values go straight through, so a JSON
string `"01234"` survives intact.

**What to do:** For CSV/TSV columns holding zero-padded identifiers, import from
JSON instead, or repair the affected cells after import with `set-cells-batch`
using `type: "string"`. Spot-check with `get-cell` after importing anything
identifier-like.

## `import-csv` takes its JSON columns from the first object only

**Why:** For an array-of-objects JSON source the column set is the keys of the
**first** object. A key that appears only in a later object is dropped silently,
and objects missing an early key get blank cells. An array-of-arrays source has no
header names at all: columns are named `Column_0`, `Column_1`, … and the first row
is kept as data. Separately, when `format` is `auto`, any extension that isn't
`.csv`, `.tsv` or `.json` falls back to **CSV** rather than erroring.

**What to do:** Normalize a heterogeneous JSON export to a common key set before
importing, and pass `format` explicitly for inputs whose extension isn't one of the
three recognized ones. The tool's response reports the format it actually used and
the column count it produced — check both when the input is unusual.

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
re-run `pnpm run setup`). If a read fails or looks wrong on a freshly-saved file,
upgrade numbers-parser first. Check the installed version with `health-check` /
`doctor`.

## Concurrent edits while Numbers.app has the file open

**Why:** Two backends can touch the same file. The numbers-parser path (reads and
value/structure writes) sees whatever is on disk; the formula/format path drives
Numbers.app. If Numbers.app has the file **open with unsaved changes**, what
numbers-parser reads off disk can be stale, and an AppleScript call targets the
app's in-memory copy — the two can disagree, and saves can race.

Three side effects of the AppleScript path matter here, because they apply to
**every** formula/format tool:

1. **It opens the file itself**, launching Numbers.app if it isn't running. These
   tools don't require Numbers.app to already be running — only *installed* — so a
   single `set-column-width` on an idle Mac can pop a window and, the first time,
   the Automation prompt.
2. **It saves the whole document, not just the change.** If you have the workbook
   open in Numbers with unsaved hand edits, one formula/format call commits *all*
   of them to disk.
3. **It leaves the document open** afterwards — nothing ever closes it — so every
   later numbers-parser read or write on that file races the app's in-memory copy,
   which is exactly the hazard this section describes.

**What to do:** Prefer to **close the file in Numbers.app** before reading or doing
bulk writes through the server, so disk and app agree — and close it again after a
run of formula/format calls, which will have reopened it. If you must keep it open,
read back with `read-table` / `get-cell` after writes to confirm the result landed,
and avoid editing the same cells by hand in Numbers.app at the same time.

## Concurrent writes to the same file are last-writer-wins

**Why:** Each write tool opens the `.numbers` file, applies its change to an
in-memory document, and saves the **whole document** back. On the numbers-parser
path the save is **atomic** — every mutating sidecar command writes to a sibling
temp file and `os.replace()`s it onto the target — so an interrupted or crashed
write can never leave a torn or half-written file. (The formula/format tools save
through Numbers.app instead, so that guarantee is the app's, not this server's.)
But atomicity protects against *corruption*, **not** against
*lost updates*: if two writes to the same file overlap (two agents, two server
instances, or a server write racing a hand edit in Numbers.app), each loaded the
document independently, and whichever saves **last** overwrites the other's change
wholesale. There is no file locking, no merge, and no optimistic-concurrency check.

**What to do:** **Serialize writes to a given file** — don't fan out concurrent
mutations against the same `.numbers` file from multiple agents or sessions. Batch
related edits into a single call (`set-cells-batch`, `update-rows`,
`set-formulas-batch`) instead of many overlapping ones, finish one tool call before
starting the next on the same file, and after a burst of writes read back with
`read-table` / `get-cell` to confirm the final state is what you intended.

## Per-call timeouts are fixed (30 s sidecar, 60 s AppleScript)

**Why:** Every numbers-parser sidecar call runs under a **30-second** process
timeout, and every AppleScript call under **60 seconds** (the generated script also
carries an in-app `with timeout` block set 5 s lower, so Numbers.app aborts cleanly
before the process is killed). Neither is configurable — there is no
`APPLE_NUMBERS_MCP_*` variable for either one.
`APPLE_NUMBERS_MCP_SETUP_TIMEOUT` governs only the one-time venv bootstrap, and
`APPLE_NUMBERS_MCP_MAX_BUFFER` caps stdout size, not wall-clock time. A very large
workbook, or a wedged Numbers.app, surfaces as `Operation timed out after
30000ms. File may be very large.`

**What to do:** Narrow the request rather than hunting for a knob: read in slices
with `read-table`'s `startRow`/`endRow` and `columns`, split large
`set-cells-batch` / `update-rows` calls into smaller batches, and close the file in
Numbers.app so the AppleScript layer isn't waiting on the app.

## macOS only (the package declares `os: ["darwin"]`)

**Why:** The published npm package declares `"os": ["darwin"]`, so `npm`/`pnpm`
refuse to install it on any other platform (`EBADPLATFORM`). The numbers-parser
path — reads plus value/structure writes — is platform-independent in principle
(nothing in the sidecar branches on the platform), but the formula/format tools
script Numbers.app, which exists only on macOS, so the package as a whole is
pinned to darwin deliberately.

**What to do:** Run this server on a Mac. Add Numbers.app plus Automation
permission only if you need formulas or formatting; reads and value/structure
writes need neither. See
[AUTOMATION-PERMISSION.md](./AUTOMATION-PERMISSION.md).
