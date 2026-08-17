## [Unreleased]

## [1.2.1] - 2026-08-16

### Fixed

- **The path boundary was enforced but not documented where it is read.** 1.2.0
  bounded the `.numbers` file itself to the allowed roots, but only the three
  tools that had always been bounded (`export-table`, `create-spreadsheet`,
  `import-csv`) said so in their descriptions. The other **21** path-taking
  tools — `read-table`, `search`, `set-cell`, `set-formula` and the rest — said
  nothing, so a caller could be refused for a reason it had no way to
  anticipate.

  A tool description is the only place an AI assistant learns a constraint
  *before* it calls the tool. A bound that lives only in the README gets
  discovered as a runtime failure instead of avoided.

  All 21 now carry the boundary note, appended last so each description keeps
  its `Use when / Returns / Do not use when / Safety` shape. It is defined
  **once** and interpolates the roots list and the env var name from the module
  that owns them, so 21 copies cannot drift apart.

### Internal

- A conformance test asserts that **every** tool taking a file path documents
  the boundary, and names the offenders when one does not. Adding a new
  path-taking tool without the note now fails CI rather than shipping a silent
  documentation gap.

## [1.2.0] - 2026-08-16

### Security

- **The `.numbers` file itself is now bounded by the allowed roots.**
  `validatePath()` — the resolver behind `get-file-info`, `read-table`, `search`
  and every in-place write (`set-cell`, `add-rows`, `set-formula`, …) — expanded
  `~`, called `resolve()` and checked the extension, and nothing else. So those
  tools could read and modify a `.numbers` file **anywhere on disk**, while its
  sibling `validateOutputPath` had enforced the boundary since 1.1.19. That
  asymmetry — existing-file reads and in-place writes versus new-file outputs —
  was the largest remaining gap in this server.

  It now goes through the same `resolveWithinAllowedRoots` as the write side,
  which also brings the hardening that came with it: canonicalization via
  `realpathSync.native`, so a case-respelled segment cannot defeat the check on
  case-insensitive APFS, and symlink resolution **before** the comparison, so a
  link inside an allowed directory cannot point out of it. The extension is
  checked on the canonical path, so a symlink cannot present a `.numbers` name
  for a target that is something else.

  **This can reject paths that previously worked.** The built-in roots cover
  your home directory, the temp dirs and `/Volumes` — where external and network
  mounts appear — so a spreadsheet you could plausibly want to open is almost
  always already inside them. For the layouts they are not, see below.

### Added

- **`APPLE_NUMBERS_MCP_EXTRA_ROOTS`** — colon-separated absolute directories to
  add to the allowed roots, e.g. `/Data/Finance:/srv/shared`.

  Deliberately opt-in and environment-only: the boundary is a security property,
  so widening it should be a decision the operator makes once, not something a
  tool argument can do per call. Entries are canonicalized like the built-ins, so
  a symlinked entry cannot smuggle in a wider parent, and relative or empty
  entries are ignored rather than silently resolving against the process cwd.

### Changed

