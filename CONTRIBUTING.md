# Contributing to Apple Numbers MCP Server

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/sweetrb/apple-numbers-mcp.git
   cd apple-numbers-mcp
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

   This repo pins pnpm via `packageManager` in `package.json` — `corepack enable` provides it. Development needs Node >= 22.13 (CI tests on Node 22 and 24); the published server itself runs on Node >= 20.

3. **Set up the Python sidecar** (creates a project-local venv with `numbers-parser`)
   ```bash
   pnpm run setup       # requires Python 3.11+ (macOS ships 3.9 — install a newer one)
   ```

4. **Build the project**
   ```bash
   pnpm run build
   ```

5. **Run tests**
   ```bash
   pnpm test                 # unit tests (fast, no Numbers.app / venv needed)
   pnpm run test:integration # round-trips real .numbers files through the Python sidecar
   ```

## Code Style

This project uses ESLint and Prettier for code quality and formatting.

```bash
pnpm run lint        # check
pnpm run lint:fix    # auto-fix
pnpm run format      # format
pnpm run format:check
```

## Testing

All new features should include tests. We use Vitest.

### Testing Guidelines

- Unit tests mock the Python bridge (`execFileSync`) and the AppleScript runner, since both require macOS.
- The integration suite (`pnpm run test:integration`) generates `.numbers` fixtures and exercises the real `numbers-parser` sidecar.
- Test both success and failure paths, and edge cases (empty values, special characters, missing sheets/tables).
- Enforced coverage thresholds run in CI (`pnpm run test:coverage`); keep new code above the floor.

## Pull Request Process

1. Create a feature branch (`git checkout -b feature/your-feature-name`).
2. Make your changes — follow the existing style, add JSDoc, add tests.
3. Run all checks: `pnpm run lint && pnpm run typecheck && pnpm run format:check && pnpm test && pnpm run build`.
4. If you changed shipped code (`src/**` excluding tests, the runtime `dependencies` in `package.json`, or `requirements.txt`), bump the version at least a patch (`pnpm version patch --no-git-tag-version`) and add a CHANGELOG.md entry in the same PR — the `require-version-bump` CI check fails the PR otherwise (docs-only and test-only PRs are exempt). Rebuild and commit the bundled `build/index.js` (`pnpm run build`); CI verifies it matches the source.
5. Commit with clear messages referencing any related issues.
6. Push and open a PR describing what it does and linking related issues.

## Adding New Tools

When adding a new MCP tool:

1. **Add the schema + registration** in `src/index.ts` (with a structured `Use when: / Returns: / Do not use when:` description, plus `Safety:` for any write/destructive tool).
2. **Implement the method** in `src/services/numbersManager.ts`.
3. **Add the command** to the Python sidecar `src/utils/numbers_reader.py` (or the AppleScript path in `src/utils/applescript.ts` for formatting/formula tools).
4. **Add type definitions** in `src/types.ts`.
5. **Write tests** and **update** `README.md` + `CHANGELOG.md`. If the skill guidance changed, edit `skills/apple-numbers/SKILL.md` (the canonical copy) and run `pnpm run sync:skills` — the `codex/` and `.antigravity-plugin/` copies are generated from it and CI fails if they drift.

## Sidecar & AppleScript Guidelines

- Reads/writes go through the `numbers-parser` Python sidecar; formatting and formulas use AppleScript against Numbers.app.
- All writes that modify an existing file must save **atomically** (see `_atomic_save` in `numbers_reader.py`) so an interrupted save can't corrupt the user's file.
- Escape user input in AppleScript; surface sidecar failures as the JSON `{"error": ...}` envelope.

## Questions?

Open an issue for any questions about contributing.
