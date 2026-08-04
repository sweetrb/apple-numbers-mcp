# Automation Permission for Formula & Formatting Operations

Apple Numbers MCP has **two distinct backends**, and only one of them needs a
special macOS permission. The split is **values vs. formatting**, not read vs.
write:

- **Reads and value/structure writes** go through
  [numbers-parser](https://pypi.org/project/numbers-parser/) (Python). They open
  the `.numbers` file **directly** off disk and need **no** special permission —
  just normal file access. No Apple event is ever sent, so Numbers.app doesn't
  even have to be installed.
- **Formulas and formatting** go through **AppleScript driving Numbers.app**.
  numbers-parser can't write styles or formulas, so the server scripts Numbers.app
  to do it. macOS gates one app controlling another behind the **Automation**
  permission, so these tools require it.

This page explains which tools need Automation permission, how the prompt appears,
how to grant or reset it, what failure looks like, and how to verify.

## Which tools need Automation permission

**Need it** (AppleScript → Numbers.app — formulas, styles, dimensions, merges):

- `set-formula`, `set-formulas-batch`
- `set-cell-style`, `set-cells-style-batch`
- `set-column-width`, `set-row-height`
- `merge-cells`, `unmerge-cells`

**Do NOT need it** (pure numbers-parser, the file opened directly off disk):

- Reads — `get-file-info`, `read-table`, `get-cell`, `search`, `export-table`
- Value writes — `set-cell`, `set-cells-batch`, `add-rows`, `update-rows`,
  `delete-rows`
- Structure writes — `add-sheet`, `add-table`, `rename-sheet`, `rename-table`
- File creation — `create-spreadsheet`, `import-csv`
- `health-check` / `doctor` (these only probe the environment)

So you can inspect, search, export **and edit** a spreadsheet — cell values, whole
rows, sheets and tables, new files from CSV — with no Automation permission at all,
and with Numbers.app not installed. The permission only matters the moment you
write a **live formula** or change **formatting** (font, color, number format,
alignment, column width, row height, merges).

> **Numbers.app must be installed for the formula/format tools.** Only that path
> scripts Numbers.app, so the app has to be present at `/Applications/Numbers.app`
> (or `/System/Applications/Numbers.app`). Reads and the numbers-parser writes
> don't need it. If Numbers.app is missing, `doctor` reports `numbers_app: warn`
> and only the formula/format tools fail.

## How the permission prompt appears

The **first time** a formula or formatting tool runs, macOS shows a one-time
dialog:

> **"<Host App>" wants access to control "Numbers". Allowing control will provide
> access to documents and data in "Numbers", and to perform actions within that
> app.**

Click **OK / Allow**. The grant is remembered, so subsequent calls don't prompt
again. The "host app" is whatever process launched the MCP server — Claude
Desktop, Terminal, iTerm, or VS Code — **not** `node` and **not** Numbers.app.

If the host app runs headless or the dialog is dismissed/denied, the
formula/format call fails (see below) and you must grant the permission manually.
Value and structure writes are unaffected — they never send an Apple event.

## How to grant it manually

1. Open **System Settings** (or **System Preferences** on older macOS).
2. Go to **Privacy & Security → Automation**.
3. Find the **host app** that runs the MCP server (Claude, Terminal, iTerm, or
   VS Code) in the list.
4. Expand it and enable the toggle next to **Numbers**.

| Host | App to allow |
|------|--------------|
| Claude Desktop | `Claude.app` |
| Claude Code in Terminal | `Terminal.app` |
| Claude Code in iTerm | `iTerm.app` |
| Claude Code in VS Code | `Visual Studio Code.app` |

> **Grant it to the right app.** Automation permission applies to the process that
> *spawns* the server, not to `node` or to Numbers.app. If you launch Claude Code
> from iTerm, allow iTerm to control Numbers; if you use Claude Desktop, allow
> Claude. Granting it to the wrong app has no effect.

## What failure looks like

When the host app lacks Automation permission for Numbers, the AppleScript layer
fails and the formula/format tool returns an error containing:

```
Not authorized to send Apple events to Numbers.
```

(or, equivalently, an `errAEEventNotPermitted` / `-1743` error.) You may also see
`"Numbers got an error: ..."` style messages if Numbers.app itself can't be
driven. In all of these cases the underlying `.numbers` file is **not** modified.

If you instead see an error saying Numbers can't be found or isn't running, the
problem is that the app isn't installed/openable — install Numbers.app and retry.
(The tools do **not** require Numbers.app to already be running: the AppleScript
layer launches it and opens the file itself. It does have to be *installed*.)

## Resetting the permission

If the grant got into a bad state (e.g. you clicked **Don't Allow** the first
time, and macOS now won't re-prompt), reset the Automation permissions and let the
prompt appear again on the next write:

```bash
tccutil reset AppleEvents
```

This clears Apple-event (Automation) grants for **all** apps; macOS will re-prompt
on the next attempt. To be more surgical you can scope it to the host bundle id,
e.g.:

```bash
tccutil reset AppleEvents com.apple.Terminal
```

After resetting, **fully quit and reopen the host app**, then run any
formula/format tool (e.g. `set-cell-style`) and click **OK** when the dialog
appears. A value write such as `set-cell` will *not* re-trigger the prompt — it
never crosses the AppleScript boundary.

## Verifying

Run the **`doctor`** tool — it's the richest diagnostic and reports four checks
as `ok` / `warn` / `fail`:

- **`python_interpreter`** — the resolved Python's path and version (warns when
  older than 3.11; stock macOS ships 3.9).
- **`numbers_parser`** — is the Python read sidecar installed (powers all reads).
- **`numbers_app`** — is Numbers.app present (required for the formula/format
  tools; everything else works without it).
- **`automation_permission`** — an informational reminder that the formula/format
  tools need Automation permission, granted on first use.

> **Note:** Automation permission can't be probed without actually trying to
> control Numbers (that would itself trigger the prompt), so `doctor` reports it
> **informationally** rather than testing it live. The definitive test is to run a
> tool that actually crosses the AppleScript boundary — e.g. `set-cell-style` (or
> `set-formula`) on a scratch file. If it succeeds, the permission is in place; if
> it returns *"Not authorized to send Apple events to Numbers,"* grant or reset it
> as above.
>
> **Don't test with `set-cell`** (or any other value/structure write). Those run
> on the numbers-parser sidecar and succeed whether or not the grant exists, so
> they always "pass" and tell you nothing about the permission.

## See also

- [docs/LIMITATIONS.md](./LIMITATIONS.md) — the full backend split and other
  limits.
- [Known Limitations](../README.md#known-limitations) and
  [Security and Privacy](../README.md#security-and-privacy) in the README.
