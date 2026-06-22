import { type SetFormulaResult, type SetFormulasBatchResult, type CellStyle, type CellStyleResult, type BatchStyleEntry, type SetCellsStyleBatchResult, type SetDimensionResult, type MergeResult } from "../utils/applescript.js";
import type { NumbersFileInfo, TableData, SearchResult, ExportResult, CellValue, CreateResult, SetCellResult, SetCellsBatchResult, AddRowsResult, DeleteRowsResult, AddSheetResult, AddTableResult, ImportResult, UpdateRowsResult, RenameResult } from "../types.js";
export declare class NumbersManager {
    private validatePath;
    /**
     * Resolve and validate an output path for new files.
     * Expands ~ and checks .numbers extension, but does NOT require the file to exist.
     */
    private validateOutputPath;
    /**
     * Resolve a generic path (expand ~ and resolve).
     */
    private resolvePath;
    /**
     * Get file structure: sheets, tables, dimensions, headers.
     */
    getFileInfo(filePath: string): NumbersFileInfo;
    /**
     * Read data from a table with optional range filtering.
     */
    readTable(filePath: string, sheet?: string, table?: string, options?: {
        startRow?: number;
        endRow?: number;
        columns?: (string | number)[];
    }): TableData;
    /**
     * Search for a string value across all cells in the file.
     */
    search(filePath: string, query: string, sheet?: string): {
        results: SearchResult[];
        count: number;
    };
    /**
     * Export a table to CSV, TSV, or JSON file.
     */
    exportTable(filePath: string, format: "csv" | "json" | "tsv", outputPath: string, sheet?: string, table?: string): ExportResult;
    /**
     * Read a single cell value by row/col index. Set verbose for formula/metadata.
     */
    getCell(filePath: string, sheet: string, table: string, row: number, col: number, verbose?: boolean): CellValue;
    /**
     * Create a new .numbers file with headers and optional data rows.
     */
    createSpreadsheet(filePath: string, headers: string[], options?: {
        sheetName?: string;
        tableName?: string;
        rows?: unknown[][];
    }): CreateResult;
    /**
     * Write a single cell value in an existing file.
     */
    setCell(filePath: string, row: number, col: number, value: unknown, options?: {
        sheet?: string;
        table?: string;
        type?: string;
    }): SetCellResult;
    /**
     * Write multiple cell values in one operation.
     */
    setCellsBatch(filePath: string, updates: {
        row: number;
        col: number;
        value: unknown;
        type?: string;
    }[], options?: {
        sheet?: string;
        table?: string;
    }): SetCellsBatchResult;
    /**
     * Append rows of data to an existing table.
     */
    addRows(filePath: string, rows: unknown[][], options?: {
        sheet?: string;
        table?: string;
    }): AddRowsResult;
    /**
     * Delete rows from a table by index range (inclusive).
     */
    deleteRows(filePath: string, startRow: number, endRow: number, options?: {
        sheet?: string;
        table?: string;
    }): DeleteRowsResult;
    /**
     * Add a new sheet to an existing file.
     */
    addSheet(filePath: string, sheetName: string, options?: {
        tableName?: string;
        headers?: string[];
        numRows?: number;
        numCols?: number;
    }): AddSheetResult;
    /**
     * Add a new table to an existing sheet.
     */
    addTable(filePath: string, options?: {
        sheet?: string;
        tableName?: string;
        headers?: string[];
        numRows?: number;
        numCols?: number;
    }): AddTableResult;
    /**
     * Import a CSV/TSV/JSON file into a new .numbers file.
     */
    importFile(inputPath: string, outputPath: string, options?: {
        format?: "auto" | "csv" | "tsv" | "json";
        sheetName?: string;
        tableName?: string;
    }): ImportResult;
    /**
     * Write full rows by index.
     */
    updateRows(filePath: string, updates: {
        row: number;
        values: unknown[];
    }[], options?: {
        sheet?: string;
        table?: string;
    }): UpdateRowsResult;
    /**
     * Rename a sheet.
     */
    renameSheet(filePath: string, newName: string, sheet?: string): RenameResult;
    /**
     * Rename a table.
     */
    renameTable(filePath: string, newName: string, options?: {
        sheet?: string;
        table?: string;
    }): RenameResult;
    /**
     * Set a formula on a cell via AppleScript. Requires Numbers.app to be running.
     */
    setCellFormula(filePath: string, sheet: string, table: string, row: number, col: number, formula: string): SetFormulaResult;
    /**
     * Set formulas on multiple cells via AppleScript. Requires Numbers.app to be running.
     */
    setCellFormulasBatch(filePath: string, sheet: string, table: string, formulas: {
        row: number;
        col: number;
        formula: string;
    }[]): SetFormulasBatchResult;
    /**
     * Set cell style via AppleScript. Requires Numbers.app.
     */
    setCellStyle(filePath: string, sheet: string, table: string, row: number, col: number, style: CellStyle): CellStyleResult;
    /**
     * Set styles on multiple cells via AppleScript. Requires Numbers.app.
     */
    setCellsStyleBatch(filePath: string, sheet: string, table: string, entries: BatchStyleEntry[]): SetCellsStyleBatchResult;
    /**
     * Set column width via AppleScript. Requires Numbers.app.
     */
    setColumnWidth(filePath: string, sheet: string, table: string, col: number, width: number): SetDimensionResult;
    /**
     * Set row height via AppleScript. Requires Numbers.app.
     */
    setRowHeight(filePath: string, sheet: string, table: string, row: number, height: number): SetDimensionResult;
    /**
     * Merge a range of cells via AppleScript. Requires Numbers.app.
     */
    mergeCells(filePath: string, sheet: string, table: string, startRow: number, startCol: number, endRow: number, endCol: number): MergeResult;
    /**
     * Unmerge a range of cells via AppleScript. Requires Numbers.app.
     */
    unmergeCells(filePath: string, sheet: string, table: string, startRow: number, startCol: number, endRow: number, endCol: number): MergeResult;
    /**
     * Check that Python and numbers-parser are available.
     */
    healthCheck(): {
        ok: boolean;
        message: string;
    };
}
//# sourceMappingURL=numbersManager.d.ts.map