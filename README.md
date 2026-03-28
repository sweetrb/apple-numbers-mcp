# apple-numbers-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for reading Apple Numbers (`.numbers`) spreadsheet files. Gives AI assistants like Claude the ability to inspect, query, search, and export data from Numbers spreadsheets.

## Features

- **get-file-info** — Inspect file structure: sheets, tables, dimensions, and header rows
- **read-table** — Read all data from a table (headers + rows), formatted as markdown
- **search** — Case-insensitive text search across all cells in a file
- **export-table** — Export a table to CSV, TSV, or JSON
- **get-cell** — Read a single cell by row/column index
- **health-check** — Verify that Python and `numbers-parser` are installed and available

## Prerequisites

- **macOS** — Apple Numbers is a macOS/iOS format; this server is designed for use on macOS
- **Node.js** ≥ 20
- **Python 3** — ships with macOS, or install via `brew install python`

## Quick Start

```bash
git clone https://github.com/sweetrb/apple-numbers-mcp.git
cd apple-numbers-mcp
npm install
npm run setup    # creates a Python venv and installs numbers-parser
npm run build
```

The `setup` script creates a self-contained Python virtual environment at `./venv/` and installs the [`numbers-parser`](https://pypi.org/project/numbers-parser/) library into it. This avoids conflicts with Homebrew's externally-managed Python ([PEP 668](https://peps.python.org/pep-0668/)) and keeps the project fully isolated.

If you prefer to manage Python dependencies yourself, you can skip `npm run setup` and install `numbers-parser` into any Python 3 environment on your PATH:

```bash
pip3 install numbers-parser
```

## Configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-numbers": {
      "command": "node",
      "args": ["/absolute/path/to/apple-numbers-mcp/build/index.js"]
    }
  }
}
```

Then restart your MCP client. You can verify the server is working by invoking the `health-check` tool.

## Development

```bash
npm run dev          # watch mode (recompile on change)
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking
npm test             # run unit tests (vitest)
npm run test:watch   # watch mode tests
```

### Integration tests

Integration tests exercise the full pipeline against real `.numbers` fixture files. Generate the fixtures first, then run the test suite:

```bash
npm run setup                                    # if not already done
./venv/bin/python3 test/fixtures/generate-fixtures.py
npm test
```

Unit tests (mocked) run everywhere; integration tests auto-skip when fixtures or `numbers-parser` are not available.

## Architecture

The server is a TypeScript MCP wrapper around a Python bridge script:

- **TypeScript** (MCP SDK + Zod) handles tool definitions, parameter validation, and stdio transport
- **Python** (`numbers-parser`) handles the actual `.numbers` file parsing via a bridge script (`src/utils/numbers_reader.py`)
- Communication is synchronous via `child_process.execFileSync`

Python resolution order: the server first looks for `./venv/bin/python3` (project-local venv), then falls back to `python3` or `python` on PATH.

This hybrid approach uses the best tool for each layer: TypeScript for the MCP protocol and Python for file format parsing, since `numbers-parser` is the only mature library for reading the proprietary `.numbers` protobuf/IWA format.

## License

[MIT](LICENSE)