- **Supply-chain soak raised from 1 day to 7 days** (`minimumReleaseAge: 10080` in
  `pnpm-workspace.yaml`). This is a development/CI-time policy — no shipped bytes change.
  It is not redundant with Dependabot's existing 7-day cooldown: the cooldown governs only
  what Dependabot *proposes* (direct dependencies), while `minimumReleaseAge` governs
  everything a resolution *installs*, including transitive packages Dependabot never sees.
  Verified against this repo's committed lockfile, which needs no churn to satisfy it.
  Prompted by [sweetrb/apple-mail-mcp#174](https://github.com/sweetrb/apple-mail-mcp/pull/174)
  (@anupamme), applied across all four Apple MCP repos so the value cannot drift.

## [1.1.19] - 2026-08-14

### Security

- **`export-table`, `create-spreadsheet` and `import-csv` would read and write ANY absolute path the caller named — this server had no filesystem boundary at all.** It was the outlier of the four Apple MCP servers; mail, notes and photos each have one. `resolvePath()` expanded `~` and called `resolve()` and did nothing else, and `validateOutputPath()` checked only for a `.numbers` extension, so an `outputPath` of `/Library/LaunchAgents/com.evil.plist`, `/etc/cron.d/x`, or a path inside an app bundle was written unconditionally, and `import-csv`'s `inputPath` could read any file on disk. Those paths reach the tools from the model, so a prompt-injected or simply confused agent had a write-anywhere primitive. All three now resolve through a new allowlist (`src/utils/exportPath.ts`, mirroring apple-photos-mcp's module of the same name): the path must resolve — after `~` expansion **and symlink resolution** — to a location under the **home directory**, `/tmp`, `/private/tmp`, or `/Volumes`, and anything else is rejected with an error naming the resolved path and those roots. Symlinks are resolved before the check even when the target does not exist yet (the deepest existing ancestor is canonicalized and the not-yet-created remainder re-appended), so a link under `/tmp` pointing at `/etc` is refused; and the `.numbers` extension check now runs on the **canonical** path, so a symlink cannot present a `.numbers` name for something that isn't one. Two details are copied deliberately from apple-mail-mcp's implementation: canonicalization uses `fs.realpathSync.`**`native`** rather than the JS emulation — which resolves symlinks but preserves the caller's casing, so on case-insensitive APFS one spelling of a path compares differently from another spelling of the same file — and membership is a path-**segment** test (`candidate === root || candidate.startsWith(root + sep)`) rather than a bare `startsWith`, so `/Volumes-evil` and `<home>-evil` cannot ride in on a shared prefix. **Overwrite semantics are unchanged**: within the allowed roots an existing file at the target path is still overwritten, as all three tools have always documented — the path is caller-supplied rather than attacker-named, so this adds the root boundary only. The guard was verified by breaking it three ways and watching the new tests fail: removing the check fails 21 of 67, swapping the native realpath for the JS one fails 1, and replacing the segment test with a bare `startsWith` fails 5. Verified against the real numbers-parser sidecar as well as in unit tests — a real CSV imports and a real `.numbers` table exports under `/tmp`, an export re-run over an existing file still overwrites it, and writes to `/etc`, `/Applications` and a `/tmp` symlink pointing at `/private/etc` are all refused with nothing created.

- The boundary resolves a **dangling** symlink rather than walking past it. `existsSync`
  follows links, so a broken link read as "not created yet", was re-appended verbatim and
  never canonicalized — and the sidecar then followed it on write. Presence is now tested
  with `lstat`, and a link whose target does not exist yet is resolved by hand so the check
  runs against the location the write would actually create.
- `os.tmpdir()` (`/var/folders/<hash>/T`) is an allowed root. It is what Node, Python's
  `tempfile` and `$TMPDIR` all return on macOS — and what this repo's own fixtures use — so
  omitting it refused the most ordinary scratch destination there is.

## [1.1.18] - 2026-08-13

### Documentation

- Retagged the project-scope `.mcp.json` entrypoint excerpt from ```json to ```text. The block is a single `"args": [...]` key/value fragment, not a JSON document, so it never parsed — a reader copying it as JSON got a syntax error. Added guards that keep every documented example honest: every ```json fence across README.md, CLAUDE.md and docs/ must parse, every documented `APPLE_*_MCP_*` environment variable must exist under src/, and the README `## Tool Reference` must document exactly the tools the built server advertises — in both directions, so neither an undocumented new tool nor a leftover entry for a removed one can pass.

## [1.1.17] - 2026-08-12

### Fixed

