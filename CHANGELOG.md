# Changelog

## [Unreleased]

## [1.1.10] - 2026-07-22

### Security
- Override the MCP SDK's transitive `@hono/node-server` and `fast-uri` dependencies to patched releases (`@hono/node-server` 2.0.10, `fast-uri` 3.1.4), clearing the Hono static-file path-traversal advisory and the two `fast-uri` host-confusion advisories that the SDK's own ranges still resolve to. Fleet-wide companion to sweetrb/apple-notes-mcp#104 (@oliverames).


## [1.1.9] - 2026-07-20

### Changed

- Bump the Python sidecar's `numbers-parser` pin from 4.18.2 to 4.18.5. This is a runtime dependency — the sidecar is what reads `.numbers` files — so the pin ships. Verified before release against a real 3-sheet workbook (226-row, 61-row and 1949-row tables): `info` returns the correct sheet/table structure, `read` parses all 225 data rows with correct cell values, and stdout stays clean JSON. numbers-parser's `unsupported version` RuntimeWarning for newer `.numbers` file formats is emitted on stderr only, so it cannot corrupt the sidecar's JSON channel.

## [1.1.8] - 2026-07-20

### Changed

- CI/release hardening: `version-guard` now treats the committed `build/` bundle as shipped bytes (closing the lockfile-only and devDep silent-never-publish vectors) with an npm version-collision check; `publish.yml` gained a daily self-healing watchdog, manual dispatch, exact-version skip, CI-validated-commit checkout, and GitHub-Release self-heal; Dependabot bundle rebuilds now auto-bump a patch version; CI boots the committed bundle standalone on Node 20 every run; the bundle is now built with `--target=node20`, making the `engines.node >= 20` claim enforced at build time.
- `requirements.txt` is now exact-pinned and under Dependabot pip management; CodeQL scans the Python sidecar.

## [1.1.7] - 2026-07-09

### Fixed

- **Sidecar errors on a non-zero exit are no longer swallowed.** The Python sidecar reports failures as structured JSON on stdout (`{"error": ...}`) before exiting 1, but `execFileSync` throws on the non-zero exit and the wrapper only inspected stderr — so every sidecar failure (bad file path, unreadable document, even the import guard's "numbers-parser not installed") degraded to a generic `Command failed: <python> <args>`. The wrapper now recovers the JSON error from the thrown error's stdout first, normalizes missing-dep reports through the usual setup hint (keeping the auto-bootstrap retry working), and only then falls back to stderr / the exec message. (Same fix as apple-photos-mcp.)

## [1.1.6] - 2026-07-09

### Changed

- **Actionable no-clone error messages.** Every "Run: npm run setup" hint (the sidecar's `numbers-parser not installed` error, the TS wrapper's setup hint, the Python-not-found error, and the `doctor` detail strings) now gives guidance that works _without_ a repo checkout: `pip3 install numbers-parser` (noting it requires Python >= 3.11 while stock macOS ships 3.9 — `brew install python@3.12`), `scripts/setup.sh` from a checkout, a pointer to the `doctor` tool, and an absolute link to https://github.com/sweetrb/apple-numbers-mcp#troubleshooting. `npm run setup` was a dead end for npx/global-install users, who have no repo to run it in.
- **`doctor` now reports the resolved Python interpreter** as a new `python_interpreter` check — path + version, warning when it's older than 3.11 — so the most common failure (stock macOS Python 3.9) is visible at a glance instead of hiding behind a generic "numbers-parser not installed".

### Docs

- **README install commands now install from the npm registry** (`npm install -g apple-numbers-mcp`) instead of `github:sweetrb/apple-numbers-mcp` — the GitHub form builds on the user's machine and requires pnpm, so it's now documented only under **From Source**, labeled accordingly.
- **Deterministic Claude Code one-liner** added to Quick Start: `claude mcp add apple-numbers -s user -- npx -y apple-numbers-mcp`.
- **Plugin-marketplace Quick Start explains the first-call venv bootstrap** — the plugin runs from its clone under `~/.claude/plugins/marketplaces/apple-numbers-mcp/`, and the first tool call auto-builds a Python venv there (~1 min; requires Python >= 3.11 on PATH), with the install directory named so "run `scripts/setup.sh` in the install directory" is followable.
- **Troubleshooting for "numbers-parser not installed" now leads with the real cause** — `python3` older than 3.11 (stock macOS = 3.9); install a newer Python and retry, the venv rebuilds automatically.
- **`docs/` now ships in the npm tarball** (added to package.json `files`), and all README cross-file links were converted from relative paths to absolute GitHub URLs so they resolve on npmjs.com and in the installed package, not just on GitHub.
- **README no longer claims Linux support** — the npm package declares `os: ["darwin"]`; Requirements now says macOS-only.
- **The Claude Code plugin now really ships a skill.** The README claimed the plugin installs a skill, but the plugin-root `skills/` directory didn't exist (only the Codex copy did). Added `skills/apple-numbers/SKILL.md` (mirroring the Codex skill, kept identical, matching apple-photos-mcp's layout), with its stale "npm run setup" / "macOS or Linux" wording fixed in both copies.

## [1.1.5] - 2026-07-06

### Fixed

