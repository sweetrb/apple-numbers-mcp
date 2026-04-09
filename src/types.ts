export interface NumbersFileInfo {
  path: string;
  sheets: SheetInfo[];
  defaultSheet: string;
}

export interface SheetInfo {
  name: string;
  tables: TableInfo[];
}

export interface TableInfo {
  name: string;
  sheetName: string;
  numRows: number;
  numCols: number;
  headerRow: string[];
}

export interface CellValue {
  row: number;
  col: number;
  value: string | number | boolean | null;
  type: "string" | "number" | "boolean" | "date" | "duration" | "empty" | "error";
  formattedValue?: string;
}

export interface TableData {
  sheetName: string;
  tableName: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
  numRows: number;
  numCols: number;
}

export interface SearchResult {
  sheetName: string;
  tableName: string;
  row: number;
  col: number;
  header: string;
  value: string | number | boolean | null;
}

export interface ExportOptions {
  format: "csv" | "json" | "tsv";
  sheet?: string;
  table?: string;
  outputPath?: string;
  includeHeaders?: boolean;
}

export interface ExportResult {
  outputPath: string;
  format: string;
  rowCount: number;
  sheetName: string;
  tableName: string;
}
