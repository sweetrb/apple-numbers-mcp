#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NumbersManager } from "./services/numbersManager.js";
import { successResponse, withErrorHandling } from "./tools/respond.js";
import { runDoctor, formatDoctorReport } from "./tools/doctor.js";
import { registerResourcesAndPrompts } from "./tools/resourcesAndPrompts.js";
import { loadFileConfig } from "./services/fileConfig.js";

// Load file-based config FIRST — before anything reads APPLE_NUMBERS_MCP_* env
// vars — so settings survive a host that strips the MCP env block.
loadFileConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const version: string = pkg.version;

const manager = new NumbersManager();

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
    return successResponse(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`, {
      ...result,
    });
  }, "health-check")
);

// doctor
server.tool(
  "doctor",
  "Run a full setup diagnostic: numbers-parser (read sidecar), Numbers.app (needed " +
    "for writes), and Automation permission — each reported as ok/warn/fail with " +
    "actionable advice. Use this when a tool returns a permission or setup error.",
  {},
  withErrorHandling(() => {
    const report = runDoctor(manager);
    return successResponse(formatDoctorReport(report), { ...report });
  }, "doctor")
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
    return successResponse(
      `File: ${info.path}\nDefault sheet: "${info.defaultSheet}"\n\n${summary}`,
      { ...info }
    );
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
    return successResponse(
      `Sheet: "${data.sheetName}" | Table: "${data.tableName}" | ` +
        `${data.numRows} rows × ${data.numCols} cols\n\n` +
        `${headerLine}\n${separator}\n${dataRows}`,
      { ...data }
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
      return successResponse(`No results found for "${query}"`, { results, count });
    }
    const lines = results.map(
      (r) => `[${r.sheetName}/${r.tableName}] Row ${r.row}, Col "${r.header}": ${r.value}`
    );
    return successResponse(`Found ${count} match(es) for "${query}":\n\n${lines.join("\n")}`, {
      results,
      count,
    });
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
    return successResponse(
      `Exported ${result.rowCount} rows from "${result.sheetName}/${result.tableName}" ` +
        `to ${result.format.toUpperCase()}: ${result.outputPath}`,
      { ...result }
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
    return successResponse(text, { ...cell });
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
    return successResponse(
      `Created ${result.path}\n` +
        `Sheet: "${result.sheetName}" | Table: "${result.tableName}"\n` +
        `${result.numHeaders} columns, ${result.numRows} data rows`,
      { ...result }
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
    return successResponse(
      `Set cell (${result.row}, ${result.col}) = ${result.value} ` +
        `in "${result.sheetName}/${result.tableName}"`,
      { ...result }
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
    return successResponse(
      `Updated ${result.cellsWritten} cells in "${result.sheetName}/${result.tableName}"`,
      { ...result }
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
    return successResponse(
      `Added ${result.rowsAdded} rows to "${result.sheetName}/${result.tableName}" ` +
        `(starting at row ${result.startRow}, new total: ${result.newTotalRows})`,
      { ...result }
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
    return successResponse(
      `Deleted ${result.rowsDeleted} rows from "${result.sheetName}/${result.tableName}" ` +
        `(new total: ${result.newTotalRows})`,
      { ...result }
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
    return successResponse(
      `Added sheet "${result.sheetName}" with table "${result.tableName}" ` +
        `(${result.numRows}×${result.numCols})`,
      { ...result }
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
    return successResponse(
      `Added table "${result.tableName}" to sheet "${result.sheetName}" ` +
        `(${result.numRows}×${result.numCols})`,
      { ...result }
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
    return successResponse(
      `Imported ${result.numRows} rows (${result.numHeaders} columns) from ${result.format.toUpperCase()}\n` +
        `Input: ${result.inputPath}\nOutput: ${result.path}\n` +
        `Sheet: "${result.sheetName}" | Table: "${result.tableName}"`,
      { ...result }
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
    return successResponse(
      `Updated ${result.rowsUpdated} rows in "${result.sheetName}/${result.tableName}"`,
      { ...result }
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
    return successResponse(`Renamed sheet "${result.oldName}" → "${result.newName}"`, {
      ...result,
    });
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
    return successResponse(
      `Renamed table "${result.oldName}" → "${result.newName}" in sheet "${result.sheetName}"`,
      { ...result }
    );
  }, "rename-table")
);

// set-formula
server.tool(
  "set-formula",
  "Set a formula on a cell in a .numbers file using AppleScript. " +
    "Requires Numbers.app to be running. The file will be opened if not already open, " +
    "and saved after the formula is set. Row and column are 0-based indices.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    row: z.number().int().min(0).describe("Row index (0-based)"),
    col: z.number().int().min(0).describe("Column index (0-based)"),
    formula: z.string().describe('Formula string (e.g., "=SUM(A2:A10)")'),
  },
  withErrorHandling(({ path, sheet, table, row, col, formula }) => {
    const result = manager.setCellFormula(path, sheet, table, row, col, formula);
    return successResponse(
      `Set formula on ${result.cell} in "${result.sheetName}/${result.tableName}"\n` +
        `Formula: ${result.formula}\nComputed value: ${result.computedValue}`,
      { ...result }
    );
  }, "set-formula")
);

// set-formulas-batch
server.tool(
  "set-formulas-batch",
  "Set formulas on multiple cells in a single operation using AppleScript. " +
    "Requires Numbers.app to be running. More efficient than multiple set-formula calls.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    formulas: z
      .array(
        z.object({
          row: z.number().int().min(0).describe("Row index (0-based)"),
          col: z.number().int().min(0).describe("Column index (0-based)"),
          formula: z.string().describe("Formula string"),
        })
      )
      .min(1)
      .describe("Array of formula assignments"),
  },
  withErrorHandling(({ path, sheet, table, formulas }) => {
    const result = manager.setCellFormulasBatch(path, sheet, table, formulas);
    return successResponse(
      `Set ${result.cellsSet} formulas in "${result.sheetName}/${result.tableName}"`,
      { ...result }
    );
  }, "set-formulas-batch")
);

// --- Formatting tools (AppleScript, requires Numbers.app) ---

const colorSchema = z.object({
  red: z.number().int().min(0).max(65535).describe("Red component (0-65535)"),
  green: z.number().int().min(0).max(65535).describe("Green component (0-65535)"),
  blue: z.number().int().min(0).max(65535).describe("Blue component (0-65535)"),
});

const cellStyleSchema = z.object({
  fontName: z.string().optional().describe('Font name (e.g., "Helvetica-Bold", "HelveticaNeue")'),
  fontSize: z.number().optional().describe("Font size in points"),
  textColor: colorSchema.optional().describe("Text color (RGB, 0-65535 per channel)"),
  backgroundColor: colorSchema.optional().describe("Background color (RGB, 0-65535 per channel)"),
  format: z
    .enum([
      "automatic",
      "number",
      "currency",
      "date and time",
      "duration",
      "fraction",
      "scientific",
      "numeral system",
      "checkbox",
      "star rating",
      "text",
    ])
    .optional()
    .describe("Cell number format"),
  alignment: z
    .enum(["auto align", "left", "center", "right", "justify"])
    .optional()
    .describe("Horizontal alignment"),
  verticalAlignment: z.enum(["top", "center", "bottom"]).optional().describe("Vertical alignment"),
  textWrap: z.boolean().optional().describe("Enable text wrapping"),
});

// set-cell-style
server.tool(
  "set-cell-style",
  "Set formatting on a cell: font, color, alignment, number format, etc. " +
    "Requires Numbers.app to be running.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    row: z.number().int().min(0).describe("Row index (0-based)"),
    col: z.number().int().min(0).describe("Column index (0-based)"),
    style: cellStyleSchema.describe("Style properties to set"),
  },
  withErrorHandling(({ path, sheet, table, row, col, style }) => {
    const result = manager.setCellStyle(path, sheet, table, row, col, style);
    return successResponse(
      `Styled cell ${result.cell} in "${result.sheetName}/${result.tableName}"`,
      { ...result }
    );
  }, "set-cell-style")
);

// set-cells-style-batch
server.tool(
  "set-cells-style-batch",
  "Set formatting on multiple cells in one operation. " + "Requires Numbers.app to be running.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    entries: z
      .array(
        z.object({
          row: z.number().int().min(0).describe("Row index (0-based)"),
          col: z.number().int().min(0).describe("Column index (0-based)"),
          style: cellStyleSchema,
        })
      )
      .min(1)
      .describe("Array of cell style assignments"),
  },
  withErrorHandling(({ path, sheet, table, entries }) => {
    const result = manager.setCellsStyleBatch(path, sheet, table, entries);
    return successResponse(
      `Styled ${result.cellsStyled} cells in "${result.sheetName}/${result.tableName}"`,
      { ...result }
    );
  }, "set-cells-style-batch")
);

// set-column-width
server.tool(
  "set-column-width",
  "Set the width of a column in pixels. Requires Numbers.app to be running.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    col: z.number().int().min(0).describe("Column index (0-based)"),
    width: z.number().min(0).describe("Width in pixels"),
  },
  withErrorHandling(({ path, sheet, table, col, width }) => {
    manager.setColumnWidth(path, sheet, table, col, width);
    return successResponse(`Set column ${col} width to ${width}px in "${sheet}/${table}"`, {
      path,
      sheet,
      table,
      col,
      width,
    });
  }, "set-column-width")
);

// set-row-height
server.tool(
  "set-row-height",
  "Set the height of a row in pixels. Requires Numbers.app to be running.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    row: z.number().int().min(0).describe("Row index (0-based)"),
    height: z.number().min(0).describe("Height in pixels"),
  },
  withErrorHandling(({ path, sheet, table, row, height }) => {
    manager.setRowHeight(path, sheet, table, row, height);
    return successResponse(`Set row ${row} height to ${height}px in "${sheet}/${table}"`, {
      path,
      sheet,
      table,
      row,
      height,
    });
  }, "set-row-height")
);

// merge-cells
server.tool(
  "merge-cells",
  "Merge a range of cells. Requires Numbers.app to be running.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    startRow: z.number().int().min(0).describe("Top-left row (0-based)"),
    startCol: z.number().int().min(0).describe("Top-left column (0-based)"),
    endRow: z.number().int().min(0).describe("Bottom-right row (0-based)"),
    endCol: z.number().int().min(0).describe("Bottom-right column (0-based)"),
  },
  withErrorHandling(({ path, sheet, table, startRow, startCol, endRow, endCol }) => {
    const result = manager.mergeCells(path, sheet, table, startRow, startCol, endRow, endCol);
    return successResponse(`Merged ${result.range} in "${result.sheetName}/${result.tableName}"`, {
      ...result,
    });
  }, "merge-cells")
);

// unmerge-cells
server.tool(
  "unmerge-cells",
  "Unmerge a previously merged range of cells. Requires Numbers.app to be running.",
  {
    path: z.string().describe("Path to the .numbers file"),
    sheet: z.string().describe("Sheet name"),
    table: z.string().describe("Table name"),
    startRow: z.number().int().min(0).describe("Top-left row (0-based)"),
    startCol: z.number().int().min(0).describe("Top-left column (0-based)"),
    endRow: z.number().int().min(0).describe("Bottom-right row (0-based)"),
    endCol: z.number().int().min(0).describe("Bottom-right column (0-based)"),
  },
  withErrorHandling(({ path, sheet, table, startRow, startCol, endRow, endCol }) => {
    const result = manager.unmergeCells(path, sheet, table, startRow, startCol, endRow, endCol);
    return successResponse(
      `Unmerged ${result.range} in "${result.sheetName}/${result.tableName}"`,
      { ...result }
    );
  }, "unmerge-cells")
);

// Register read-only resources (numbers://file/{path}, numbers://table/{path})
// and workflow prompts.
registerResourcesAndPrompts(server, manager);

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
