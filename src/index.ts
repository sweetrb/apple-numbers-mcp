#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NumbersManager } from "./services/numbersManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const version: string = pkg.version;

const manager = new NumbersManager();

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function withErrorHandling<T>(
  handler: (params: T) => ReturnType<typeof textResponse>,
  prefix: string
) {
  return (params: T) => {
    try {
      return handler(params);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return errorResponse(`${prefix}: ${msg}`);
    }
  };
}

// --- Tool Definitions ---

const server = new McpServer({
  name: "apple-numbers",
  version,
  description:
    "MCP server for reading Apple Numbers (.numbers) spreadsheet files. " +
    "Provides tools to inspect file structure, read table data, search cells, " +
    "export to CSV/JSON/TSV, and read individual cell values.",
});

// health-check
server.tool(
  "health-check",
  "Check that Python 3 and numbers-parser are installed and available",
  {},
  withErrorHandling(() => {
    const result = manager.healthCheck();
    return textResponse(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
  }, "health-check")
);

// get-file-info
server.tool(
  "get-file-info",
  "Get the structure of a .numbers file: sheets, tables, dimensions, and header rows",
  {
    path: z.string().describe("Absolute or ~-relative path to the .numbers file"),
  },
  withErrorHandling(({ path }) => {
    const info = manager.getFileInfo(path);
    const summary = info.sheets
      .map((s) => {
        const tables = s.tables
          .map(
            (t) => `    ${t.name} (${t.numRows}×${t.numCols}) headers: [${t.headerRow.join(", ")}]`
          )
          .join("\n");
        return `  Sheet: "${s.name}"\n${tables}`;
      })
      .join("\n");
    return textResponse(`File: ${info.path}\nDefault sheet: "${info.defaultSheet}"\n\n${summary}`);
  }, "get-file-info")
);

// read-table
server.tool(
  "read-table",
  "Read all data from a table in a .numbers file. Returns headers and all rows. " +
    "Defaults to first sheet and first table if not specified.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
  },
  withErrorHandling(({ path, sheet, table }) => {
    const data = manager.readTable(path, sheet, table);
    const headerLine = data.headers.join(" | ");
    const separator = data.headers.map(() => "---").join(" | ");
    const dataRows = data.rows
      .map((row) => row.map((v) => (v === null ? "" : String(v))).join(" | "))
      .join("\n");
    return textResponse(
      `Sheet: "${data.sheetName}" | Table: "${data.tableName}" | ` +
        `${data.numRows} rows × ${data.numCols} cols\n\n` +
        `${headerLine}\n${separator}\n${dataRows}`
    );
  }, "read-table")
);

// search
server.tool(
  "search",
  "Search for a text value across all cells in a .numbers file. " +
    "Case-insensitive partial match.",
  {
    path: z.string().describe("Path to the .numbers file"),
    query: z.string().describe("Text to search for (case-insensitive)"),
    sheet: z.string().optional().describe("Limit search to this sheet"),
  },
  withErrorHandling(({ path, query, sheet }) => {
    const { results, count } = manager.search(path, query, sheet);
    if (count === 0) {
      return textResponse(`No results found for "${query}"`);
    }
    const lines = results.map(
      (r) => `[${r.sheetName}/${r.tableName}] Row ${r.row}, Col "${r.header}": ${r.value}`
    );
    return textResponse(`Found ${count} match(es) for "${query}":\n\n${lines.join("\n")}`);
  }, "search")
);

// export-table
server.tool(
  "export-table",
  "Export a table from a .numbers file to CSV, TSV, or JSON format.",
  {
    path: z.string().describe("Path to the .numbers file"),
    format: z.enum(["csv", "tsv", "json"]).describe("Output format"),
    outputPath: z.string().describe("Path for the output file"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
  },
  withErrorHandling(({ path, format, outputPath, sheet, table }) => {
    const result = manager.exportTable(path, format, outputPath, sheet, table);
    return textResponse(
      `Exported ${result.rowCount} rows from "${result.sheetName}/${result.tableName}" ` +
        `to ${result.format.toUpperCase()}: ${result.outputPath}`
    );
  }, "export-table")
);

// get-cell
server.tool(
  "get-cell",
  "Read a single cell value by row and column index (0-based).",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    row: z.number().int().min(0).describe("Row index (0-based)"),
    col: z.number().int().min(0).describe("Column index (0-based)"),
  },
  withErrorHandling(({ path, sheet, table, row, col }) => {
    const cell = manager.getCell(path, sheet, table, row, col);
    return textResponse(`Cell (${cell.row}, ${cell.col}): ${cell.value} [type: ${cell.type}]`);
  }, "get-cell")
);

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`apple-numbers-mcp v${version} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
