# Automation Permission for Write & Format Operations

Apple Numbers MCP has **two distinct backends**, and only one of them needs a
special macOS permission:

- **Reads** go through [numbers-parser](https://pypi.org/project/numbers-parser/)
  (Python). They open the `.numbers` file **directly** off disk and need **no**
  special permission — just normal file access.
- **Writes and formatting** go through **AppleScript driving Numbers.app**.
  numbers-parser can't write styles or formulas, so the server scripts Numbers.app
  to do it. macOS gates one app controlling another behind the **Automation**
  permission, so these tools require it.

This page explains which tools need Automation permission, how the prompt appears,
how to grant or reset it, what failure looks like, and how to verify.

## Which tools need Automation permission

**Need it** (AppleScript → Numbers.app — writes, formulas, formatting, structure
changes, CSV import, file creation):

- `set-cell`, `set-cells-batch`
- `add-rows`, `update-rows`, `delete-rows`
- `add-sheet`, `add-table`, `rename-sheet`, `rename-table`
- `set-formula`, `set-formulas-batch`
- `set-cell-style`, `set-cells-style-batch`
- `set-column-width`, `set-row-height`
- `merge-cells`, `unmerge-cells`
- `create-spreadsheet`
- `import-csv`

**Do NOT need it** (pure numbers-parser, file read directly off disk):

- `get-file-info`
- `read-table`
- `get-cell`
- `search`
- `export-table`
- `health-check` / `doctor` (these only probe the environment)

So you can fully inspect, search, and export a spreadsheet with no Automation
permission at all. The permission only matters the moment you try to **change or
format** a file.

> **Numbers.app must be installed.** The write/format path scripts Numbers.app, so
> the app has to be present at `/Applications/Numbers.app` (or
> `/System/Applications/Numbers.app`). Reads don't need it. If Numbers.app is
> missing, `doctor` reports `numbers_app: warn` and the write tools fail.

## How the permission prompt appears

The **first time** a write/format tool runs, macOS shows a one-time dialog:

> **"<Host App>" wants access to control "Numbers". Allowing control will provide
> access to documents and data in "Numbers", and to perform actions within that
> app.**

Click **OK / Allow**. The grant is remembered, so subsequent writes don't prompt
again. The "host app" is whatever process launched the MCP server — Claude
Desktop, Terminal, iTerm, or VS Code — **not** `node` and **not** Numbers.app.

If the host app runs headless or the dialog is dismissed/denied, the write fails
(see below) and you must grant the permission manually.

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
fails and the write/format tool returns an error containing:

```
Not authorized to send Apple events to Numbers.
```

(or, equivalently, an `errAEEventNotPermitted` / `-1743` error.) You may also see
`"Numbers got an error: ..."` style messages if Numbers.app itself can't be
driven. In all of these cases the underlying `.numbers` file is **not** modified.

If you instead see **"Numbers.app not running"** or a message that Numbers.app
can't be found, the problem is that the app isn't installed/openable — open
Numbers.app once and retry.

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

After resetting, **fully quit and reopen the host app**, then run any write tool
(e.g. `set-cell`) and click **OK** when the dialog appears.

## Verifying

Run the **`doctor`** tool — it's the richest diagnostic and reports three checks
as `ok` / `warn` / `fail`:

- **`numbers_parser`** — is the Python read sidecar installed (powers all reads).
- **`numbers_app`** — is Numbers.app present (required for any write/format tool).
- **`automation_permission`** — an informational reminder that write tools need
  Automation permission, granted on first use.

> **Note:** Automation permission can't be probed without actually trying to
> control Numbers (that would itself trigger the prompt), so `doctor` reports it
> **informationally** rather than testing it live. The definitive test is to run a
> real write — e.g. `set-cell` on a scratch file. If it succeeds, the permission
> is in place; if it returns *"Not authorized to send Apple events to Numbers,"*
> grant or reset it as above.

## See also

- [docs/LIMITATIONS.md](./LIMITATIONS.md) — the full read-vs-write split and other
  limits.
- [Known Limitations](../README.md#known-limitations) and
  [Security and Privacy](../README.md#security-and-privacy) in the README.
