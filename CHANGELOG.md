# Changelog

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