- **Every tool was rejected by the client, because the advertised schemas declared JSON Schema draft-07.** MCP has standardized on **2020-12**, and hosts now refuse anything else — `Tool '<name>' has an invalid outputSchema: JSON Schema declares an unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#"). The default validator supports JSON Schema 2020-12 only.` The server starts and connects normally, so the failure presents as all 26 tools silently unavailable rather than as a crash. The dialect comes from the MCP SDK, not from this repo: `server/mcp.js` calls its Zod converter with **no `target`**, `mapMiniTarget(undefined)` resolves to `draft-7`, and every `inputSchema` and `outputSchema` is stamped draft-07 on the way out. **Upgrading Zod does not fix it** — both the v3 (`zod-to-json-schema`) and v4 (`zod/v4-mini` `toJSONSchema`) branches fall back to draft-07 without a target, verified empirically against SDK 1.30.0 + Zod 4.4.3 — so no dependency bump could have cleared this. The outgoing `tools/list` payload is now normalized at the **transport boundary**, the only public seam that does not reach into SDK internals: the 2020-12 dialect is re-stamped at each schema root, nested `$schema` declarations are stripped (illegal on a subschema), and the keywords that changed between the drafts are rewritten — `definitions` → `$defs` with its `#/definitions/…` `$ref`s repointed, tuple-form `items` → `prefixItems`, `additionalItems` → `items`, `dependencies` split into `dependentRequired`/`dependentSchemas`, and boolean `exclusiveMinimum`/`exclusiveMaximum` collapsed onto the numeric bound. Today's emitted schemas use **none** of those constructs, so the rewrite is a no-op on current output — it exists so a Zod construct added later cannot quietly reintroduce a draft-07-only keyword alongside a 2020-12 declaration, which would be worse than the bug it replaces. No tool, Zod schema, or handler changed; all 26 tools still register, and each now advertises `https://json-schema.org/draft/2020-12/schema` on both its input and output schema. Reported against the sibling server as sweetrb/apple-mail-mcp#147; all four Apple MCP servers were affected identically and are fixed in lockstep.

- **The dialect converter is now POSITION-AWARE, so it cannot corrupt a tool parameter that happens to be named after a schema keyword.** The first cut of the converter recursed uniformly and then switched on every key it met — but the keys of a `properties` map are caller-chosen **tool parameter names**, not schema keywords. A tool declaring a parameter named `definitions` would have had it renamed to `$defs` on the wire; one named `$schema` would have been **silently deleted** while `required` went on naming it, producing a schema **no input can satisfy**; `dependencies` would have been restructured into `dependentRequired`/`dependentSchemas` and `additionalItems` dropped outright. The same class applied to instance **data**: `enum`, `const`, `default` and `examples` hold a caller's literal values, and recursing into them rewrote those literals as if they were schema keywords — a `default` of `{ "definitions": 1 }` came back as `{ "$defs": 1 }`. The walk now distinguishes the three positions: a name → schema map (`properties`, `patternProperties`, `$defs`, `dependentSchemas`) has only its **values** converted and its keys copied verbatim; data keywords (`enum`, `const`, `default`, `examples`, `required`, `dependentRequired`) pass through untouched; everything else is a schema and recurses as before. Verified latent, not live: no server in the fleet hits a corrupting name today — apple-notes-mcp's `get-checklist-state` has an output property named `items`, which happens to land in a safe branch — so this is fixed **before** the release rather than after. The advertised `tools/list` payload for all 26 tools is **byte-identical** across the fix (SHA-256 `8eb7f7b7…45ac3f10` before and after), which is exactly the expected result for a latent defect.

### Added

- **The `outputSchema` contract test now asserts the advertised dialect.** The existing checks boot the real built server over stdio and inspect what it advertises — every tool has an `outputSchema`, none requires a field, none sets `additionalProperties: false` — but none of them looked at `$schema`, so a dialect that made the client discard **every** tool passed CI cleanly. The suite now fails any advertised schema that does not declare 2020-12, that mentions `draft-07` anywhere, that uses a draft-07-only keyword (`definitions`, `dependencies`, `additionalItems`), or that declares `$schema` on more than one node. Unit tests for the converter itself cover each keyword rewrite and the transport wrapper.

## [1.1.16] - 2026-08-12

### Changed

