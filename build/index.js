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
const version = pkg.version;
const manager = new NumbersManager();
// --- Tool Definitions ---
const server = new McpServer({
    name: "apple-numbers",
    version,
    description: "MCP server for reading and writing Apple Numbers (.numbers) spreadsheet files. " +
        "Provides tools to inspect file structure, read table data, search cells, " +
        "export to CSV/JSON/TSV, read individual cell values, create new spreadsheets, " +
        "update cells, and append rows.",
});
// health-check
server.registerTool("health-check", {
    description: "Use when: you want a quick check that the Python 3 read sidecar (numbers-parser) is installed and reports its version.\n" +
        "Returns: ok/not-ok plus the numbers-parser version string.\n" +
        "Do not use when: you need a full setup diagnostic including Numbers.app and Automation permission — use doctor instead.",
    inputSchema: {},
    outputSchema: {
        ok: z.boolean().optional(),
        message: z.string().optional(),
    },
}, withErrorHandling(() => {
    const result = manager.healthCheck();
    return successResponse(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`, {
        ...result,
    });
}, "health-check"));
// doctor
server.registerTool("doctor", {
    description: "Use when: a tool returns a permission or setup error, or you want the full setup diagnostic before writing/formatting.\n" +
        "Returns: three checks — numbers-parser (read sidecar), Numbers.app (needed for writes), and Automation permission — each as ok/warn/fail with actionable advice.\n" +
        "Do not use when: you only need the lightweight read-sidecar version check — use health-check instead.",
    inputSchema: {},
    outputSchema: {
        healthy: z.boolean().optional(),
        checks: z
            .array(z
            .object({
            name: z.string().optional(),
            status: z.string().optional(),
            detail: z.string().optional(),
        })
            .passthrough())
            .optional(),
    },
}, withErrorHandling(() => {
    const report = runDoctor(manager);
    return successResponse(formatDoctorReport(report), { ...report });
}, "doctor"));
// get-file-info
server.registerTool("get-file-info", {
    description: "Use when: you need to discover the structure of a .numbers file before reading or writing — the exact sheet and table names, their dimensions, and header rows. Call this first when sheet/table names are unknown.\n" +
        "Returns: each sheet with its tables, per-table row×col counts, and the header row (row 0) cells.\n" +
        "Do not use when: you want the actual cell data — use read-table; or a single cell — use get-cell.",
    inputSchema: {
        path: z.string().describe("Absolute or ~-relative path to the .numbers file"),
    },
    outputSchema: {
        path: z.string().optional(),
        defaultSheet: z.string().optional(),
        sheets: z
            .array(z
            .object({
            name: z.string().optional(),
            tables: z
                .array(z
                .object({
                name: z.string().optional(),
                sheetName: z.string().optional(),
                numRows: z.number().optional(),
                numCols: z.number().optional(),
                headerRow: z.array(z.unknown()).optional(),
            })
                .passthrough())
                .optional(),
        })
            .passthrough())
            .optional(),
    },
}, withErrorHandling(({ path }) => {
    const info = manager.getFileInfo(path);
    const summary = info.sheets
        .map((s) => {
        const tables = s.tables
            .map((t) => `    ${t.name} (${t.numRows}×${t.numCols}) headers: [${t.headerRow.join(", ")}]`)
            .join("\n");
        return `  Sheet: "${s.name}"\n${tables}`;
    })
        .join("\n");
    return successResponse(`File: ${info.path}\nDefault sheet: "${info.defaultSheet}"\n\n${summary}`, { ...info });
}, "get-file-info"));
// read-table
server.registerTool("read-table", {
    description: "Use when: you want the data from a table — headers plus rows, optionally limited to a row range (0-based inclusive indices; header is row 0, so data starts at row 1) and/or a subset of columns. Defaults to the first sheet and first table if sheet/table are omitted.\n" +
        "Returns: sheet name, table name, dimensions, headers, and the selected rows.\n" +
        "Do not use when: you only need one cell — use get-cell; you need the file's structure/names — use get-file-info; or you want to find a value's location — use search.",
    inputSchema: {
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
    outputSchema: {
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        headers: z.array(z.unknown()).optional(),
        rows: z.array(z.array(z.unknown())).optional(),
        numRows: z.number().optional(),
        numCols: z.number().optional(),
    },
}, withErrorHandling(({ path, sheet, table, startRow, endRow, columns }) => {
    const data = manager.readTable(path, sheet, table, { startRow, endRow, columns });
    const headerLine = data.headers.join(" | ");
    const separator = data.headers.map(() => "---").join(" | ");
    const dataRows = data.rows
        .map((row) => row.map((v) => (v === null ? "" : String(v))).join(" | "))
        .join("\n");
    return successResponse(`Sheet: "${data.sheetName}" | Table: "${data.tableName}" | ` +
        `${data.numRows} rows × ${data.numCols} cols\n\n` +
        `${headerLine}\n${separator}\n${dataRows}`, { ...data });
}, "read-table"));
// search
server.registerTool("search", {
    description: "Use when: you need to locate where a text value appears across every cell in a .numbers file (case-insensitive partial match), optionally limited to one sheet.\n" +
        "Returns: a match count and each match's sheet, table, row, column header, and value.\n" +
        "Do not use when: you already know the cell's coordinates — use get-cell; or you want a whole table's contents — use read-table.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        query: z.string().describe("Text to search for (case-insensitive)"),
        sheet: z.string().optional().describe("Limit search to this sheet"),
    },
    outputSchema: {
        count: z.number().optional(),
        results: z
            .array(z
            .object({
            sheetName: z.string().optional(),
            tableName: z.string().optional(),
            row: z.number().optional(),
            col: z.number().optional(),
            header: z.string().optional(),
            value: z.unknown().optional(),
        })
            .passthrough())
            .optional(),
    },
}, withErrorHandling(({ path, query, sheet }) => {
    const { results, count } = manager.search(path, query, sheet);
    if (count === 0) {
        return successResponse(`No results found for "${query}"`, { results, count });
    }
    const lines = results.map((r) => `[${r.sheetName}/${r.tableName}] Row ${r.row}, Col "${r.header}": ${r.value}`);
    return successResponse(`Found ${count} match(es) for "${query}":\n\n${lines.join("\n")}`, {
        results,
        count,
    });
}, "search"));
// export-table
server.registerTool("export-table", {
    description: "Use when: you want to write a table's data out to a CSV, TSV, or JSON file on disk. Defaults to the first sheet and first table if sheet/table are omitted.\n" +
        "Returns: the exported row count, format, and output path.\n" +
        "Do not use when: you want the data inline in the response rather than a file — use read-table; or you want to build a new .numbers file from a CSV/TSV/JSON source — use import-csv.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        format: z.enum(["csv", "tsv", "json"]).describe("Output format"),
        outputPath: z.string().describe("Path for the output file"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        table: z.string().optional().describe("Table name (default: first table)"),
    },
    outputSchema: {
        outputPath: z.string().optional(),
        format: z.string().optional(),
        rowCount: z.number().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
    },
}, withErrorHandling(({ path, format, outputPath, sheet, table }) => {
    const result = manager.exportTable(path, format, outputPath, sheet, table);
    return successResponse(`Exported ${result.rowCount} rows from "${result.sheetName}/${result.tableName}" ` +
        `to ${result.format.toUpperCase()}: ${result.outputPath}`, { ...result });
}, "export-table"));
// get-cell
server.registerTool("get-cell", {
    description: "Use when: you need a single cell's value by 0-based row and column index (header is row 0). Set verbose=true to also get the formula, formatted value, and merge info.\n" +
        "Returns: the cell's value and type, plus formula/formatted-value/merge details when verbose.\n" +
        "Do not use when: you want many cells or whole rows — use read-table; or you don't know the coordinates — use search.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        row: z.number().int().min(0).describe("Row index (0-based)"),
        col: z.number().int().min(0).describe("Column index (0-based)"),
        verbose: z.boolean().optional().describe("Include formula/metadata (default: false)"),
    },
    outputSchema: {
        row: z.number().optional(),
        col: z.number().optional(),
        value: z.unknown().optional(),
        type: z.string().optional(),
        formattedValue: z.string().optional(),
        formula: z.string().nullable().optional(),
        isFormula: z.boolean().optional(),
        isMerged: z.boolean().optional(),
    },
}, withErrorHandling(({ path, sheet, table, row, col, verbose }) => {
    const cell = manager.getCell(path, sheet, table, row, col, verbose);
    let text = `Cell (${cell.row}, ${cell.col}): ${cell.value} [type: ${cell.type}]`;
    if (verbose) {
        if (cell.formula)
            text += `\nFormula: ${cell.formula}`;
        if (cell.formattedValue)
            text += `\nFormatted: ${cell.formattedValue}`;
        if (cell.isMerged)
            text += `\nMerged: yes`;
    }
    return successResponse(text, { ...cell });
}, "get-cell"));
// create-spreadsheet
server.registerTool("create-spreadsheet", {
    description: "Use when: you want to create a brand-new .numbers file with a single sheet and table from a list of headers, optionally with initial data rows.\n" +
        "Returns: the file path, sheet name, table name, header count, and data-row count.\n" +
        "Do not use when: you want to build the file from an existing CSV/TSV/JSON source — use import-csv; or you want to add to a file that already exists — use add-sheet / add-table / add-rows.\n" +
        "Safety: writes a .numbers file via the numbers-parser sidecar (does not require Numbers.app). The target path is written unconditionally — if a file already exists at that path it is OVERWRITTEN in place; choose a fresh path or confirm overwrite first.",
    inputSchema: {
        path: z.string().describe("Path for the new .numbers file"),
        headers: z.array(z.string()).min(1).describe("Column header names"),
        rows: z
            .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
            .optional()
            .describe("Optional data rows (array of arrays)"),
        sheetName: z.string().optional().describe("Sheet name (default: 'Sheet 1')"),
        tableName: z.string().optional().describe("Table name (default: 'Table 1')"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        numHeaders: z.number().optional(),
        numRows: z.number().optional(),
    },
}, withErrorHandling(({ path, headers, rows, sheetName, tableName }) => {
    const result = manager.createSpreadsheet(path, headers, { sheetName, tableName, rows });
    return successResponse(`Created ${result.path}\n` +
        `Sheet: "${result.sheetName}" | Table: "${result.tableName}"\n` +
        `${result.numHeaders} columns, ${result.numRows} data rows`, { ...result });
}, "create-spreadsheet"));
// set-cell
server.registerTool("set-cell", {
    description: "Use when: you need to write a computed value to one cell in an existing .numbers file, addressed by 0-based row and column (header is row 0). Defaults to the first sheet/table if omitted.\n" +
        "Returns: the written coordinates, value, and the sheet/table affected.\n" +
        'Do not use when: you\'re writing many cells — use set-cells-batch; replacing whole rows — use update-rows; or writing a live formula — use set-formula (passing "=SUM(...)" here writes literal text, not a formula).\n' +
        "Safety: modifies the .numbers file in place and OVERWRITES any existing data in the target cell.",
    inputSchema: {
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
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        row: z.number().optional(),
        col: z.number().optional(),
        value: z.unknown().optional(),
    },
}, withErrorHandling(({ path, row, col, value, sheet, table, type }) => {
    const result = manager.setCell(path, row, col, value, { sheet, table, type });
    return successResponse(`Set cell (${result.row}, ${result.col}) = ${result.value} ` +
        `in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "set-cell"));
// set-cells-batch
server.registerTool("set-cells-batch", {
    description: "Use when: you need to write computed values to multiple cells at once (each with 0-based row/col); more efficient than many set-cell calls. Defaults to the first sheet/table if omitted.\n" +
        "Returns: the number of cells written and the sheet/table affected.\n" +
        "Do not use when: replacing whole rows by index — use update-rows; appending new rows — use add-rows; or writing live formulas — use set-formulas-batch.\n" +
        "Safety: modifies the .numbers file in place and OVERWRITES any existing data in the targeted cells.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        updates: z
            .array(z.object({
            row: z.number().int().min(0).describe("Row index (0-based)"),
            col: z.number().int().min(0).describe("Column index (0-based)"),
            value: z
                .union([z.string(), z.number(), z.boolean(), z.null()])
                .describe("Value to write"),
            type: z
                .enum(["string", "number", "boolean", "date"])
                .optional()
                .describe("Force value type"),
        }))
            .min(1)
            .describe("Array of cell updates"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        table: z.string().optional().describe("Table name (default: first table)"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        cellsWritten: z.number().optional(),
    },
}, withErrorHandling(({ path, updates, sheet, table }) => {
    const result = manager.setCellsBatch(path, updates, { sheet, table });
    return successResponse(`Updated ${result.cellsWritten} cells in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "set-cells-batch"));
// add-rows
server.registerTool("add-rows", {
    description: "Use when: you want to append new rows of data to the end of an existing table; rows are added after the last existing row. Defaults to the first sheet/table if omitted.\n" +
        "Returns: the number of rows added, the starting row index, and the new total row count.\n" +
        "Do not use when: overwriting existing rows by index — use update-rows; setting individual cells — use set-cell / set-cells-batch.\n" +
        "Safety: modifies the .numbers file in place. Additive (appends rows) and does not overwrite existing data, but still mutates the file.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        rows: z
            .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
            .min(1)
            .describe("Rows to append (array of arrays, one per row)"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        table: z.string().optional().describe("Table name (default: first table)"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        rowsAdded: z.number().optional(),
        startRow: z.number().optional(),
        newTotalRows: z.number().optional(),
    },
}, withErrorHandling(({ path, rows, sheet, table }) => {
    const result = manager.addRows(path, rows, { sheet, table });
    return successResponse(`Added ${result.rowsAdded} rows to "${result.sheetName}/${result.tableName}" ` +
        `(starting at row ${result.startRow}, new total: ${result.newTotalRows})`, { ...result });
}, "add-rows"));
// delete-rows
server.registerTool("delete-rows", {
    description: "Use when: you need to permanently remove a contiguous range of rows from a table; both startRow and endRow are 0-based inclusive indices (header is row 0). Defaults to the first sheet/table if omitted.\n" +
        "Returns: the number of rows deleted and the new total row count.\n" +
        "Do not use when: you only want to clear values while keeping the rows — use set-cells-batch with empty values; or overwrite rows in place — use update-rows.\n" +
        "Safety: DESTRUCTIVE — requires explicit user confirmation; not undoable; the .numbers file is modified in place and the deleted rows cannot be recovered. Double-check the 0-based inclusive range before calling.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        startRow: z.number().int().min(0).describe("First row to delete (0-based, inclusive)"),
        endRow: z.number().int().min(0).describe("Last row to delete (0-based, inclusive)"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        table: z.string().optional().describe("Table name (default: first table)"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        rowsDeleted: z.number().optional(),
        newTotalRows: z.number().optional(),
    },
}, withErrorHandling(({ path, startRow, endRow, sheet, table }) => {
    const result = manager.deleteRows(path, startRow, endRow, { sheet, table });
    return successResponse(`Deleted ${result.rowsDeleted} rows from "${result.sheetName}/${result.tableName}" ` +
        `(new total: ${result.newTotalRows})`, { ...result });
}, "delete-rows"));
// add-sheet
server.registerTool("add-sheet", {
    description: "Use when: you want to add a new sheet to an existing .numbers file, optionally naming its default table and providing its headers.\n" +
        "Returns: the new sheet name, its default table name, and the table's dimensions.\n" +
        "Do not use when: adding a table to an existing sheet — use add-table; or creating a whole new file — use create-spreadsheet.\n" +
        "Safety: modifies the .numbers file in place. Additive (adds a new sheet) and does not overwrite existing data, but still mutates the file.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheetName: z.string().describe("Name for the new sheet"),
        tableName: z.string().optional().describe("Name for the default table"),
        headers: z.array(z.string()).optional().describe("Column headers for the default table"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        numRows: z.number().optional(),
        numCols: z.number().optional(),
    },
}, withErrorHandling(({ path, sheetName, tableName, headers }) => {
    const result = manager.addSheet(path, sheetName, { tableName, headers });
    return successResponse(`Added sheet "${result.sheetName}" with table "${result.tableName}" ` +
        `(${result.numRows}×${result.numCols})`, { ...result });
}, "add-sheet"));
// add-table
server.registerTool("add-table", {
    description: "Use when: you want to add a new table to an existing sheet, optionally naming it and providing its headers. Defaults to the first sheet if omitted.\n" +
        "Returns: the new table name, the sheet it was added to, and the table's dimensions.\n" +
        "Do not use when: adding a whole new sheet — use add-sheet; or creating a new file — use create-spreadsheet.\n" +
        "Safety: modifies the .numbers file in place. Additive (adds a new table) and does not overwrite existing data, but still mutates the file.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        tableName: z.string().optional().describe("Name for the new table"),
        headers: z.array(z.string()).optional().describe("Column headers for the new table"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        numRows: z.number().optional(),
        numCols: z.number().optional(),
    },
}, withErrorHandling(({ path, sheet, tableName, headers }) => {
    const result = manager.addTable(path, { sheet, tableName, headers });
    return successResponse(`Added table "${result.tableName}" to sheet "${result.sheetName}" ` +
        `(${result.numRows}×${result.numCols})`, { ...result });
}, "add-table"));
// import-csv
server.registerTool("import-csv", {
    description: "Use when: you want to convert an existing CSV, TSV, or JSON file into a new .numbers spreadsheet. Format is auto-detected from the input file extension unless you specify it explicitly.\n" +
        "Returns: the imported row and column counts, detected format, and the input/output paths plus sheet/table names.\n" +
        "Do not use when: building a file from headers/rows you already have in hand — use create-spreadsheet; or exporting a .numbers table out to CSV/TSV/JSON — use export-table.\n" +
        "Safety: writes the output .numbers file via the numbers-parser sidecar (does not require Numbers.app). The output path is written unconditionally — if a file already exists there it is OVERWRITTEN in place; choose a fresh output path or confirm overwrite first.",
    inputSchema: {
        inputPath: z.string().describe("Path to the CSV/TSV/JSON input file"),
        outputPath: z.string().describe("Path for the output .numbers file"),
        format: z
            .enum(["auto", "csv", "tsv", "json"])
            .optional()
            .describe("Input format (default: auto-detect from extension)"),
        sheetName: z.string().optional().describe("Sheet name (default: 'Sheet 1')"),
        tableName: z.string().optional().describe("Table name (default: 'Table 1')"),
    },
    outputSchema: {
        path: z.string().optional(),
        inputPath: z.string().optional(),
        format: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        numHeaders: z.number().optional(),
        numRows: z.number().optional(),
    },
}, withErrorHandling(({ inputPath, outputPath, format, sheetName, tableName }) => {
    const result = manager.importFile(inputPath, outputPath, { format, sheetName, tableName });
    return successResponse(`Imported ${result.numRows} rows (${result.numHeaders} columns) from ${result.format.toUpperCase()}\n` +
        `Input: ${result.inputPath}\nOutput: ${result.path}\n` +
        `Sheet: "${result.sheetName}" | Table: "${result.tableName}"`, { ...result });
}, "import-csv"));
// update-rows
server.registerTool("update-rows", {
    description: "Use when: you need to replace whole rows by 0-based index in an existing file; each update carries a row index and a complete array of column values. Carrying multiple {row, values} entries is more efficient than per-row writes. Defaults to the first sheet/table if omitted.\n" +
        "Returns: the number of rows updated and the sheet/table affected.\n" +
        "Do not use when: appending new rows — use add-rows; writing individual cells — use set-cell / set-cells-batch; or writing live formulas — use set-formulas-batch.\n" +
        "Safety: modifies the .numbers file in place and OVERWRITES the entire contents of each targeted row.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        updates: z
            .array(z.object({
            row: z.number().int().min(0).describe("Row index (0-based)"),
            values: z
                .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
                .describe("Column values for the entire row"),
        }))
            .min(1)
            .describe("Array of row updates"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        table: z.string().optional().describe("Table name (default: first table)"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        rowsUpdated: z.number().optional(),
    },
}, withErrorHandling(({ path, updates, sheet, table }) => {
    const result = manager.updateRows(path, updates, { sheet, table });
    return successResponse(`Updated ${result.rowsUpdated} rows in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "update-rows"));
// rename-sheet
server.registerTool("rename-sheet", {
    description: "Use when: you want to change a sheet's name in a .numbers file. Defaults to the first sheet if the current name is omitted.\n" +
        "Returns: the old and new sheet names.\n" +
        "Do not use when: renaming a table — use rename-table.\n" +
        "Safety: modifies the .numbers file in place via the numbers-parser sidecar (does not require Numbers.app).",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        newName: z.string().describe("New name for the sheet"),
        sheet: z.string().optional().describe("Current sheet name (default: first sheet)"),
    },
    outputSchema: {
        path: z.string().optional(),
        oldName: z.string().optional(),
        newName: z.string().optional(),
        sheetName: z.string().optional(),
    },
}, withErrorHandling(({ path, newName, sheet }) => {
    const result = manager.renameSheet(path, newName, sheet);
    return successResponse(`Renamed sheet "${result.oldName}" → "${result.newName}"`, {
        ...result,
    });
}, "rename-sheet"));
// rename-table
server.registerTool("rename-table", {
    description: "Use when: you want to change a table's name in a .numbers file. Defaults to the first sheet/table if omitted.\n" +
        "Returns: the old and new table names and the sheet it belongs to.\n" +
        "Do not use when: renaming a sheet — use rename-sheet.\n" +
        "Safety: modifies the .numbers file in place via the numbers-parser sidecar (does not require Numbers.app).",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        newName: z.string().describe("New name for the table"),
        sheet: z.string().optional().describe("Sheet name (default: first sheet)"),
        table: z.string().optional().describe("Current table name (default: first table)"),
    },
    outputSchema: {
        path: z.string().optional(),
        oldName: z.string().optional(),
        newName: z.string().optional(),
        sheetName: z.string().optional(),
    },
}, withErrorHandling(({ path, newName, sheet, table }) => {
    const result = manager.renameTable(path, newName, { sheet, table });
    return successResponse(`Renamed table "${result.oldName}" → "${result.newName}" in sheet "${result.sheetName}"`, { ...result });
}, "rename-table"));
// set-formula
server.registerTool("set-formula", {
    description: 'Use when: you need to write a live formula (e.g. "=SUM(A2:A10)") into a cell so it computes in Numbers, addressed by 0-based row/col. Requires explicit sheet and table.\n' +
        "Returns: the cell, the formula set, and its computed value.\n" +
        "Do not use when: writing a plain computed value — use set-cell (this tool is for live formulas); or setting many formulas — use set-formulas-batch.\n" +
        "Safety: drives Numbers.app via AppleScript and requires Numbers.app to be running plus Automation permission. The file is opened if not already open, the formula OVERWRITES any existing content in the target cell, and the file is saved in place.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        row: z.number().int().min(0).describe("Row index (0-based)"),
        col: z.number().int().min(0).describe("Column index (0-based)"),
        formula: z.string().describe('Formula string (e.g., "=SUM(A2:A10)")'),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        cell: z.string().optional(),
        formula: z.string().optional(),
        computedValue: z.string().optional(),
    },
}, withErrorHandling(({ path, sheet, table, row, col, formula }) => {
    const result = manager.setCellFormula(path, sheet, table, row, col, formula);
    return successResponse(`Set formula on ${result.cell} in "${result.sheetName}/${result.tableName}"\n` +
        `Formula: ${result.formula}\nComputed value: ${result.computedValue}`, { ...result });
}, "set-formula"));
// set-formulas-batch
server.registerTool("set-formulas-batch", {
    description: "Use when: you need to write live formulas to multiple cells at once (each with 0-based row/col); more efficient than many set-formula calls. Requires explicit sheet and table.\n" +
        "Returns: the number of formulas set and the sheet/table affected.\n" +
        "Do not use when: writing plain computed values — use set-cells-batch; or setting a single formula — use set-formula.\n" +
        "Safety: drives Numbers.app via AppleScript and requires Numbers.app to be running plus Automation permission. Modifies the file in place and OVERWRITES any existing content in the targeted cells.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        formulas: z
            .array(z.object({
            row: z.number().int().min(0).describe("Row index (0-based)"),
            col: z.number().int().min(0).describe("Column index (0-based)"),
            formula: z.string().describe("Formula string"),
        }))
            .min(1)
            .describe("Array of formula assignments"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        cellsSet: z.number().optional(),
    },
}, withErrorHandling(({ path, sheet, table, formulas }) => {
    const result = manager.setCellFormulasBatch(path, sheet, table, formulas);
    return successResponse(`Set ${result.cellsSet} formulas in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "set-formulas-batch"));
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
server.registerTool("set-cell-style", {
    description: "Use when: you need to format one cell — font, text/background color, number format, alignment, text wrap — addressed by 0-based row/col. Requires explicit sheet and table.\n" +
        "Returns: the styled cell and the sheet/table affected.\n" +
        "Do not use when: styling many cells — use set-cells-style-batch; or writing a value/formula rather than formatting — use set-cell / set-formula.\n" +
        "Safety: drives Numbers.app via AppleScript — modifies the file in place and requires Numbers.app to be running plus Automation permission.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        row: z.number().int().min(0).describe("Row index (0-based)"),
        col: z.number().int().min(0).describe("Column index (0-based)"),
        style: cellStyleSchema.describe("Style properties to set"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        cell: z.string().optional(),
    },
}, withErrorHandling(({ path, sheet, table, row, col, style }) => {
    const result = manager.setCellStyle(path, sheet, table, row, col, style);
    return successResponse(`Styled cell ${result.cell} in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "set-cell-style"));
// set-cells-style-batch
server.registerTool("set-cells-style-batch", {
    description: "Use when: you need to format multiple cells at once (each with 0-based row/col); more efficient than many set-cell-style calls. Requires explicit sheet and table.\n" +
        "Returns: the number of cells styled and the sheet/table affected.\n" +
        "Do not use when: styling a single cell — use set-cell-style; or writing values/formulas rather than formatting — use set-cells-batch / set-formulas-batch.\n" +
        "Safety: drives Numbers.app via AppleScript — modifies the file in place and requires Numbers.app to be running plus Automation permission.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        entries: z
            .array(z.object({
            row: z.number().int().min(0).describe("Row index (0-based)"),
            col: z.number().int().min(0).describe("Column index (0-based)"),
            style: cellStyleSchema,
        }))
            .min(1)
            .describe("Array of cell style assignments"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        cellsStyled: z.number().optional(),
    },
}, withErrorHandling(({ path, sheet, table, entries }) => {
    const result = manager.setCellsStyleBatch(path, sheet, table, entries);
    return successResponse(`Styled ${result.cellsStyled} cells in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "set-cells-style-batch"));
// set-column-width
server.registerTool("set-column-width", {
    description: "Use when: you need to set a column's width in pixels, addressed by 0-based column index. Requires explicit sheet and table.\n" +
        "Returns: the column index and the width applied.\n" +
        "Do not use when: setting a row's height — use set-row-height.\n" +
        "Safety: drives Numbers.app via AppleScript — modifies the file in place and requires Numbers.app to be running plus Automation permission.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        col: z.number().int().min(0).describe("Column index (0-based)"),
        width: z.number().min(0).describe("Width in pixels"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheet: z.string().optional(),
        table: z.string().optional(),
        col: z.number().optional(),
        width: z.number().optional(),
    },
}, withErrorHandling(({ path, sheet, table, col, width }) => {
    manager.setColumnWidth(path, sheet, table, col, width);
    return successResponse(`Set column ${col} width to ${width}px in "${sheet}/${table}"`, {
        path,
        sheet,
        table,
        col,
        width,
    });
}, "set-column-width"));
// set-row-height
server.registerTool("set-row-height", {
    description: "Use when: you need to set a row's height in pixels, addressed by 0-based row index. Requires explicit sheet and table.\n" +
        "Returns: the row index and the height applied.\n" +
        "Do not use when: setting a column's width — use set-column-width.\n" +
        "Safety: drives Numbers.app via AppleScript — modifies the file in place and requires Numbers.app to be running plus Automation permission.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        row: z.number().int().min(0).describe("Row index (0-based)"),
        height: z.number().min(0).describe("Height in pixels"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheet: z.string().optional(),
        table: z.string().optional(),
        row: z.number().optional(),
        height: z.number().optional(),
    },
}, withErrorHandling(({ path, sheet, table, row, height }) => {
    manager.setRowHeight(path, sheet, table, row, height);
    return successResponse(`Set row ${row} height to ${height}px in "${sheet}/${table}"`, {
        path,
        sheet,
        table,
        row,
        height,
    });
}, "set-row-height"));
// merge-cells
server.registerTool("merge-cells", {
    description: "Use when: you need to merge a rectangular range of cells into one, given 0-based inclusive top-left and bottom-right coordinates. Requires explicit sheet and table.\n" +
        "Returns: the merged range and the sheet/table affected.\n" +
        "Do not use when: undoing a merge — use unmerge-cells.\n" +
        "Safety: drives Numbers.app via AppleScript — modifies the file in place and requires Numbers.app to be running plus Automation permission. Merging keeps only the top-left cell's content and can DROP the values in the other cells of the range.",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        startRow: z.number().int().min(0).describe("Top-left row (0-based)"),
        startCol: z.number().int().min(0).describe("Top-left column (0-based)"),
        endRow: z.number().int().min(0).describe("Bottom-right row (0-based)"),
        endCol: z.number().int().min(0).describe("Bottom-right column (0-based)"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        range: z.string().optional(),
    },
}, withErrorHandling(({ path, sheet, table, startRow, startCol, endRow, endCol }) => {
    const result = manager.mergeCells(path, sheet, table, startRow, startCol, endRow, endCol);
    return successResponse(`Merged ${result.range} in "${result.sheetName}/${result.tableName}"`, {
        ...result,
    });
}, "merge-cells"));
// unmerge-cells
server.registerTool("unmerge-cells", {
    description: "Use when: you need to split a previously merged range back into individual cells, given 0-based inclusive top-left and bottom-right coordinates. Requires explicit sheet and table.\n" +
        "Returns: the unmerged range and the sheet/table affected.\n" +
        "Do not use when: creating a merge — use merge-cells.\n" +
        "Safety: drives Numbers.app via AppleScript — modifies the file in place and requires Numbers.app to be running plus Automation permission. Previously merged cells stay empty (the original non-top-left values are not restored).",
    inputSchema: {
        path: z.string().describe("Path to the .numbers file"),
        sheet: z.string().describe("Sheet name"),
        table: z.string().describe("Table name"),
        startRow: z.number().int().min(0).describe("Top-left row (0-based)"),
        startCol: z.number().int().min(0).describe("Top-left column (0-based)"),
        endRow: z.number().int().min(0).describe("Bottom-right row (0-based)"),
        endCol: z.number().int().min(0).describe("Bottom-right column (0-based)"),
    },
    outputSchema: {
        path: z.string().optional(),
        sheetName: z.string().optional(),
        tableName: z.string().optional(),
        range: z.string().optional(),
    },
}, withErrorHandling(({ path, sheet, table, startRow, startCol, endRow, endCol }) => {
    const result = manager.unmergeCells(path, sheet, table, startRow, startCol, endRow, endCol);
    return successResponse(`Unmerged ${result.range} in "${result.sheetName}/${result.tableName}"`, { ...result });
}, "unmerge-cells"));
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
//# sourceMappingURL=index.js.map