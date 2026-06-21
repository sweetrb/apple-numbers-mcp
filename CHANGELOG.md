# Changelog

## [Unreleased]

### Changed
- **Restructured all 26 tool descriptions** into a consistent `Use when: / Returns: / Do not use when: / Safety:` shape so agents pick the right tool from MCP metadata alone, and added explicit **Safety** wording to the 19 write tools (#2). `delete-rows` is flagged destructive and not undoable; the in-place writers (`set-cell`, `set-cells-batch`, `update-rows`, `set-formula`/`set-formulas-batch`, `merge-cells`/`unmerge-cells`) note that they modify the file in place; and `create-spreadsheet`/`import-csv` note that they overwrite the target path if it already exists.

### Documentation
- Refreshed the `package.json` `description` to reflect the full read/write/search/format tool set (no longer read-only-sounding) and synced it verbatim with the GitHub repo one-liner.
- Added `docs/NODE-RUNTIME-AND-TCC-PERMISSIONS.md`: why macOS re-prompts for Full Disk Access / Automation when the server runs under an ad-hoc-signed (e.g. Homebrew) Node, and the fix — run it under the official Developer-ID-signed Node so the grant survives Node updates. README and CLAUDE.md now point at it.

## [0.6.0] - 2026-06-20

Bulletproof install & updates — the Python read sidecar now sets itself up.

### Added

- **Automatic Python venv bootstrap on first use.** If the `numbers-parser` venv is missing or out of date, the first read tool call now creates the venv and installs `numbers-parser` automatically (one-time; the first call can take ~a minute, with progress logged to stderr), then proceeds. A fresh install via npm, `npx`, or the Claude Code marketplace now works with **no manual `npm run setup` step** — though running it ahead of time still works as a pre-warm. (Write/format tools still need Numbers.app + Automation permission, unchanged.)
- New env vars: `APPLE_NUMBERS_MCP_NO_AUTO_SETUP` (set truthy to disable the automatic bootstrap) and `APPLE_NUMBERS_MCP_SETUP_TIMEOUT` (ms cap on the bootstrap, default 5 min).

### Fixed

- **Self-healing interpreter resolution.** The Python interpreter is no longer pinned at startup: a venv created or repaired while the server is running is picked up on the next call, with **no restart required**.
- **Stale-venv detection.** `scripts/setup.sh` records the `requirements.txt` it installed against (a `venv/.deps-ok` marker); after an update changes requirements, the server rebuilds the venv automatically.
- When automatic setup can't run (no Python 3, no `pip`, or offline), read tools return a clear, actionable error pointing at `npm run setup`.

## [0.5.0] - 2026-06-20

Maturity release bringing apple-numbers-mcp to feature/stability parity with apple-mail-mcp and apple-notes-mcp. First npm-published release.

### Added

- **`doctor` tool** — a richer diagnostic than `health-check`: separate checks for the numbers-parser read sidecar, Numbers.app presence (needed for writes), and a reminder about the Automation permission, each reported ok / warn / fail with advice (`structuredContent` carries `{ healthy, checks[] }`). Reads work without Numbers.app, so a missing app is a warning, not a failure.
- **`structuredContent` on every tool** — all 25 tools now return typed JSON alongside the human-readable text, so agents can consume results (file structure, cell values, search hits, edit confirmations) without parsing prose.
- **MCP resources & prompts** — resources `numbers://file/{path}` (file info) and `numbers://table/{path}` (default table read); prompts `analyze-spreadsheet`, `bulk-edit`, and `import-csv-guide`.
- **File-based config loader** — reads `~/Library/Application Support/apple-numbers-mcp/config.json` (override via `APPLE_NUMBERS_MCP_CONFIG_FILE`), merging string values into the environment without overriding already-set vars, so settings survive a host that strips the MCP env block.
- **Docs** — `docs/AUTOMATION-PERMISSION.md` (which tools need the Numbers.app Automation permission and how to grant/reset it), `docs/LIMITATIONS.md` (read-vs-write split, AppleScript-only formulas/styling, 0-based inclusive indexing, format lag), and a `CLAUDE.md` agent guide.
- **Plugin marketplace manifest** — added `.claude-plugin/marketplace.json` (the server was previously only a bare `plugin.json`), kept in step with `package.json` by the new `scripts/sync-plugin-version.mjs`.

### Changed

- **Hardened the subprocess layers.** The Python reader's `maxBuffer` (50 MB) and the AppleScript layer's `maxBuffer` (64 MB) are now overridable via `APPLE_NUMBERS_MCP_MAX_BUFFER`. The AppleScript layer also gained a script-level `with timeout` wrap, `killSignal: SIGKILL` (so a wedged Numbers.app osascript is reaped), and surfaces osascript stderr in thrown errors instead of a bare "Command failed".
- **CI** now runs `format:check` and tests with coverage (per-directory thresholds: services/tools/utils), keeps the fixture-generated integration job, and `publish.yml` auto-publishes on a successful CI run on `main` (in addition to the existing release trigger).
- **Tooling** — shared `src/tools/respond.ts` helpers; the `version` lifecycle script now syncs both plugin manifests. Test suite grown to 95 unit tests (+ 30 integration), with `@vitest/coverage-v8` and a `test:coverage` script.

### Fixed

- **Plugin install no longer blocked by husky** — `prepare` changed from `husky && npm run build` to `husky; npm run build`, so the build still runs when husky can't initialize (e.g. a marketplace git-clone install).
- **ESLint config** — disabled `no-undef` for TypeScript files (TS already checks this, and `no-undef` mis-flagged type-only references like `NodeJS.ProcessEnv`) and added a test-file override; lint is clean again.

## [0.4.1] - 2026-06-01

### Fixed

- **MCP config dual-context resolution**: the root `.mcp.json` used a bare relative `build/index.js` path, which failed to connect from a clone because relative paths resolve against the launching process's working directory rather than the repo root. The plugin (`.claude-plugin/plugin.json`) declared no `mcpServers`, so it auto-loaded that same broken relative `.mcp.json` and failed in a plugin's cwd as well. The two distribution paths are now decoupled: the root `.mcp.json` uses `${CLAUDE_PROJECT_DIR:-.}/build/index.js` for the clone/contributor workflow, and `plugin.json` declares its own `mcpServers` using `${CLAUDE_PLUGIN_ROOT}/build/index.js` for marketplace plugin installs. Because the plugin now declares its own `mcpServers`, it no longer auto-loads the root `.mcp.json`, eliminating double-registration. Mirrors the same fix shipped in apple-mail-mcp.

## 0.4.0 — 2026-04-09

### Added

- **Cell styling**: set-cell-style and set-cells-style-batch for font, size, colors, number format, alignment (via AppleScript, requires Numbers.app)
- **Layout**: set-column-width and set-row-height tools
- **Cell merging**: merge-cells and unmerge-cells tools
- Styled round-trip fidelity test (read styles → recreate → compare)
- getCellStyle utility for reading cell formatting via AppleScript

## 0.3.0 — 2026-04-09

### Added

- **Formula support**: set-formula and set-formulas-batch tools for writing formulas via AppleScript (requires Numbers.app)
- Round-trip fidelity test against real-world spreadsheets

### Fixed

- Header cells now use consistent date formatting (2023-01-01 instead of 2023-01-01 00:00:00)
- Null headers preserved instead of writing Column_N placeholders
- Empty rows now properly expand table dimensions in add-rows
- Publish workflow only triggers on release creation (not every CI push)

## 0.2.0 — 2026-04-09

### Added

- **Write support**: create-spreadsheet, set-cell, set-cells-batch, add-rows, delete-rows, update-rows
- **Structure management**: add-sheet, add-table, rename-sheet, rename-table
- **Import**: import-csv tool to convert CSV/TSV/JSON files into .numbers spreadsheets
- **Range reads**: read-table now supports startRow, endRow, and columns filtering
- **Cell metadata**: get-cell verbose mode returns formula, formatted value, and merge info
- `npm run test:integration` and `npm run test:all` scripts
- Integration tests now run correctly (fixed venv Python detection)
- Comprehensive integration tests for all write operations, range reads, import, and metadata

### Fixed

- Fixture generator now creates properly sized tables (no empty 12x8 padding)
- Integration test precondition check now uses venv Python (matches runtime behavior)

## 0.1.0 — 2026-04-04

### Added

- Initial release with read-only tools: health-check, get-file-info, read-table, search, export-table, get-cell
- Python bridge using numbers-parser for .numbers file format support
- Unit and integration test suites
- CI workflow with lint, typecheck, unit tests, integration tests, and build
