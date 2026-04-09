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
export function runAppleScript(script: string, timeoutMs = 30000): string {
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

export interface SetFormulaResult {
  path: string;
  sheetName: string;
  tableName: string;
  cell: string;
  formula: string;
  computedValue: string;
}

/**
 * Set a formula on a cell in a .numbers file using AppleScript.
 * Requires Numbers.app to be running. Opens the file if not already open.
 */
export function setFormula(
  filePath: string,
  sheet: string,
  table: string,
  row: number,
  col: number,
  formula: string
): SetFormulaResult {
  const cellRef = toA1(row, col);
  const escapedPath = escapeAS(filePath);
  const escapedSheet = escapeAS(sheet);
  const escapedTable = escapeAS(table);
  const escapedFormula = escapeAS(formula);

  const script = `
tell application "Numbers"
  set docFound to false
  -- Check if file is already open
  repeat with d in documents
    set dPath to POSIX path of (file of d as text)
    if dPath is "${escapedPath}" then
      set docFound to true
      set targetDoc to d
      exit repeat
    end if
  end repeat
  if not docFound then
    set targetDoc to open POSIX file "${escapedPath}"
    delay 1
  end if
  tell targetDoc
    tell sheet "${escapedSheet}"
      tell table "${escapedTable}"
        set the value of cell "${cellRef}" to "${escapedFormula}"
        delay 0.3
        set computedVal to the value of cell "${cellRef}"
      end tell
    end tell
    save
  end tell
  return (computedVal as text)
end tell`;

  const computedValue = runAppleScript(script);

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

/**
 * Set formulas on multiple cells in one AppleScript execution.
 */
export function setFormulasBatch(
  filePath: string,
  sheet: string,
  table: string,
  formulas: { row: number; col: number; formula: string }[]
): SetFormulasBatchResult {
  const escapedPath = escapeAS(filePath);
  const escapedSheet = escapeAS(sheet);
  const escapedTable = escapeAS(table);

  const setCmds = formulas
    .map((f) => {
      const cellRef = toA1(f.row, f.col);
      return `        set the value of cell "${cellRef}" to "${escapeAS(f.formula)}"`;
    })
    .join("\n");

  const script = `
tell application "Numbers"
  set docFound to false
  repeat with d in documents
    set dPath to POSIX path of (file of d as text)
    if dPath is "${escapedPath}" then
      set docFound to true
      set targetDoc to d
      exit repeat
    end if
  end repeat
  if not docFound then
    set targetDoc to open POSIX file "${escapedPath}"
    delay 1
  end if
  tell targetDoc
    tell sheet "${escapedSheet}"
      tell table "${escapedTable}"
${setCmds}
      end tell
    end tell
    save
  end tell
  return "${formulas.length}"
end tell`;

  runAppleScript(script);

  return {
    path: filePath,
    sheetName: sheet,
    tableName: table,
    cellsSet: formulas.length,
  };
}
