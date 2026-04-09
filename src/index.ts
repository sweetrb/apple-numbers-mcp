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
    "MCP server for reading and writing Apple Numbers (.numbers) spreadsheet files. " +
    "Provides tools to inspect file structure, read table data, search cells, " +
    "export to CSV/JSON/TSV, read individual cell values, create new spreadsheets, " +
    "update cells, and append rows.",
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
  "Read data from a table in a .numbers file. Returns headers and rows. " +
    "Supports optional row range and column filtering. " +
    "Defaults to first sheet and first table if not specified.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
    startRow: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Start row index, 0-based inclusive (default: 1, after header)"),
    endRow: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("End row index, 0-based inclusive (default: last row)"),
    columns: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe("Column filter: header names or 0-based indices"),
  },
  withErrorHandling(({ path, sheet, table, startRow, endRow, columns }) => {
    const data = manager.readTable(path, sheet, table, { startRow, endRow, columns });
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
  "Read a single cell value by row and column index (0-based). " +
    "Set verbose=true to include formula, formatted value, and merge info.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    row: z.number().int().min(0).describe("Row index (0-based)"),
    col: z.number().int().min(0).describe("Column index (0-based)"),
    verbose: z.boolean().optional().describe("Include formula/metadata (default: false)"),
  },
  withErrorHandling(({ path, sheet, table, row, col, verbose }) => {
    const cell = manager.getCell(path, sheet, table, row, col, verbose);
    let text = `Cell (${cell.row}, ${cell.col}): ${cell.value} [type: ${cell.type}]`;
    if (verbose) {
      if (cell.formula) text += `\nFormula: ${cell.formula}`;
      if (cell.formattedValue) text += `\nFormatted: ${cell.formattedValue}`;
      if (cell.isMerged) text += `\nMerged: yes`;
    }
    return textResponse(text);
  }, "get-cell")
);

// create-spreadsheet
server.tool(
  "create-spreadsheet",
  "Create a new .numbers file with a single sheet and table. " +
    "Provide headers and optionally initial data rows.",
  {
    path: z.string().describe("Path for the new .numbers file"),
    headers: z.array(z.string()).min(1).describe("Column header names"),
    rows: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .optional()
      .describe("Optional data rows (array of arrays)"),
    sheetName: z.string().optional().describe("Sheet name (default: 'Sheet 1')"),
    tableName: z.string().optional().describe("Table name (default: 'Table 1')"),
  },
  withErrorHandling(({ path, headers, rows, sheetName, tableName }) => {
    const result = manager.createSpreadsheet(path, headers, { sheetName, tableName, rows });
    return textResponse(
      `Created ${result.path}\n` +
        `Sheet: "${result.sheetName}" | Table: "${result.tableName}"\n` +
        `${result.numHeaders} columns, ${result.numRows} data rows`
    );
  }, "create-spreadsheet")
);

