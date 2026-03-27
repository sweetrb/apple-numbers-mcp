import { runNumbersReader, checkDependencies } from '../utils/python.js';
import type {
  NumbersFileInfo,
  TableData,
  SearchResult,
  ExportResult,
  CellValue,
} from '../types.js';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { homedir } from 'node:os';

export class NumbersManager {
  private validatePath(filePath: string): string {
    // Expand ~ to home directory
    const expanded = filePath.startsWith('~')
      ? filePath.replace(/^~/, homedir())
      : filePath;
    const resolved = resolve(expanded);

    if (!existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
    if (extname(resolved).toLowerCase() !== '.numbers') {
      throw new Error(`Not a Numbers file: ${resolved}. Expected .numbers extension.`);
    }
    return resolved;
  }

  /**
   * Get file structure: sheets, tables, dimensions, headers.
   */
  getFileInfo(filePath: string): NumbersFileInfo {
    const resolved = this.validatePath(filePath);
    const result = runNumbersReader<NumbersFileInfo>('info', [resolved]);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Read all data from a table. Returns headers + rows.
   * Defaults to first sheet, first table if not specified.
   */
  readTable(filePath: string, sheet?: string, table?: string): TableData {
    const resolved = this.validatePath(filePath);
    const args = [resolved];
    if (sheet) args.push('--sheet', sheet);
    if (table) args.push('--table', table);
    const result = runNumbersReader<TableData>('read', args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Search for a string value across all cells in the file.
   * Optionally restrict to a specific sheet.
   */
  search(filePath: string, query: string, sheet?: string): { results: SearchResult[]; count: number } {
    const resolved = this.validatePath(filePath);
    const args = [resolved, query];
    if (sheet) args.push('--sheet', sheet);
    const result = runNumbersReader<{ results: SearchResult[]; count: number }>('search', args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Export a table to CSV, TSV, or JSON file.
   */
  exportTable(
    filePath: string,
    format: 'csv' | 'json' | 'tsv',
    outputPath: string,
    sheet?: string,
    table?: string,
  ): ExportResult {
    const resolved = this.validatePath(filePath);
    const outputResolved = outputPath.startsWith('~')
      ? outputPath.replace(/^~/, homedir())
      : resolve(outputPath);
    const args = [resolved, format, outputResolved];
    if (sheet) args.push('--sheet', sheet);
    if (table) args.push('--table', table);
    const result = runNumbersReader<ExportResult>('export', args);
    if (result.error) throw new Error(result.error);
    return result.data!;
  }

  /**
   * Read a single cell value by row/col index.
   */
  getCell(filePath: string, sheet: string, table: string, row: number, col: number): CellValue {
    const resolved = this.validatePath(filePath);
    const result = runNumbersReader<CellValue>('cell', [
      resolved, sheet, table, String(row), String(col),
    ]);
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
