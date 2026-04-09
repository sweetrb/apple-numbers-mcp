# Changelog

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
