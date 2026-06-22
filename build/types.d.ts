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
    formula?: string | null;
    isFormula?: boolean;
    isMerged?: boolean;
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
export interface CreateResult {
    path: string;
    sheetName: string;
    tableName: string;
    numHeaders: number;
    numRows: number;
}
export interface SetCellResult {
    path: string;
    sheetName: string;
    tableName: string;
    row: number;
    col: number;
    value: string;
}
export interface SetCellsBatchResult {
    path: string;
    sheetName: string;
    tableName: string;
    cellsWritten: number;
}
export interface AddRowsResult {
    path: string;
    sheetName: string;
    tableName: string;
    rowsAdded: number;
    startRow: number;
    newTotalRows: number;
}
export interface DeleteRowsResult {
    path: string;
    sheetName: string;
    tableName: string;
    rowsDeleted: number;
    newTotalRows: number;
}
export interface AddSheetResult {
    path: string;
    sheetName: string;
    tableName: string;
    numRows: number;
    numCols: number;
}
export interface AddTableResult {
    path: string;
    sheetName: string;
    tableName: string;
    numRows: number;
    numCols: number;
}
export interface ImportResult {
    path: string;
    inputPath: string;
    format: string;
    sheetName: string;
    tableName: string;
    numHeaders: number;
    numRows: number;
}
export interface UpdateRowsResult {
    path: string;
    sheetName: string;
    tableName: string;
    rowsUpdated: number;
}
export interface RenameResult {
    path: string;
    oldName: string;
    newName: string;
    sheetName?: string;
}
//# sourceMappingURL=types.d.ts.map