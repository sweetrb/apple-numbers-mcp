import { execFileSync } from "node:child_process";

/**
 * Convert 0-based row/col indices to A1 notation (e.g., 0,0 → "A1", 2,3 → "D3").
 */
export function toA1(row: number, col: number): string {
  let letters = "";
  let c = col;
  while (true) {
    letters = String.fromCharCode(65 + (c % 26)) + letters;
    c = Math.floor(c / 26) - 1;
    if (c < 0) break;
  }
  return `${letters}${row + 1}`;
}

/**
 * Run an AppleScript string via osascript and return stdout.
 */
export function runAppleScript(script: string, timeoutMs = 60000): string {
  return execFileSync("osascript", ["-e", script], {
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Escape a string for use inside AppleScript double quotes.
 */
function escapeAS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Generate the AppleScript preamble that opens a document (or finds it if already open)
 * and navigates to a sheet/table. The caller provides the body commands.
 */
function buildScript(
  filePath: string,
  sheet: string,
  table: string,
  body: string,
  returnExpr = '"done"'
): string {
  return `
tell application "Numbers"
  set docFound to false
  repeat with d in documents
    set dPath to POSIX path of (file of d as text)
    if dPath is "${escapeAS(filePath)}" then
      set docFound to true
      set targetDoc to d
      exit repeat
    end if
  end repeat
  if not docFound then
    set targetDoc to open POSIX file "${escapeAS(filePath)}"
    delay 1
  end if
  tell targetDoc
    tell sheet "${escapeAS(sheet)}"
      tell table "${escapeAS(table)}"
${body}
      end tell
    end tell
    save
  end tell
  return ${returnExpr}
end tell`;
}

// --- Formula support ---

export interface SetFormulaResult {
  path: string;
  sheetName: string;
  tableName: string;
  cell: string;
  formula: string;
  computedValue: string;
}

export function setFormula(
  filePath: string,
  sheet: string,
  table: string,
  row: number,
  col: number,
  formula: string
): SetFormulaResult {
  const cellRef = toA1(row, col);
  const body = `        set the value of cell "${cellRef}" to "${escapeAS(formula)}"
        delay 0.3
        set computedVal to the value of cell "${cellRef}"`;
  const computedValue = runAppleScript(
    buildScript(filePath, sheet, table, body, "(computedVal as text)")
  );
  return {
    path: filePath,
    sheetName: sheet,
    tableName: table,
    cell: cellRef,
    formula,
    computedValue,
  };
}

export interface SetFormulasBatchResult {
  path: string;
  sheetName: string;
  tableName: string;
  cellsSet: number;
}

export function setFormulasBatch(
  filePath: string,
  sheet: string,
  table: string,
  formulas: { row: number; col: number; formula: string }[]
): SetFormulasBatchResult {
  const cmds = formulas
    .map((f) => `        set the value of cell "${toA1(f.row, f.col)}" to "${escapeAS(f.formula)}"`)
    .join("\n");
  runAppleScript(buildScript(filePath, sheet, table, cmds));
  return { path: filePath, sheetName: sheet, tableName: table, cellsSet: formulas.length };
}

// --- Cell style support ---

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
  format?:
    | "automatic"
    | "number"
    | "currency"
    | "date and time"
    | "duration"
    | "fraction"
    | "scientific"
    | "numeral system"
    | "checkbox"
    | "star rating"
    | "text";
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

function colorToAS(c: ASColor): string {
  return `{${c.red}, ${c.green}, ${c.blue}}`;
}

function buildStyleCommands(cellRef: string, style: CellStyle): string[] {
  const cmds: string[] = [];
  const c = `cell "${cellRef}"`;
  if (style.fontName !== undefined)
    cmds.push(`        set font name of ${c} to "${escapeAS(style.fontName)}"`);
  if (style.fontSize !== undefined) cmds.push(`        set font size of ${c} to ${style.fontSize}`);
  if (style.textColor !== undefined)
    cmds.push(`        set text color of ${c} to ${colorToAS(style.textColor)}`);
  if (style.backgroundColor !== undefined)
    cmds.push(`        set background color of ${c} to ${colorToAS(style.backgroundColor)}`);
  if (style.format !== undefined) cmds.push(`        set format of ${c} to ${style.format}`);
  if (style.alignment !== undefined)
    cmds.push(`        set alignment of ${c} to ${style.alignment}`);
  if (style.verticalAlignment !== undefined)
    cmds.push(`        set vertical alignment of ${c} to ${style.verticalAlignment}`);
  if (style.textWrap !== undefined) cmds.push(`        set text wrap of ${c} to ${style.textWrap}`);
  return cmds;
}

export function setCellStyle(
  filePath: string,
  sheet: string,
  table: string,
  row: number,
  col: number,
  style: CellStyle
): CellStyleResult {
  const cellRef = toA1(row, col);
  const cmds = buildStyleCommands(cellRef, style);
  if (cmds.length === 0)
    return { path: filePath, sheetName: sheet, tableName: table, cell: cellRef };
  runAppleScript(buildScript(filePath, sheet, table, cmds.join("\n")));
  return { path: filePath, sheetName: sheet, tableName: table, cell: cellRef };
}

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

export function setCellsStyleBatch(
  filePath: string,
  sheet: string,
  table: string,
  entries: BatchStyleEntry[]
): SetCellsStyleBatchResult {
  const allCmds: string[] = [];
  for (const entry of entries) {
    const cellRef = toA1(entry.row, entry.col);
    allCmds.push(...buildStyleCommands(cellRef, entry.style));
  }
  if (allCmds.length > 0) {
    runAppleScript(buildScript(filePath, sheet, table, allCmds.join("\n")));
  }
  return { path: filePath, sheetName: sheet, tableName: table, cellsStyled: entries.length };
}

// --- Column width / row height ---

export interface SetDimensionResult {
  path: string;
  sheetName: string;
  tableName: string;
}

export function setColumnWidth(
  filePath: string,
  sheet: string,
  table: string,
  col: number,
  width: number
): SetDimensionResult {
  // Column letters for AppleScript
  const colLetter = toA1(0, col).replace("1", "");
  const body = `        set width of column "${colLetter}" to ${width}`;
  runAppleScript(buildScript(filePath, sheet, table, body));
  return { path: filePath, sheetName: sheet, tableName: table };
}

export function setRowHeight(
  filePath: string,
  sheet: string,
  table: string,
  row: number,
  height: number
): SetDimensionResult {
  // AppleScript rows are 1-based
  const body = `        set height of row ${row + 1} to ${height}`;
  runAppleScript(buildScript(filePath, sheet, table, body));
  return { path: filePath, sheetName: sheet, tableName: table };
}

// --- Merge/unmerge ---

export interface MergeResult {
  path: string;
  sheetName: string;
  tableName: string;
  range: string;
}

export function mergeCells(
  filePath: string,
  sheet: string,
  table: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): MergeResult {
  const rangeStr = `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
  const body = `        merge range "${rangeStr}"`;
  runAppleScript(buildScript(filePath, sheet, table, body));
  return { path: filePath, sheetName: sheet, tableName: table, range: rangeStr };
}

export function unmergeCells(
  filePath: string,
  sheet: string,
  table: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): MergeResult {
  const rangeStr = `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
  const body = `        unmerge range "${rangeStr}"`;
  runAppleScript(buildScript(filePath, sheet, table, body));
  return { path: filePath, sheetName: sheet, tableName: table, range: rangeStr };
}

// --- Read cell style (for round-trip testing) ---

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

export function getCellStyle(
  filePath: string,
  sheet: string,
  table: string,
  row: number,
  col: number
): ReadCellStyleResult {
  const cellRef = toA1(row, col);
  const body = `        set c to cell "${cellRef}"
        set fn to font name of c
        if fn is missing value then set fn to ""
        set fs to font size of c
        set tc to text color of c
        if tc is missing value then
          set tcStr to "0,0,0"
        else
          set tcStr to (item 1 of tc) & "," & (item 2 of tc) & "," & (item 3 of tc)
        end if
        set bg to background color of c
        if bg is missing value then
          set bgStr to "65535,65535,65535"
        else
          set bgStr to (item 1 of bg) & "," & (item 2 of bg) & "," & (item 3 of bg)
        end if
        set fmt to format of c
        set al to alignment of c
        set va to vertical alignment of c
        set tw to text wrap of c`;
  const returnExpr = `fn & "|" & fs & "|" & tcStr & "|" & bgStr & "|" & fmt & "|" & al & "|" & va & "|" & tw`;

  const raw = runAppleScript(buildScript(filePath, sheet, table, body, returnExpr));
  const parts = raw.split("|");

  const parseColor = (s: string): ASColor => {
    const [r, g, b] = s.split(",").map(Number);
    return { red: r, green: g, blue: b };
  };

  return {
    fontName: parts[0],
    fontSize: parseFloat(parts[1]),
    textColor: parseColor(parts[2]),
    backgroundColor: parseColor(parts[3]),
    format: parts[4],
    alignment: parts[5],
    verticalAlignment: parts[6],
    textWrap: parts[7] === "true",
  };
}