- **Bumped the `numbers-parser` runtime pin from 4.18.5 to 4.19.0.** This is the Python sidecar that backs every read and every value/structure write, so it is a **runtime** dependency of the published package — `requirements.txt` is shipped bytes and the bump owes a version bump, which Dependabot cannot add on a pip PR. Upstream fixes cell-border rendering (masaccio/numbers-parser#152), the performance of `Table.set_cell_border()`, and row height / column width after border manipulation; the minor bump is because border *behaviour* changed — layers of borders are no longer retained. This server never calls the border API, so that change is not reachable from any tool here. Verified against real spreadsheets rather than trusting CI, since the unit tests mock the sidecar: `info`/`read`/`create`/`set-cell` all exit 0 with **clean JSON on stdout and empty stderr**; a 226-row × 8-column real inventory file round-tripped a `set-cell` write and re-opened with its row and column counts intact; `doctor` reports `numbers-parser 4.19.0` healthy; and `get-file-info` / `read-table` return correct data end-to-end through the MCP server. (#60)

### Security

- **Floored `js-yaml` to `^4.3.1`, clearing GHSA-5p4m-2wfm-xmqj (high).** Quadratic CPU consumption while resolving `!!omap` keys — a malicious YAML document can be made to burn CPU superlinearly in the number of map entries. The advisory notes the CVE-2026-59870 fix was never backported to the 3.x line, so 4.3.1 is the first complete release. `js-yaml` reaches the tree as `eslint` -> `js-yaml`, which is **development scope**, and it does not appear in the committed `build/index.js` — verified, 0 references — so no published artifact ever carried it and this owes no version bump. No `js-yaml` override existed here before; apple-mail-mcp carried one pinned at `^4.2.0` — below this fix — which is how the gap was found.

## [1.1.15] - 2026-08-06

### Fixed
- **Every tool advertised an output schema that rejected undeclared keys, discarding otherwise-correct results.** The MCP **client** validates a result's `structuredContent` against the JSON Schema the server *advertised*, not against the server's own zod object — and a bare zod raw shape renders as `additionalProperties: false`. So any field a handler emits that its schema doesn't enumerate is a hard client-side `-32602 … data must NOT have additional properties`, throwing away a payload the handler computed correctly. The server never notices, because zod's own parse silently *strips* unknown keys instead of failing, which is exactly why the `registerTool`/`outputSchema` migration's "all fields optional, no `.strict()`" read as permissive: it covered optionality, not undeclared keys. All **26 tools** in this repo were advertising `additionalProperties: false`. Every tool now registers through a wrapper applying `.passthrough()`, advertising `additionalProperties: true` — the contract that migration intended. Found while fixing the same defect in the sibling apple-mail-mcp (sweetrb/apple-mail-mcp#135), where it was not latent: it broke `get-mail-stats` on every call for anyone with IMAP configured.

### Added
- **The outputSchema contract test now asserts that every tool tolerates undeclared keys.** The existing checks — every tool has an `outputSchema`, none requires a field — could not see this class, because they inspect the advertised schema and round-trip only the diagnostic tools; a tool whose payload carries an undeclared key passes CI and fails in the user's client. The suite now fails any tool advertising `additionalProperties: false`, so this cannot silently return.

## [1.1.14] - 2026-08-05
### Changed
- Dependency bump via Dependabot; committed bundle rebuilt. (automated)

## [1.1.13] - 2026-08-04

### Fixed
- **`doctor` reported "Numbers.app not found" on every Mac that had upgraded, even with Numbers running in front of you.** The check tested two hard-coded paths, `/Applications/Numbers.app` and `/System/Applications/Numbers.app`. Apple's 2026 iWork refresh renamed the bundle to **`Numbers Creator Studio.app`** and moved the bundle ID from `com.apple.iWork.Numbers` to **`com.apple.Numbers`**, so neither path could ever match again and the check emitted a permanent false `warn` telling users the formula and formatting tools were unavailable when they were fine. Only the diagnostic was wrong — the AppleScript tools themselves target the app by name (`CFBundleName` is still `Numbers`), so `set-formula`, `set-cell-style`, `set-column-width`/`set-row-height` and `merge-cells`/`unmerge-cells` were working the whole time. Detection now tries the known paths (including the new name) and then falls back to **Launch Services**, resolving `path to application id` for `com.apple.Numbers` and then the pre-2026 `com.apple.iWork.Numbers`. That is a registry lookup: it does not launch Numbers and needs no Automation permission. Resolving by bundle ID rather than by path is what makes the check survive the *next* rename too, and accepting both IDs keeps it correct on machines that never upgraded. The reported detail now names the resolved bundle path, so a surprising location is visible rather than silently accepted. A Launch Services answer pointing at a path that no longer exists (a stale registration) still warns.

## [1.1.12] - 2026-08-03

### Security
- **Floored `hono` to `^4.12.34`, clearing GHSA-8j4g-w8fx-2239 (moderate).** This was deferred earlier the same day: the fix release was still inside the repo's 24-hour `minimumReleaseAge` soak — it missed by under three minutes — and no `minimumReleaseAgeExclude` carve-out was added, because the soak is the point. It matured at 2026-08-04T02:36:40Z and is floored now. `pnpm audit` reports **no known vulnerabilities**.

### Added
- **`version-guard` now requires every version bump to be documented under a real `## [X.Y.Z]` CHANGELOG heading.** The guard already refused a bump to a version that was already on npm, but it never checked that the new version was described anywhere. Notes parked under `## [Unreleased]` are orphaned the moment the release ships: nothing in the release path renames that section — the `version` lifecycle script only syncs the plugin manifests — so the published version goes out undocumented while its release notes sit under a heading still claiming they are unreleased. apple-notes-mcp shipped 2.6.10 and 2.6.11 exactly that way before this check existed. A bump whose version has no matching heading now hard-fails the PR, with an error naming the heading to add. Keep an empty `## [Unreleased]` at the top regardless — `dependabot-rebuild.yml` hard-exits without that marker, and since it already inserts a real heading, bot PRs pass unchanged. The guard file lives in `.github/`, which does not ship, so this owes no version bump. Matches apple-mail-mcp#124, keeping the guard identical across the four servers. (#50)

### Removed
- **`.hermes-plugin/` packaging docs** (`README.md`, `config.yaml`). Hermes Agent has no plugin/marketplace drop-in, so a directory of manifest-looking files was easy to misread as an installable package. The setup it documented is not lost — the `hermes mcp add` command, the `~/.hermes/config.yaml` `mcp_servers:` snippet, and the restart note now live inline in the README's "Other Hosts" section. Matches apple-mail-mcp#116, keeping multi-host packaging parity across the four Apple MCP servers. No effect on the published package: `.hermes-plugin/` was never in `package.json` `files[]`.

### Fixed
- **`version-guard` no longer demands a version bump for byte-neutral `src/` changes.** The shipped-bytes detector treated every non-test file under `src/` as shipped, but TypeScript there reaches users only after esbuild inlines it into `build/index.js` — so a comment-, formatting- or type-only edit that leaves the committed bundle byte-identical was hard-blocked, leaving only two bad options: publish a release of literally nothing, or do not write the comment. `src/**/*.ts` is now a first-cause detector that implies a bump only when `build/**` changed too. The exemption is sound rather than merely convenient: ci.yml's "Verify committed build/ matches source" step rebuilds and requires `git diff --quiet build/`, and it runs in the `test` job whose `test (22)`/`test (24)` contexts are required by branch protection — so at merge time an unchanged `build/` provably matches `src/`. Everything else under `src/` (the verbatim-shipped `*_reader.py` sidecars), `requirements.txt` and `build/**` stay unconditional detectors, and the rule is written fail-safe: only `.ts` counts as bundle-only, so any new file type under `src/` still requires a bump.
- **Dependabot auto-bump silently stopped staging its own changes.** `dependabot-rebuild.yml`'s bump step writes the patch version, syncs the plugin manifests and prepends a CHANGELOG entry, then staged them with `git add package.json CHANGELOG.md build .claude-plugin .agents codex .hermes-plugin .antigravity-plugin`. Once `.hermes-plugin/` was removed that pathspec matched nothing, and `git add` is all-or-nothing — it exited 128 and staged **none** of the others, with `2>/dev/null || true` hiding the failure. The following step re-adds only `build/`, so a Dependabot PR would have committed a rebuilt bundle with no version bump and no changelog entry, failing `require-version-bump` and blocking the automation that is meant to run without a human. Dropped the stale path, and dropped the error suppression so a future missing path fails loudly instead of silently skipping the bump.
- **`pnpm version` no longer breaks with the `.hermes-plugin/` removal.** The `version` lifecycle script listed `.hermes-plugin` in its `git add`; `git add` exits 128 on a pathspec that matches nothing, which would have broken the documented release step (`pnpm version <patch|minor|major> --no-git-tag-version`) for every subsequent release. The stale path is dropped from the `git add` list.

### Security
- **`fast-uri` 3.1.4 → 3.1.5, clearing GHSA-7p8r-x3mc-p8w7 (high) — and this one was in the shipped bundle.** `fast-uri` reaches the published package for real: `@modelcontextprotocol/sdk` → `ajv` (and `ajv-formats`) pull it, and esbuild inlines its source into `build/index.js`, so the committed bundle carried the vulnerable copy and changed by 1,127 bytes when the fix landed — hence the version bump. **The floor was already here and was the thing holding the tree back.** `pnpm-workspace.yaml` read `fast-uri: 3.1.4`, written as an *exact pin* when 3.1.4 was the newest release; the moment 3.1.5 shipped that pin stopped acting as a floor and became a **ceiling**, pinning the tree to the vulnerable version so the advisory could never clear no matter how many times Dependabot re-ran. Rewritten as the caret range `^3.1.5`, which stays inside `ajv`'s expected major while letting future patch fixes flow in. Every floor in this file is now a caret range for that reason — an exact pin is a security floor that silently expires. Matches apple-mail-mcp 2.10.2 (#128), which hit the identical trap.
- **`ip-address` 10.2.0 → 10.4.0, clearing GHSA-mwp4-54f8-5fhr (high), GHSA-4xrf-jv44-h6hh and GHSA-22jq-vg5j-6vgg.** `@modelcontextprotocol/sdk` → `express-rate-limit` capped it at 10.2.0, below the 10.3.1 fix; floored at `^10.3.1`, which resolves to 10.4.0. Unlike `fast-uri` this is **not** in the shipped bundle — the SDK's HTTP transports are tree-shaken out of the stdio-only server, and `grep -c ip-address build/index.js` returns 0 — so the exposure was to the install tree, not to anything this package runs. Fixed anyway to keep the dependency graph clean and the Dependabot alert list actionable.
- **Deferred: `hono` (GHSA-8j4g-w8fx-2239, moderate), still resolving to 4.12.27.** The fix is 4.12.34, published 2026-08-03T02:36:40Z — roughly three minutes inside this repo's 1440-minute `minimumReleaseAge` window at the time of the change, so `pnpm install` refused it with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. That gate is deliberate supply-chain policy and clearing it by three minutes is exactly the kind of exception it exists to prevent, so **no `minimumReleaseAgeExclude` carve-out was added** and the floor was left out rather than forced. `hono` is not in the shipped bundle either (`grep -c` returns 0; it arrives via `@hono/node-server`, whose HTTP transport this stdio server never loads), so the published package is unaffected. `pnpm audit` will keep reporting this one moderate finding until the floor `hono: ^4.12.34` is added in a follow-up, which is now a one-line change.
- **Floored all three dev-only `brace-expansion` majors on their complete fixes for GHSA-mh99-v99m-4gvg / CVE-2026-14257 (high)** — `1.1.16` → `1.1.18`, `2.1.2` → `2.1.4`, and both `5.0.7` and `5.0.8` → `5.0.9`. Three separate majors are reachable through the dev toolchain (`eslint` → `minimatch@3` on v1, `minimatch@9` on v2, `minimatch@10` on v5), and they are not API-compatible — minimatch 3 requires the v1 CommonJS API, so a single floor spanning them fails with `expand is not a function`. Each major therefore carries its own **two-sided** floor; the bounds must be two-sided because a bare `<5.0.9` also matches `1.1.18` and `2.1.4` under semver and would drag the CommonJS path onto the v5 ESM API. The advisory's own first-patched versions (`1.1.17` / `2.1.3` / `5.0.8`) are **not sufficient**: they bound the accumulator in `combine` but never thread `maxLength` into `expandSequence`, so the sequence path (`{1..N}`, `{a..z..k}`) stays capped only by item count and a padded sequence still materialises ~100,000 intermediate strings before the outer bound truncates (measured 4,606 ms / 176 MB RSS on `1.1.17` vs 9 ms / 61 MB on `1.1.18`, identical final output). Two of the four paths resolved here (`1.1.16`, `5.0.7`) were below even the advisory's floor. Adopted only after every release cleared this repo's 24-hour `minimumReleaseAge` gate, with no `minimumReleaseAgeExclude` carve-out and no audit suppression — `pnpm audit` will keep reporting the advisory until GitHub's metadata (which still lists `5.0.8` as first-patched, and so marks the entire v1 line vulnerable under semver) catches up. Dev toolchain only: `brace-expansion` is not in the shipped bundle, so the published package is unaffected, the committed bundle is byte-identical, and no version bump is owed. Matches apple-mail-mcp#123 — thanks to @jjoanna2-debug for the original finding.
- **postcss 8.5.16 → 8.5.24** (dev-only transitive, via vite/vitest). Clears Dependabot alert #6 (GHSA high): "PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure", whose vulnerable range is `<= 8.5.17`. postcss is not a runtime dependency and is not inlined into the committed bundle (verified byte-identical after a rebuild), so nothing that ships to npm changes — this was a stale lockfile resolution, not a code defect. The sibling repos were already above the range (mail 8.5.23 behind an explicit `^8.5.15` override floor, notes and photos 8.5.19), which is why the alert fired only here.

## [1.1.11] - 2026-08-03

### Fixed

- **The documented backend split was wrong on every agent-facing surface, and the correction reaches the shipped tool descriptions.** `CLAUDE.md`, `skills/apple-numbers/SKILL.md`, `docs/LIMITATIONS.md`, `docs/AUTOMATION-PERMISSION.md` and the README's Requirements bullet all described the divide as *reads use numbers-parser, writes drive Numbers.app via AppleScript*. The real divide is **values vs. formatting**: eleven write tools — `create-spreadsheet`, `set-cell`, `set-cells-batch`, `add-rows`, `update-rows`, `delete-rows`, `add-sheet`, `add-table`, `rename-sheet`, `rename-table`, `import-csv` — run entirely on the Python sidecar and never send an Apple event, so they need neither Numbers.app nor an Automation grant. Only eight reach AppleScript: `set-formula(s)`, `set-cell(s)-style`, `set-column-width`/`set-row-height`, `merge-cells`/`unmerge-cells`. The cost was concrete — an agent reading `CLAUDE.md` would gate or refuse a perfectly executable headless `set-cell` or `import-csv` on a missing Numbers.app, or send a user through the Automation-permission ritual for a call that never consults it, and would misread an unrelated sidecar error as a TCC failure. The repo also contradicted itself (README:156 and four tool descriptions already had it right), so a caller had no way to tell which statement to trust. All surfaces repartitioned, `doctor`'s `numbers_app` / `automation_permission` details rescoped, and the seven sidecar tool descriptions that named no backend now say "via the numbers-parser sidecar (does not require Numbers.app)" like the other four already did.
- **`docs/AUTOMATION-PERMISSION.md` prescribed `set-cell` as the "definitive test" of the Automation grant — a probe that cannot fail for lack of it.** `set-cell` goes to the sidecar, so it succeeds whether the permission is granted, denied, or never prompted for; a user following the page concluded the grant was in place and then hit *"Not authorized to send Apple events"* on their first `set-formula`, which is exactly the failure that page exists to prevent. The probe is now `set-cell-style` (or `set-formula`), with an explicit note that value writes prove nothing.
- **The eight AppleScript tools' `Safety:` lines said Numbers.app must "be running".** Backwards: `buildScript()` issues `open POSIX file`, which *launches* Numbers.app and opens the document — the app must be **installed**, not running. Corrected on all eight, and the seven that lacked it now carry the disclosure `set-formula` already had, plus two side effects no doc mentioned: the call **saves the whole document** (committing any unsaved hand edits the user has open in it) and **leaves it open**, which then races every later numbers-parser read of that file.
- **README documented `set-formulas-batch`'s array parameter as `entries`; the schema requires `formulas`.** A call written from the README fails Zod validation before the handler runs — the unknown `entries` key is stripped and the required `formulas` is missing. `entries` is correct for the adjacent `set-cells-style-batch`, which is where the copy-paste came from.
- **README's "Iterative Edits" example styled a header row with `bold: true`, a field `cellStyleSchema` does not have.** The unknown key is stripped to `{}`, `buildStyleCommands()` returns `[]`, `runAppleScript()` is skipped entirely — and the tool still reports "Styled 1 cells". The example now uses `fontName: "Helvetica-Bold"`, matching the parameter table at README:509, which already documented that there is no `bold`/`italic` flag.
- **`skills/apple-numbers/SKILL.md`'s `import-csv` example passed `path`.** The tool has no `path` parameter and requires both `inputPath` and `outputPath`; the neighbouring `search` example (which really does take `path`) is what seeded it. Fixed in the canonical `skills/` copy and re-synced to `codex/skills` and `.antigravity-plugin/skills`.
- **`CLAUDE.md` still said `doctor` reports three checks.** `python_interpreter` made it four in 1.1.6 — and it is the check that surfaces the single most common setup failure, a stock macOS Python 3.9. README and `docs/AUTOMATION-PERMISSION.md` were updated then; `CLAUDE.md` and its "Tools at a glance" row were missed.
- **`docs/LIMITATIONS.md` and `CLAUDE.md` advertised Linux support that `package.json` makes impossible.** LIMITATIONS.md gave Linux read-only deployment a dedicated section heading and named it as a supported fallback, but `"os": ["darwin"]` has been in `package.json` since the initial commit, so `npm install` hard-fails there with `EBADPLATFORM`. The read path genuinely is platform-independent (there is no `process.platform` branch anywhere in `src/`) — the package is not, and the pin is correct, since the formula/format tools cannot work off macOS. Reworded to match README:156 rather than dropping the pin.
- **`.github/PULL_REQUEST_TEMPLATE.md`'s CONTRIBUTING link 404'd.** GitHub resolves a PR template's relative links against `.github/`, and `.github/CONTRIBUTING.md` has never existed — the file is at the repo root. Contributors lost the "rebuild and commit `build/index.js`" instruction, which `ci.yml`'s *Verify committed build/ matches source* step then fails them on. Now an absolute URL, per the house standard for cross-file links.
- **The Antigravity marketplace still advertised a Hermes plugin.** `.hermes-plugin/` was removed in #42 precisely to stop that misreading, and the README, CHANGELOG and both sync scripts already say there is no Hermes drop-in. The Codex manifest's `longDescription` likewise still called the sidecar "cross-platform" and attributed all writes to AppleScript.

### Added

- **Documented `export-table`'s destructive write.** It was the only file-writing tool with no `Safety:` line in its description and no ⚠️ note in the README, despite writing `outputPath` unconditionally — `outputPath: "~/.zshrc"` truncates that file — while both sibling file-creating tools carry one.
- **Documented `import-csv`'s type coercion and column-set rules.** CSV/TSV fields are auto-typed, so `01234` imports as the number `1234` and `1e5` as the number `100000` — the *opposite* of the conservative coercion the write tools were given in 1.1.4, and irreversible once written. JSON values pass through untouched, but an array of objects takes its column set from the **first** object only, silently dropping keys that appear later, and an array of arrays gets synthetic `Column_N` headers with the first row kept as data. `format: "auto"` also falls back to CSV for any unrecognized extension. None of this was stated in the README, the skill, the docs or the tool description.
- **Documented `add-sheet`/`add-table` geometry.** Omit `headers` and you get a **12 × 8** grid of empty cells; pass them and you get 1 × `headers.length`. The `numRows`/`numCols` overrides exist all the way down the stack but are not exposed through MCP, so the extra rows can only be removed afterwards with `delete-rows`.
- **Clarified that `read-table` returns the dimensions of the *selection*.** Its `numRows`/`numCols` count what came back, not the table — under the exact field names `get-file-info` uses for the table's real size. The description called them "dimensions"; it now names the fields and points at `get-file-info`.
- **Documented the fixed per-call timeouts** — 30 s for sidecar calls, 60 s for AppleScript — and that neither is configurable. `APPLE_NUMBERS_MCP_SETUP_TIMEOUT` sits one row below in the same README table and governs only the venv bootstrap, which sent anyone hitting `Operation timed out after 30000ms` looking for a knob that does not exist.
- **`findSystemPython()`'s "Python 3 not found on PATH" error now names the `doctor` tool**, matching `setupHint()` eight lines away in the same file and the house standard for setup-failure messages.
- **Plugin/marketplace manifest descriptions now mention formulas and formatting** — roughly a third of the tool surface, and one of the two capabilities `package.json`'s description leads with. The strings were written before the AppleScript formatting tools landed and were never revisited.

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
