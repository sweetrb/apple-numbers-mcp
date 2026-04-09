import { runNumbersReader, checkDependencies } from "../utils/python.js";
import type {
  NumbersFileInfo,
  TableData,
  SearchResult,
  ExportResult,
  CellValue,
  CreateResult,
  SetCellResult,
  SetCellsBatchResult,
  AddRowsResult,
  DeleteRowsResult,
  AddSheetResult,
  AddTableResult,
  ImportResult,
  UpdateRowsResult,
  RenameResult,
} from "../types.js";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { homedir } from "node:os";

export class NumbersManager {
  private validatePath(filePath: string): string {
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
  private validateOutputPath(filePath: string): string {
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
  private resolvePath(filePath: string): string {
    const expanded = filePath.startsWith("~") ? filePath.replace(/^~/, homedir()) : filePath;
    return resolve(expanded);
  }

  /**
   * Get file structure: sheets, tables, dimensions, headers.
   */
  getFileInfo(filePath: string): NumbersFileInfo {
    const resolved = this.validatePath(filePath);
    const result = runNumbersReader<NumbersFileInfo>("info", [resolved]);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Read data from a table with optional range filtering.
   */
  readTable(
    filePath: string,
    sheet?: string,
    table?: string,
    options?: {
      startRow?: number;
      endRow?: number;
      columns?: (string | number)[];
    }
  ): TableData {
    const resolved = this.validatePath(filePath);
    const args = [resolved];
    if (sheet) args.push("--sheet", sheet);
    if (table) args.push("--table", table);
    if (options?.startRow !== undefined) args.push("--start-row", String(options.startRow));
    if (options?.endRow !== undefined) args.push("--end-row", String(options.endRow));
    if (options?.columns) args.push("--columns", JSON.stringify(options.columns));
    const result = runNumbersReader<TableData>("read", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Search for a string value across all cells in the file.
   */
  search(
    filePath: string,
    query: string,
    sheet?: string
  ): { results: SearchResult[]; count: number } {
    const resolved = this.validatePath(filePath);
    const args = [resolved, query];
    if (sheet) args.push("--sheet", sheet);
    const result = runNumbersReader<{ results: SearchResult[]; count: number }>("search", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Export a table to CSV, TSV, or JSON file.
   */
  exportTable(
    filePath: string,
    format: "csv" | "json" | "tsv",
    outputPath: string,
    sheet?: string,
    table?: string
  ): ExportResult {
    const resolved = this.validatePath(filePath);
    const outputResolved = this.resolvePath(outputPath);
    const args = [resolved, format, outputResolved];
    if (sheet) args.push("--sheet", sheet);
    if (table) args.push("--table", table);
    const result = runNumbersReader<ExportResult>("export", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Read a single cell value by row/col index. Set verbose for formula/metadata.
   */
  getCell(
    filePath: string,
    sheet: string,
    table: string,
    row: number,
    col: number,
    verbose?: boolean
  ): CellValue {
    const resolved = this.validatePath(filePath);
    const args = [resolved, sheet, table, String(row), String(col)];
    if (verbose) args.push("--verbose");
    const result = runNumbersReader<CellValue>("cell", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Create a new .numbers file with headers and optional data rows.
   */
  createSpreadsheet(
    filePath: string,
    headers: string[],
    options?: { sheetName?: string; tableName?: string; rows?: unknown[][] }
  ): CreateResult {
    const resolved = this.validateOutputPath(filePath);
    const args = [resolved, JSON.stringify(headers)];
    if (options?.sheetName) args.push("--sheet-name", options.sheetName);
    if (options?.tableName) args.push("--table-name", options.tableName);
    if (options?.rows) args.push("--rows", JSON.stringify(options.rows));
    const result = runNumbersReader<CreateResult>("create", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Write a single cell value in an existing file.
   */
  setCell(
    filePath: string,
    row: number,
    col: number,
    value: unknown,
    options?: { sheet?: string; table?: string; type?: string }
  ): SetCellResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, String(row), String(col), JSON.stringify(value)];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.table) args.push("--table", options.table);
    if (options?.type) args.push("--type", options.type);
    const result = runNumbersReader<SetCellResult>("set-cell", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Write multiple cell values in one operation.
   */
  setCellsBatch(
    filePath: string,
    updates: { row: number; col: number; value: unknown; type?: string }[],
    options?: { sheet?: string; table?: string }
  ): SetCellsBatchResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, JSON.stringify(updates)];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.table) args.push("--table", options.table);
    const result = runNumbersReader<SetCellsBatchResult>("set-cells", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Append rows of data to an existing table.
   */
  addRows(
    filePath: string,
    rows: unknown[][],
    options?: { sheet?: string; table?: string }
  ): AddRowsResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, JSON.stringify(rows)];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.table) args.push("--table", options.table);
    const result = runNumbersReader<AddRowsResult>("add-rows", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Delete rows from a table by index range (inclusive).
   */
  deleteRows(
    filePath: string,
    startRow: number,
    endRow: number,
    options?: { sheet?: string; table?: string }
  ): DeleteRowsResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, String(startRow), String(endRow)];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.table) args.push("--table", options.table);
    const result = runNumbersReader<DeleteRowsResult>("delete-rows", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Add a new sheet to an existing file.
   */
  addSheet(
    filePath: string,
    sheetName: string,
    options?: { tableName?: string; headers?: string[]; numRows?: number; numCols?: number }
  ): AddSheetResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, sheetName];
    if (options?.tableName) args.push("--table-name", options.tableName);
    if (options?.headers) args.push("--headers", JSON.stringify(options.headers));
    if (options?.numRows !== undefined) args.push("--num-rows", String(options.numRows));
    if (options?.numCols !== undefined) args.push("--num-cols", String(options.numCols));
    const result = runNumbersReader<AddSheetResult>("add-sheet", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Add a new table to an existing sheet.
   */
  addTable(
    filePath: string,
    options?: {
      sheet?: string;
      tableName?: string;
      headers?: string[];
      numRows?: number;
      numCols?: number;
    }
  ): AddTableResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.tableName) args.push("--table-name", options.tableName);
    if (options?.headers) args.push("--headers", JSON.stringify(options.headers));
    if (options?.numRows !== undefined) args.push("--num-rows", String(options.numRows));
    if (options?.numCols !== undefined) args.push("--num-cols", String(options.numCols));
    const result = runNumbersReader<AddTableResult>("add-table", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Import a CSV/TSV/JSON file into a new .numbers file.
   */
  importFile(
    inputPath: string,
    outputPath: string,
    options?: { format?: "auto" | "csv" | "tsv" | "json"; sheetName?: string; tableName?: string }
  ): ImportResult {
    const inputResolved = this.resolvePath(inputPath);
    if (!existsSync(inputResolved)) {
      throw new Error(`Input file not found: ${inputResolved}`);
    }
    const outputResolved = this.validateOutputPath(outputPath);
    const args = [inputResolved, outputResolved];
    if (options?.format && options.format !== "auto") args.push("--format", options.format);
    if (options?.sheetName) args.push("--sheet-name", options.sheetName);
    if (options?.tableName) args.push("--table-name", options.tableName);
    const result = runNumbersReader<ImportResult>("import", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Write full rows by index.
   */
  updateRows(
    filePath: string,
    updates: { row: number; values: unknown[] }[],
    options?: { sheet?: string; table?: string }
  ): UpdateRowsResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, JSON.stringify(updates)];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.table) args.push("--table", options.table);
    const result = runNumbersReader<UpdateRowsResult>("update-rows", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Rename a sheet.
   */
  renameSheet(filePath: string, newName: string, sheet?: string): RenameResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, newName];
    if (sheet) args.push("--sheet", sheet);
    const result = runNumbersReader<RenameResult>("rename-sheet", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Rename a table.
   */
  renameTable(
    filePath: string,
    newName: string,
    options?: { sheet?: string; table?: string }
  ): RenameResult {
    const resolved = this.validatePath(filePath);
    const args = [resolved, newName];
    if (options?.sheet) args.push("--sheet", options.sheet);
    if (options?.table) args.push("--table", options.table);
    const result = runNumbersReader<RenameResult>("rename-table", args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Check that Python and numbers-parser are available.
   */
  healthCheck(): { ok: boolean; message: string } {
    return checkDependencies();
  }
}
