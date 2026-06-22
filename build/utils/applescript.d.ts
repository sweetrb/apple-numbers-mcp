/**
 * Convert 0-based row/col indices to A1 notation (e.g., 0,0 → "A1", 2,3 → "D3").
 */
export declare function toA1(row: number, col: number): string;
/**
 * Run an AppleScript string via osascript and return stdout.
 */
export declare function runAppleScript(script: string, timeoutMs?: number): string;
export interface SetFormulaResult {
    path: string;
    sheetName: string;
    tableName: string;
    cell: string;
    formula: string;
    computedValue: string;
}
export declare function setFormula(filePath: string, sheet: string, table: string, row: number, col: number, formula: string): SetFormulaResult;
export interface SetFormulasBatchResult {
    path: string;
    sheetName: string;
    tableName: string;
    cellsSet: number;
}
export declare function setFormulasBatch(filePath: string, sheet: string, table: string, formulas: {
    row: number;
    col: number;
    formula: string;
}[]): SetFormulasBatchResult;
/** RGB color as 0-65535 per channel (AppleScript's native format). */
export interface ASColor {
    red: number;
    green: number;
    blue: number;
}
export interface CellStyle {
    fontName?: string;
    fontSize?: number;
    textColor?: ASColor;
    backgroundColor?: ASColor;
    format?: "automatic" | "number" | "currency" | "date and time" | "duration" | "fraction" | "scientific" | "numeral system" | "checkbox" | "star rating" | "text";
    alignment?: "auto align" | "left" | "center" | "right" | "justify";
    verticalAlignment?: "top" | "center" | "bottom";
    textWrap?: boolean;
}
export interface CellStyleResult {
    path: string;
    sheetName: string;
    tableName: string;
    cell: string;
}
export declare function setCellStyle(filePath: string, sheet: string, table: string, row: number, col: number, style: CellStyle): CellStyleResult;
export interface BatchStyleEntry {
    row: number;
    col: number;
    style: CellStyle;
}
export interface SetCellsStyleBatchResult {
    path: string;
    sheetName: string;
    tableName: string;
    cellsStyled: number;
}
export declare function setCellsStyleBatch(filePath: string, sheet: string, table: string, entries: BatchStyleEntry[]): SetCellsStyleBatchResult;
export interface SetDimensionResult {
    path: string;
    sheetName: string;
    tableName: string;
}
export declare function setColumnWidth(filePath: string, sheet: string, table: string, col: number, width: number): SetDimensionResult;
export declare function setRowHeight(filePath: string, sheet: string, table: string, row: number, height: number): SetDimensionResult;
export interface MergeResult {
    path: string;
    sheetName: string;
    tableName: string;
    range: string;
}
export declare function mergeCells(filePath: string, sheet: string, table: string, startRow: number, startCol: number, endRow: number, endCol: number): MergeResult;
export declare function unmergeCells(filePath: string, sheet: string, table: string, startRow: number, startCol: number, endRow: number, endCol: number): MergeResult;
export interface ReadCellStyleResult {
    fontName: string;
    fontSize: number;
    textColor: ASColor;
    backgroundColor: ASColor;
    format: string;
    alignment: string;
    verticalAlignment: string;
    textWrap: boolean;
}
export declare function getCellStyle(filePath: string, sheet: string, table: string, row: number, col: number): ReadCellStyleResult;
//# sourceMappingURL=applescript.d.ts.map