- **A bare `git clone` / marketplace install now runs the server with only Node present.** Tracking `build/` (a previous release) put the compiled entrypoint in git, but `build/index.js` still `import`ed its dependencies (`@modelcontextprotocol/sdk`, `zod`) from `node_modules/`, which a plain clone / marketplace install lacks — so the server died on `ERR_MODULE_NOT_FOUND` before it could complete the MCP handshake. The build now **esbuild-bundles `src/index.ts` into a single self-contained `build/index.js`** (`tsc --noEmit` still type-checks; esbuild does the bundling), so the marketplace/git clone starts on Node alone with no install step. This mirrors the fix @oliverames landed for apple-notes-mcp (#69) and apple-mail-mcp (#79), and the matching change in apple-photos-mcp. The Python sidecar path logic was made **bundle-safe** alongside: `getProjectRoot()` now walks up to the directory that owns `package.json` + `src/utils/numbers_reader.py` instead of assuming a fixed `build/utils/ → ../..` depth, so the collapsed single-file bundle (where `index.js` sits at `build/index.js`, one level shallower) still resolves `numbers_reader.py`, the venv, `requirements.txt`, and `scripts/setup.sh` correctly.

### Changed

- **`.gitignore` now tracks only the bundled entrypoint** (`build/*` then `!build/index.js`) — per-module `tsc` output (e.g. from `pnpm run dev`) stays ignored. Added `esbuild` as a devDependency; dropped the now-unused `tsc-alias` devDependency and the `types` package.json field.

## [1.1.4] - 2026-07-03

### Fixed

- **`set-cell` / `set-cells-batch` now store a bare number as a real number cell.** Passing `value=30` (a JSON number, no explicit `type`) previously wrote a _text_ cell, so `read-table` returned `"30"` instead of `30` — inconsistent with `create-spreadsheet`, `add-rows`, `update-rows`, and `import-csv`, which all store the same value numerically. (Some MCP clients also deliver a JSON number as its string form, e.g. `"30"`, which fell through to the text branch.) The sidecar's value coercion now auto-detects a clean numeric string as a number when no explicit type is given, so bare numeric writes round-trip as numbers. Detection is conservative: leading-zero strings (`"007"`), surrounding whitespace, thousands separators (`"12,000"`), currency (`"$5"`), and exponent/`inf`/`nan` forms stay text, and an explicit `type="string"` (or `type="number"`) override is always honored.

## [1.1.3] - 2026-06-30

### Changed

- **Input bounds (defense-in-depth).** Every numeric index/dimension and batch/string input now carries a sane upper bound so a bogus value (e.g. `1e9`) can't flow into `numbers-parser`'s `table.write(huge_row, …)` and blow up memory or wedge the sidecar. Row/column indices (and `read-table`'s `startRow`/`endRow`, `delete-rows` / `merge` / `unmerge` corners) are capped at 1,000,000; `fontSize` at 1000 pt; column width / row height at 100,000 px; batch arrays (`updates`, `rows`, `formulas`, `entries`, `headers`) at 100,000 elements; and free-text strings get reasonable length caps (`query` 10,000; sheet/table/font names 1,024; header cells 1,024). All ceilings are far above any real spreadsheet. No valid input is newly rejected.

### Fixed

- **Actionable number/date coercion errors.** Writing a non-numeric string to a cell typed as `number` (or a non-ISO string to a `date` cell) previously surfaced a raw Python `could not convert string to float: 'abc'`. The Python sidecar now catches these and raises a message that names the offending value and the cell — e.g. `Cannot write value 'abc' at cell (3,2) as a number. …` — across `set-cell`, `set-cells-batch`, `add-rows`, `update-rows`, and `create-spreadsheet`. Write behavior is unchanged.
- **Bootstrap venv setup no longer risks `ENOBUFS`.** The one-time automatic venv bootstrap (`scripts/setup.sh`) ran `execFileSync` with Node's ~1 MB default `maxBuffer`; a chatty `pip install` (numbers-parser pulls in pandas, etc.) could exceed it and fail an otherwise-successful setup. It now uses a 64 MB buffer.

### Docs

- **Corrected the `set-cell-style` / `set-cells-style-batch` Tool Reference.** The README documented a `style` object with non-existent keys (`font`, `color`, `fillColor`, `bold`, `italic`, `numberFormat`). It now matches the real `cellStyleSchema` exactly: `fontName`, `fontSize`, `textColor`, `backgroundColor`, `format`, `alignment`, `verticalAlignment`, `textWrap` (colors are RGB 0–65535; there is no `bold`/`italic` flag — choose a font face that encodes the weight).
- **Corrected the `rename-sheet` / `rename-table` parameter tables.** They invented an `oldName` _input_; the schemas actually take `{ path, newName, sheet?, table? }` and identify the target by the current `sheet`/`table` name (the old name is an output field). Split into two accurate tables.
- **Documented `null`-cell semantics.** `null` in a cell value is a no-op — it leaves the cell unchanged (it does **not** clear it). Added to the `value`/`values`/`rows` descriptions for `set-cell`, `set-cells-batch`, `add-rows`, and `update-rows`.
- **Documented two previously-undocumented env vars** in the README Configuration table: `APPLE_NUMBERS_MCP_NO_AUTO_SETUP` (disable the automatic venv bootstrap) and `APPLE_NUMBERS_MCP_SETUP_TIMEOUT` (bootstrap timeout in ms).
- **Documented the last-writer-wins risk for concurrent writes** to the same `.numbers` file in `docs/LIMITATIONS.md` (and the README summary): saves are atomic, so files are never torn, but overlapping writes can lose updates — serialize writes per file.
- **Developer/contributor commands switched from `npm` to `pnpm`** in the README install/development blocks and CLAUDE.md (the repo is pinned to `pnpm@11.9.0`; CI and publish use pnpm). End-user `npx` / global-install invocations and the literal runtime error string (`numbers-parser not installed. Run: npm run setup`) are unchanged.

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
