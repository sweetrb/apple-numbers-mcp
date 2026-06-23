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
   npm install
   ```

3. **Set up the Python sidecar** (creates a project-local venv with `numbers-parser`)
   ```bash
   npm run setup        # requires Python 3.11+ (macOS ships 3.9 — install a newer one)
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Run tests**
   ```bash
   npm test                 # unit tests (fast, no Numbers.app / venv needed)
   npm run test:integration # round-trips real .numbers files through the Python sidecar
   ```

## Code Style

This project uses ESLint and Prettier for code quality and formatting.

```bash
npm run lint        # check
npm run lint:fix    # auto-fix
npm run format      # format
npm run format:check
```

## Testing

All new features should include tests. We use Vitest.

### Testing Guidelines

- Unit tests mock the Python bridge (`execFileSync`) and the AppleScript runner, since both require macOS.
- The integration suite (`npm run test:integration`) generates `.numbers` fixtures and exercises the real `numbers-parser` sidecar.
- Test both success and failure paths, and edge cases (empty values, special characters, missing sheets/tables).
- Enforced coverage thresholds run in CI (`npm run test:coverage`); keep new code above the floor.

## Pull Request Process

1. Create a feature branch (`git checkout -b feature/your-feature-name`).
2. Make your changes — follow the existing style, add JSDoc, add tests.
3. Run all checks: `npm run lint && npm run typecheck && npm test && npm run build`.
4. Commit with clear messages referencing any related issues.
5. Push and open a PR describing what it does and linking related issues.

## Adding New Tools

When adding a new MCP tool:

1. **Add the schema + registration** in `src/index.ts` (with a structured `Use when: / Returns: / Do not use when:` description, plus `Safety:` for any write/destructive tool).
2. **Implement the method** in `src/services/numbersManager.ts`.
3. **Add the command** to the Python sidecar `src/utils/numbers_reader.py` (or the AppleScript path in `src/utils/applescript.ts` for formatting/formula tools).
4. **Add type definitions** in `src/types.ts`.
5. **Write tests** and **update** `README.md` + `CHANGELOG.md`.

## Sidecar & AppleScript Guidelines

- Reads/writes go through the `numbers-parser` Python sidecar; formatting and formulas use AppleScript against Numbers.app.
- All writes that modify an existing file must save **atomically** (see `_atomic_save` in `numbers_reader.py`) so an interrupted save can't corrupt the user's file.
- Escape user input in AppleScript; surface sidecar failures as the JSON `{"error": ...}` envelope.

## Questions?

Open an issue for any questions about contributing.
