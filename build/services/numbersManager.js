import { runNumbersReader, checkDependencies } from "../utils/python.js";
import { setFormula, setFormulasBatch, setCellStyle, setCellsStyleBatch, setColumnWidth, setRowHeight, mergeCells, unmergeCells, } from "../utils/applescript.js";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { homedir } from "node:os";
export class NumbersManager {
    validatePath(filePath) {
        // Expand ~ to home directory
        const expanded = filePath.startsWith("~") ? filePath.replace(/^~/, homedir()) : filePath;
        const resolved = resolve(expanded);
        if (!existsSync(resolved)) {
            throw new Error(`File not found: ${resolved}`);
        }
        if (extname(resolved).toLowerCase() !== ".numbers") {
            throw new Error(`Not a Numbers file: ${resolved}. Expected .numbers extension.`);
        }
        return resolved;
    }
    /**
     * Resolve and validate an output path for new files.
     * Expands ~ and checks .numbers extension, but does NOT require the file to exist.
     */
    validateOutputPath(filePath) {
        const expanded = filePath.startsWith("~") ? filePath.replace(/^~/, homedir()) : filePath;
        const resolved = resolve(expanded);
        if (extname(resolved).toLowerCase() !== ".numbers") {
            throw new Error(`Not a Numbers file path: ${resolved}. Expected .numbers extension.`);
        }
        return resolved;
    }
    /**
     * Resolve a generic path (expand ~ and resolve).
     */
    resolvePath(filePath) {
        const expanded = filePath.startsWith("~") ? filePath.replace(/^~/, homedir()) : filePath;
        return resolve(expanded);
    }
    /**
     * Get file structure: sheets, tables, dimensions, headers.
     */
    getFileInfo(filePath) {
        const resolved = this.validatePath(filePath);
        const result = runNumbersReader("info", [resolved]);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Read data from a table with optional range filtering.
     */
    readTable(filePath, sheet, table, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved];
        if (sheet)
            args.push("--sheet", sheet);
        if (table)
            args.push("--table", table);
        if (options?.startRow !== undefined)
            args.push("--start-row", String(options.startRow));
        if (options?.endRow !== undefined)
            args.push("--end-row", String(options.endRow));
        if (options?.columns)
            args.push("--columns", JSON.stringify(options.columns));
        const result = runNumbersReader("read", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Search for a string value across all cells in the file.
     */
    search(filePath, query, sheet) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, query];
        if (sheet)
            args.push("--sheet", sheet);
        const result = runNumbersReader("search", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Export a table to CSV, TSV, or JSON file.
     */
    exportTable(filePath, format, outputPath, sheet, table) {
        const resolved = this.validatePath(filePath);
        const outputResolved = this.resolvePath(outputPath);
        const args = [resolved, format, outputResolved];
        if (sheet)
            args.push("--sheet", sheet);
        if (table)
            args.push("--table", table);
        const result = runNumbersReader("export", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Read a single cell value by row/col index. Set verbose for formula/metadata.
     */
    getCell(filePath, sheet, table, row, col, verbose) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, sheet, table, String(row), String(col)];
        if (verbose)
            args.push("--verbose");
        const result = runNumbersReader("cell", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Create a new .numbers file with headers and optional data rows.
     */
    createSpreadsheet(filePath, headers, options) {
        const resolved = this.validateOutputPath(filePath);
        const args = [resolved, JSON.stringify(headers)];
        if (options?.sheetName)
            args.push("--sheet-name", options.sheetName);
        if (options?.tableName)
            args.push("--table-name", options.tableName);
        if (options?.rows)
            args.push("--rows", JSON.stringify(options.rows));
        const result = runNumbersReader("create", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Write a single cell value in an existing file.
     */
    setCell(filePath, row, col, value, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, String(row), String(col), JSON.stringify(value)];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.table)
            args.push("--table", options.table);
        if (options?.type)
            args.push("--type", options.type);
        const result = runNumbersReader("set-cell", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Write multiple cell values in one operation.
     */
    setCellsBatch(filePath, updates, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, JSON.stringify(updates)];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.table)
            args.push("--table", options.table);
        const result = runNumbersReader("set-cells", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Append rows of data to an existing table.
     */
    addRows(filePath, rows, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, JSON.stringify(rows)];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.table)
            args.push("--table", options.table);
        const result = runNumbersReader("add-rows", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Delete rows from a table by index range (inclusive).
     */
    deleteRows(filePath, startRow, endRow, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, String(startRow), String(endRow)];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.table)
            args.push("--table", options.table);
        const result = runNumbersReader("delete-rows", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Add a new sheet to an existing file.
     */
    addSheet(filePath, sheetName, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, sheetName];
        if (options?.tableName)
            args.push("--table-name", options.tableName);
        if (options?.headers)
            args.push("--headers", JSON.stringify(options.headers));
        if (options?.numRows !== undefined)
            args.push("--num-rows", String(options.numRows));
        if (options?.numCols !== undefined)
            args.push("--num-cols", String(options.numCols));
        const result = runNumbersReader("add-sheet", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Add a new table to an existing sheet.
     */
    addTable(filePath, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.tableName)
            args.push("--table-name", options.tableName);
        if (options?.headers)
            args.push("--headers", JSON.stringify(options.headers));
        if (options?.numRows !== undefined)
            args.push("--num-rows", String(options.numRows));
        if (options?.numCols !== undefined)
            args.push("--num-cols", String(options.numCols));
        const result = runNumbersReader("add-table", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Import a CSV/TSV/JSON file into a new .numbers file.
     */
    importFile(inputPath, outputPath, options) {
        const inputResolved = this.resolvePath(inputPath);
        if (!existsSync(inputResolved)) {
            throw new Error(`Input file not found: ${inputResolved}`);
        }
        const outputResolved = this.validateOutputPath(outputPath);
        const args = [inputResolved, outputResolved];
        if (options?.format && options.format !== "auto")
            args.push("--format", options.format);
        if (options?.sheetName)
            args.push("--sheet-name", options.sheetName);
        if (options?.tableName)
            args.push("--table-name", options.tableName);
        const result = runNumbersReader("import", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Write full rows by index.
     */
    updateRows(filePath, updates, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, JSON.stringify(updates)];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.table)
            args.push("--table", options.table);
        const result = runNumbersReader("update-rows", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Rename a sheet.
     */
    renameSheet(filePath, newName, sheet) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, newName];
        if (sheet)
            args.push("--sheet", sheet);
        const result = runNumbersReader("rename-sheet", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Rename a table.
     */
    renameTable(filePath, newName, options) {
        const resolved = this.validatePath(filePath);
        const args = [resolved, newName];
        if (options?.sheet)
            args.push("--sheet", options.sheet);
        if (options?.table)
            args.push("--table", options.table);
        const result = runNumbersReader("rename-table", args);
        if (result.error)
            throw new Error(result.error);
        return result.data;
    }
    /**
     * Set a formula on a cell via AppleScript. Requires Numbers.app to be running.
     */
    setCellFormula(filePath, sheet, table, row, col, formula) {
        const resolved = this.validatePath(filePath);
        return setFormula(resolved, sheet, table, row, col, formula);
    }
    /**
     * Set formulas on multiple cells via AppleScript. Requires Numbers.app to be running.
     */
    setCellFormulasBatch(filePath, sheet, table, formulas) {
        const resolved = this.validatePath(filePath);
        return setFormulasBatch(resolved, sheet, table, formulas);
    }
    /**
     * Set cell style via AppleScript. Requires Numbers.app.
     */
    setCellStyle(filePath, sheet, table, row, col, style) {
        const resolved = this.validatePath(filePath);
        return setCellStyle(resolved, sheet, table, row, col, style);
    }
    /**
     * Set styles on multiple cells via AppleScript. Requires Numbers.app.
     */
    setCellsStyleBatch(filePath, sheet, table, entries) {
        const resolved = this.validatePath(filePath);
        return setCellsStyleBatch(resolved, sheet, table, entries);
    }
    /**
     * Set column width via AppleScript. Requires Numbers.app.
     */
    setColumnWidth(filePath, sheet, table, col, width) {
        const resolved = this.validatePath(filePath);
        return setColumnWidth(resolved, sheet, table, col, width);
    }
    /**
     * Set row height via AppleScript. Requires Numbers.app.
     */
    setRowHeight(filePath, sheet, table, row, height) {
        const resolved = this.validatePath(filePath);
        return setRowHeight(resolved, sheet, table, row, height);
    }
    /**
     * Merge a range of cells via AppleScript. Requires Numbers.app.
     */
    mergeCells(filePath, sheet, table, startRow, startCol, endRow, endCol) {
        const resolved = this.validatePath(filePath);
        return mergeCells(resolved, sheet, table, startRow, startCol, endRow, endCol);
    }
    /**
     * Unmerge a range of cells via AppleScript. Requires Numbers.app.
     */
    unmergeCells(filePath, sheet, table, startRow, startCol, endRow, endCol) {
        const resolved = this.validatePath(filePath);
        return unmergeCells(resolved, sheet, table, startRow, startCol, endRow, endCol);
    }
    /**
     * Check that Python and numbers-parser are available.
     */
    healthCheck() {
        return checkDependencies();
    }
}
//# sourceMappingURL=numbersManager.js.map