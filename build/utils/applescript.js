import { execFileSync } from "node:child_process";
/**
 * Output cap for osascript. Node's execFileSync defaults to ~1 MB, which a large
 * table read (getCellStyle round-trips, big batch operations) can blow past —
 * execFileSync then throws ENOBUFS and the failure surfaces with no useful detail.
 * 64 MB headroom, overridable via APPLE_NUMBERS_MCP_MAX_BUFFER.
 */
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
function getMaxBuffer() {
    const raw = process.env.APPLE_NUMBERS_MCP_MAX_BUFFER;
    if (raw !== undefined) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return DEFAULT_MAX_BUFFER_BYTES;
}
/**
 * Headroom (ms) between the in-AppleScript `with timeout` and the outer osascript
 * process timeout. The script-level timeout should fire first so Numbers.app
 * aborts from inside its own AppleScript dispatch before Node SIGKILLs osascript.
 * Killing osascript alone does not stop work already dispatched into Numbers.app,
 * which is what wedges it for subsequent calls.
 */
const SCRIPT_TIMEOUT_HEADROOM_MS = 5000;
/**
 * Wrap a full `tell application "Numbers" ... end tell` script in an AppleScript
 * `with timeout` block so an Apple Event that honors timeouts aborts cleanly
 * rather than holding Numbers.app's single-threaded dispatch open. The seconds
 * value is set below the process timeout so the in-app abort wins the race
 * against the outer SIGKILL.
 */
function wrapWithTimeout(script, processTimeoutMs) {
    const seconds = Math.max(1, Math.ceil((processTimeoutMs - SCRIPT_TIMEOUT_HEADROOM_MS) / 1000));
    return `with timeout of ${seconds} seconds\n${script}\nend timeout`;
}
/**
 * Convert 0-based row/col indices to A1 notation (e.g., 0,0 → "A1", 2,3 → "D3").
 */
export function toA1(row, col) {
    let letters = "";
    let c = col;
    while (true) {
        letters = String.fromCharCode(65 + (c % 26)) + letters;
        c = Math.floor(c / 26) - 1;
        if (c < 0)
            break;
    }
    return `${letters}${row + 1}`;
}
/**
 * Run an AppleScript string via osascript and return stdout.
 */
