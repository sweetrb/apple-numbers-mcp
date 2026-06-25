# Changelog

## [Unreleased]

## [1.1.2] - 2026-06-25
### Fixed
- Added a process-level uncaughtException/unhandledRejection safety net so a stray error or a broken stdout pipe (EPIPE) on client disconnect can no longer crash the long-lived server; EPIPE now exits cleanly.


## [1.1.1] - 2026-06-24
### Security
- **The `doctor` dependency probe no longer builds a shell command.** `checkDependencies` previously interpolated the resolved interpreter path into a shell string passed to `execSync`; it now uses `execFileSync(python, ["-c", …])` (argv array, no shell), matching the reader path. This eliminates a CodeQL `js/shell-command-injection-from-environment` finding (defense-in-depth — the path is install-derived, not user-supplied). The system-Python probe keeps a `execSync` over hardcoded `python3`/`python` literals, now documented as non-injectable.

## [1.1.0] - 2026-06-23
### Added
- **All tools now declare an MCP `outputSchema`.** Every tool migrated from `server.tool(...)` to `server.registerTool(...)` so its structured-output shape is advertised in the tool metadata and validated by the SDK. Schemas are intentionally permissive (all fields optional, no `.strict()`, loose element types for arrays) so they describe the output contract without ever rejecting a valid result. No tool names, inputs, descriptions, or handler behavior changed.

### Changed
- **Rewrote the Hermes Agent packaging to match NousResearch's real spec.** `.hermes-plugin/` previously shipped Claude-format JSON (`plugin.json` / `marketplace.json` / `mcp.json`) that Hermes never reads; it now provides a `config.yaml` (a `~/.hermes/config.yaml` `mcp_servers:` snippet) plus a README with the `hermes mcp add` command. The README "Other Hosts" section is corrected to match (Hermes has no plugin/marketplace drop-in; Antigravity uses its native `mcp_config.json`). Claude Code, Codex, and Antigravity packaging are unchanged.

## [1.0.0] - 2026-06-23

First stable release. The public tool API (read / write / formula / format / import for `.numbers` files) is now committed under semver 1.0. This release focuses on production hardening.

### Added
- **CONTRIBUTING.md and SECURITY.md.**

### Changed
- **Bumped `@modelcontextprotocol/sdk` to ^1.29.0**, clearing all `npm audit` advisories (transitive, from the SDK's unused HTTP transport) — `npm audit --omit=dev` is now clean.
- **Pinned the Python dependency range** (`numbers-parser>=4.0.0,<5.0`) so a future incompatible major can't be silently installed, keeping the 1.0 output contract reproducible.

### Fixed
- **Atomic file saves.** Every command that modifies an existing `.numbers` file now saves to a sibling temp file and `os.replace()`s it onto the target (atomic on the same filesystem), so an interrupted or failed save can no longer corrupt or truncate the user's only copy. This was the last gap before a confident 1.0, since several mutations (e.g. `delete-rows`) are not undoable.
- **Python version is gated.** `scripts/setup.sh` now prefers a Python ≥ 3.11 interpreter and fails fast with actionable guidance if only an older one (e.g. macOS's stock 3.9) is found, instead of building a broken venv. README updated to state **Python 3.11+**.
- The sidecar's missing-dependency hint now points at `npm run setup` (project venv) instead of a bare `pip3 install`.
- **Release reliability:** the `npm install -g npm@latest` step in `publish.yml` now retries, so a transient registry `ECONNRESET` no longer aborts a release.

## [0.6.2] - 2026-06-23
### Fixed
- **Codex marketplace shipped the Apple Notes icon for Apple Numbers (#7).** Replaced `codex/assets/icon.png` (and added an `icon.svg` source) with a Numbers-specific icon — a green card with a bar-chart glyph, part of a consistent Apple MCP icon family. Thanks @oliverames for the hash-level diagnosis.

### Documentation
- README: added npm-downloads, supported-Node, platform-macOS, and MCP badges next to the existing version/CI/License badges.

## [0.6.1] - 2026-06-22
### Added
- **Hermes and Antigravity plugin packaging.** Adds `.hermes-plugin/` (`plugin.json`, `marketplace.json`, `mcp.json`) and `.antigravity-plugin/` (`plugin.json`, `marketplace.json`, `mcp_config.json`, plus the Apple Numbers skill) so the server installs from the Hermes and Antigravity hosts the same way it already does for Claude Code and Codex (launched via `npx -y apple-numbers-mcp`). This brings apple-numbers-mcp to multi-host plugin-packaging parity with the other Apple MCP servers (apple-mail-mcp, apple-notes-mcp). The new manifests are wired into `scripts/sync-plugin-version.mjs` so their versions track `package.json`. Note: as with every install path, the `numbers-parser` Python sidecar must be available (see the README — `pip3 install numbers-parser` or the auto-bootstrap).
- **Codex plugin marketplace packaging** ([#5](https://github.com/sweetrb/apple-numbers-mcp/pull/5)). Adds a `codex/` plugin package and `.agents/plugins/marketplace.json` so the server installs from Codex's marketplace alongside the Claude Code plugin (launched via `npx -y apple-numbers-mcp`), plus the Apple Numbers skill, and wires the new manifests into `scripts/sync-plugin-version.mjs` so their versions track `package.json`. Note: as with every install path, the `numbers-parser` Python sidecar must be available (see the README — `pip3 install numbers-parser` or the auto-bootstrap). Thanks @oliverames.

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