// set-cell
server.tool(
  "set-cell",
  "Write a value to a single cell in an existing .numbers file. " +
    "Row and column are 0-based indices.",
  {
    path: z.string().describe("Path to the .numbers file"),
    row: z.number().int().min(0).describe("Row index (0-based)"),
    col: z.number().int().min(0).describe("Column index (0-based)"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe("Value to write"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
    type: z
      .enum(["string", "number", "boolean", "date"])
      .optional()
      .describe("Force value type (default: auto-detect)"),
  },
  withErrorHandling(({ path, row, col, value, sheet, table, type }) => {
    const result = manager.setCell(path, row, col, value, { sheet, table, type });
    return textResponse(
      `Set cell (${result.row}, ${result.col}) = ${result.value} ` +
        `in "${result.sheetName}/${result.tableName}"`
    );
  }, "set-cell")
);

// set-cells-batch
server.tool(
  "set-cells-batch",
  "Write values to multiple cells in a single operation. " +
    "More efficient than multiple set-cell calls for bulk updates.",
  {
    path: z.string().describe("Path to the .numbers file"),
    updates: z
      .array(
        z.object({
          row: z.number().int().min(0).describe("Row index (0-based)"),
          col: z.number().int().min(0).describe("Column index (0-based)"),
          value: z
            .union([z.string(), z.number(), z.boolean(), z.null()])
            .describe("Value to write"),
          type: z
            .enum(["string", "number", "boolean", "date"])
            .optional()
            .describe("Force value type"),
        })
      )
      .min(1)
      .describe("Array of cell updates"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
  },
  withErrorHandling(({ path, updates, sheet, table }) => {
    const result = manager.setCellsBatch(path, updates, { sheet, table });
    return textResponse(
      `Updated ${result.cellsWritten} cells in "${result.sheetName}/${result.tableName}"`
    );
  }, "set-cells-batch")
);

// add-rows
server.tool(
  "add-rows",
  "Append rows of data to an existing table in a .numbers file. " +
    "New rows are added after the last existing row.",
  {
    path: z.string().describe("Path to the .numbers file"),
    rows: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .min(1)
      .describe("Rows to append (array of arrays, one per row)"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
  },
  withErrorHandling(({ path, rows, sheet, table }) => {
    const result = manager.addRows(path, rows, { sheet, table });
    return textResponse(
      `Added ${result.rowsAdded} rows to "${result.sheetName}/${result.tableName}" ` +
        `(starting at row ${result.startRow}, new total: ${result.newTotalRows})`
    );
  }, "add-rows")
);

// delete-rows
server.tool(
  "delete-rows",
  "Delete a range of rows from a table in a .numbers file. " +
    "Both start and end are 0-based inclusive indices.",
  {
    path: z.string().describe("Path to the .numbers file"),
    startRow: z.number().int().min(0).describe("First row to delete (0-based, inclusive)"),
    endRow: z.number().int().min(0).describe("Last row to delete (0-based, inclusive)"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
  },
  withErrorHandling(({ path, startRow, endRow, sheet, table }) => {
    const result = manager.deleteRows(path, startRow, endRow, { sheet, table });
    return textResponse(
      `Deleted ${result.rowsDeleted} rows from "${result.sheetName}/${result.tableName}" ` +
        `(new total: ${result.newTotalRows})`
    );
  }, "delete-rows")
);

// add-sheet
server.tool(
  "add-sheet",
  "Add a new sheet to an existing .numbers file. " +
    "Optionally provide headers for the default table.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheetName: z.string().describe("Name for the new sheet"),
    tableName: z.string().optional().describe("Name for the default table"),
    headers: z.array(z.string()).optional().describe("Column headers for the default table"),
  },
  withErrorHandling(({ path, sheetName, tableName, headers }) => {
    const result = manager.addSheet(path, sheetName, { tableName, headers });
    return textResponse(
      `Added sheet "${result.sheetName}" with table "${result.tableName}" ` +
        `(${result.numRows}×${result.numCols})`
    );
  }, "add-sheet")
);

// add-table
server.tool(
  "add-table",
  "Add a new table to an existing sheet in a .numbers file.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    tableName: z.string().optional().describe("Name for the new table"),
    headers: z.array(z.string()).optional().describe("Column headers for the new table"),
  },
  withErrorHandling(({ path, sheet, tableName, headers }) => {
    const result = manager.addTable(path, { sheet, tableName, headers });
    return textResponse(
      `Added table "${result.tableName}" to sheet "${result.sheetName}" ` +
        `(${result.numRows}×${result.numCols})`
    );
  }, "add-table")
);

// import-csv
server.tool(
  "import-csv",
  "Import a CSV, TSV, or JSON file into a new .numbers spreadsheet. " +
    "Auto-detects format from file extension, or specify explicitly.",
  {
    inputPath: z.string().describe("Path to the CSV/TSV/JSON input file"),
    outputPath: z.string().describe("Path for the output .numbers file"),
    format: z
      .enum(["auto", "csv", "tsv", "json"])
      .optional()
      .describe("Input format (default: auto-detect from extension)"),
    sheetName: z.string().optional().describe("Sheet name (default: 'Sheet 1')"),
    tableName: z.string().optional().describe("Table name (default: 'Table 1')"),
  },
  withErrorHandling(({ inputPath, outputPath, format, sheetName, tableName }) => {
    const result = manager.importFile(inputPath, outputPath, { format, sheetName, tableName });
    return textResponse(
      `Imported ${result.numRows} rows (${result.numHeaders} columns) from ${result.format.toUpperCase()}\n` +
        `Input: ${result.inputPath}\nOutput: ${result.path}\n` +
        `Sheet: "${result.sheetName}" | Table: "${result.tableName}"`
    );
  }, "import-csv")
);

// update-rows
server.tool(
  "update-rows",
  "Write full rows by index in an existing .numbers file. " +
    "Each update specifies a row index and a complete array of column values.",
  {
    path: z.string().describe("Path to the .numbers file"),
    updates: z
      .array(
        z.object({
          row: z.number().int().min(0).describe("Row index (0-based)"),
          values: z
            .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .describe("Column values for the entire row"),
        })
      )
      .min(1)
      .describe("Array of row updates"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Table name (default: first table)"),
  },
  withErrorHandling(({ path, updates, sheet, table }) => {
    const result = manager.updateRows(path, updates, { sheet, table });
    return textResponse(
      `Updated ${result.rowsUpdated} rows in "${result.sheetName}/${result.tableName}"`
    );
  }, "update-rows")
);

// rename-sheet
server.tool(
  "rename-sheet",
  "Rename a sheet in a .numbers file.",
  {
    path: z.string().describe("Path to the .numbers file"),
    newName: z.string().describe("New name for the sheet"),
    sheet: z.string().optional().describe("Current sheet name (default: first sheet)"),
  },
  withErrorHandling(({ path, newName, sheet }) => {
    const result = manager.renameSheet(path, newName, sheet);
    return textResponse(`Renamed sheet "${result.oldName}" → "${result.newName}"`);
  }, "rename-sheet")
);

// rename-table
server.tool(
  "rename-table",
  "Rename a table in a .numbers file.",
  {
    path: z.string().describe("Path to the .numbers file"),
    newName: z.string().describe("New name for the table"),
    sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
    table: z.string().optional().describe("Current table name (default: first table)"),
  },
  withErrorHandling(({ path, newName, sheet, table }) => {
    const result = manager.renameTable(path, newName, { sheet, table });
    return textResponse(
      `Renamed table "${result.oldName}" → "${result.newName}" in sheet "${result.sheetName}"`
    );
  }, "rename-table")
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