export function runAppleScript(script, timeoutMs = 60000) {
    try {
        return execFileSync("osascript", ["-e", wrapWithTimeout(script, timeoutMs)], {
            encoding: "utf-8",
            timeout: timeoutMs,
            // SIGKILL (not the default SIGTERM): a wedged osascript blocked on an
            // unresponsive Numbers.app can ignore SIGTERM and leak. SIGKILL guarantees
            // the process is reaped on timeout.
            killSignal: "SIGKILL",
            // Raise the output cap above Node's ~1 MB default so large reads aren't
            // truncated into an ENOBUFS failure.
            maxBuffer: getMaxBuffer(),
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
    }
    catch (err) {
        // osascript writes its real diagnostic to stderr; Node's default error
        // message ("Command failed: osascript ...") buries it. Surface stderr so the
        // thrown Error carries the actual AppleScript error.
        const error = err;
        const stderr = error.stderr?.toString().trim();
        if (stderr) {
            error.message = `${error.message}\n${stderr}`;
        }
        throw error;
    }
}
/**
 * Escape a string for use inside AppleScript double quotes.
 */
function escapeAS(s) {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
/**
 * Generate the AppleScript preamble that opens a document (or finds it if already open)
 * and navigates to a sheet/table. The caller provides the body commands.
 */
function buildScript(filePath, sheet, table, body, returnExpr = '"done"') {
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
export function setFormula(filePath, sheet, table, row, col, formula) {
    const cellRef = toA1(row, col);
    const body = `        set the value of cell "${cellRef}" to "${escapeAS(formula)}"
        delay 0.3
        set computedVal to the value of cell "${cellRef}"`;
    const computedValue = runAppleScript(buildScript(filePath, sheet, table, body, "(computedVal as text)"));
    return {
        path: filePath,
        sheetName: sheet,
        tableName: table,
        cell: cellRef,
        formula,
        computedValue,
    };
}
export function setFormulasBatch(filePath, sheet, table, formulas) {
    const cmds = formulas
        .map((f) => `        set the value of cell "${toA1(f.row, f.col)}" to "${escapeAS(f.formula)}"`)
        .join("\n");
    runAppleScript(buildScript(filePath, sheet, table, cmds));
    return { path: filePath, sheetName: sheet, tableName: table, cellsSet: formulas.length };
}
function colorToAS(c) {
    return `{${c.red}, ${c.green}, ${c.blue}}`;
}
function buildStyleCommands(cellRef, style) {
    const cmds = [];
    const c = `cell "${cellRef}"`;
    if (style.fontName !== undefined)
        cmds.push(`        set font name of ${c} to "${escapeAS(style.fontName)}"`);
    if (style.fontSize !== undefined)
        cmds.push(`        set font size of ${c} to ${style.fontSize}`);
    if (style.textColor !== undefined)
        cmds.push(`        set text color of ${c} to ${colorToAS(style.textColor)}`);
    if (style.backgroundColor !== undefined)
        cmds.push(`        set background color of ${c} to ${colorToAS(style.backgroundColor)}`);
    if (style.format !== undefined)
        cmds.push(`        set format of ${c} to ${style.format}`);
    if (style.alignment !== undefined)
        cmds.push(`        set alignment of ${c} to ${style.alignment}`);
    if (style.verticalAlignment !== undefined)
        cmds.push(`        set vertical alignment of ${c} to ${style.verticalAlignment}`);
    if (style.textWrap !== undefined)
        cmds.push(`        set text wrap of ${c} to ${style.textWrap}`);
    return cmds;
}
export function setCellStyle(filePath, sheet, table, row, col, style) {
    const cellRef = toA1(row, col);
    const cmds = buildStyleCommands(cellRef, style);
    if (cmds.length === 0)
        return { path: filePath, sheetName: sheet, tableName: table, cell: cellRef };
    runAppleScript(buildScript(filePath, sheet, table, cmds.join("\n")));
    return { path: filePath, sheetName: sheet, tableName: table, cell: cellRef };
}
export function setCellsStyleBatch(filePath, sheet, table, entries) {
    const allCmds = [];
    for (const entry of entries) {
        const cellRef = toA1(entry.row, entry.col);
        allCmds.push(...buildStyleCommands(cellRef, entry.style));
    }
    if (allCmds.length > 0) {
        runAppleScript(buildScript(filePath, sheet, table, allCmds.join("\n")));
    }
    return { path: filePath, sheetName: sheet, tableName: table, cellsStyled: entries.length };
}
export function setColumnWidth(filePath, sheet, table, col, width) {
    // Column letters for AppleScript
    const colLetter = toA1(0, col).replace("1", "");
    const body = `        set width of column "${colLetter}" to ${width}`;
    runAppleScript(buildScript(filePath, sheet, table, body));
    return { path: filePath, sheetName: sheet, tableName: table };
}
export function setRowHeight(filePath, sheet, table, row, height) {
    // AppleScript rows are 1-based
    const body = `        set height of row ${row + 1} to ${height}`;
    runAppleScript(buildScript(filePath, sheet, table, body));
    return { path: filePath, sheetName: sheet, tableName: table };
}
export function mergeCells(filePath, sheet, table, startRow, startCol, endRow, endCol) {
    const rangeStr = `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
    const body = `        merge range "${rangeStr}"`;
    runAppleScript(buildScript(filePath, sheet, table, body));
    return { path: filePath, sheetName: sheet, tableName: table, range: rangeStr };
}
export function unmergeCells(filePath, sheet, table, startRow, startCol, endRow, endCol) {
    const rangeStr = `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
    const body = `        unmerge range "${rangeStr}"`;
    runAppleScript(buildScript(filePath, sheet, table, body));
    return { path: filePath, sheetName: sheet, tableName: table, range: rangeStr };
}
export function getCellStyle(filePath, sheet, table, row, col) {
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
    const parseColor = (s) => {
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
//# sourceMappingURL=applescript.js.map