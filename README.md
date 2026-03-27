# apple-numbers-mcp

MCP server for reading Apple Numbers (.numbers) spreadsheet files.

## Features

- **get-file-info** — Inspect file structure: sheets, tables, dimensions, headers
- **read-table** — Read all data from a table (headers + rows)
- **search** — Case-insensitive text search across all cells
- **export-table** — Export a table to CSV, TSV, or JSON
- **get-cell** — Read a single cell by row/col index
- **health-check** — Verify Python and numbers-parser are available

## Prerequisites

- **Node.js** ≥ 20
- **Python 3** with `numbers-parser`:
  ```bash
  pip3 install numbers-parser
  ```

## Installation

```bash
cd apple-numbers-mcp
npm install
npm run build
```

## Configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-numbers": {
      "command": "node",
      "args": ["/path/to/apple-numbers-mcp/build/index.js"]
    }
  }
}
```

## Architecture

The server is a TypeScript MCP wrapper around a Python bridge script:

- **TypeScript** (MCP SDK + Zod) handles tool definitions, parameter validation, and stdio transport
- **Python** (`numbers-parser`) handles the actual .numbers file parsing via a bridge script (`src/utils/numbers_reader.py`)
- Communication is synchronous via `child_process.execFileSync`

This hybrid approach lets us use the best tool for each job: TypeScript for the MCP protocol layer and Python for the file format parsing (since `numbers-parser` is the only mature library for reading the proprietary .numbers protobuf format).

## License

MIT
