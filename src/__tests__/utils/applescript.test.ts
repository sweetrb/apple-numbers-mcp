import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  runAppleScript,
  toA1,
  setFormula,
  setFormulasBatch,
  setCellStyle,
  setCellsStyleBatch,
  setColumnWidth,
  setRowHeight,
  mergeCells,
  unmergeCells,
  getCellStyle,
} from "../../utils/applescript.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe("runAppleScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed stdout on success", () => {
    mockedExecFileSync.mockReturnValue("  done\n" as unknown as Buffer);
    expect(runAppleScript('tell application "Numbers"\nreturn "done"\nend tell')).toBe("done");
  });

  it("wraps the script in a `with timeout` block and runs osascript", () => {
    mockedExecFileSync.mockReturnValue("ok" as unknown as Buffer);
    const body = 'tell application "Numbers"\nreturn "x"\nend tell';
    runAppleScript(body);

    const [cmd, args] = mockedExecFileSync.mock.calls[0];
    expect(cmd).toBe("osascript");
    expect(args).toContain("-e");
    const script = (args as string[]).find((a) => a.includes("with timeout"));
    expect(script).toBeDefined();
    expect(script).toContain("with timeout");
    expect(script).toContain("end timeout");
    // The original script body is preserved inside the wrapper.
    expect(script).toContain(body);
  });

  it("uses SIGKILL and a large maxBuffer in the execFileSync options", () => {
    mockedExecFileSync.mockReturnValue("ok" as unknown as Buffer);
    runAppleScript("noop");

    const options = mockedExecFileSync.mock.calls[0][2] as {
      killSignal?: string;
      maxBuffer?: number;
      timeout?: number;
    };
    expect(options.killSignal).toBe("SIGKILL");
    expect(typeof options.maxBuffer).toBe("number");
    expect(options.maxBuffer).toBeGreaterThan(1024 * 1024);
  });

  it("passes the provided timeout through to execFileSync", () => {
    mockedExecFileSync.mockReturnValue("ok" as unknown as Buffer);
    runAppleScript("noop", 12000);

    const options = mockedExecFileSync.mock.calls[0][2] as { timeout?: number };
    expect(options.timeout).toBe(12000);
  });

  it("includes the osascript stderr in the thrown error message", () => {
    const err = new Error("Command failed: osascript") as Error & { stderr?: string };
    err.stderr = "Numbers got an error: AppleEvent timed out.";
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });

    expect(() => runAppleScript("noop")).toThrow("AppleEvent timed out");
  });

  it("rethrows the original error when there is no stderr", () => {
    const err = new Error("boom");
    mockedExecFileSync.mockImplementation(() => {
      throw err;
    });
    expect(() => runAppleScript("noop")).toThrow("boom");
  });
});

describe("toA1", () => {
  it("maps 0-based columns to spreadsheet letters", () => {
    expect(toA1(0, 0)).toBe("A1");
    expect(toA1(0, 25)).toBe("Z1");
    expect(toA1(0, 26)).toBe("AA1");
    expect(toA1(0, 27)).toBe("AB1");
    expect(toA1(0, 51)).toBe("AZ1");
    expect(toA1(0, 52)).toBe("BA1");
    expect(toA1(0, 701)).toBe("ZZ1");
    expect(toA1(0, 702)).toBe("AAA1");
  });

  it("appends a 1-based row number as the suffix", () => {
    // The code returns `${letters}${row + 1}`, so row is offset by 1.
    expect(toA1(0, 3)).toBe("D1");
    expect(toA1(2, 3)).toBe("D3");
    expect(toA1(9, 0)).toBe("A10");
    expect(toA1(99, 1)).toBe("B100");
  });
});

// --- AppleScript write-path builders ------------------------------------
//
// Each builder constructs an osascript script and delegates to runAppleScript
// (which calls execFileSync). We mock execFileSync to return canned output and
// assert (a) the returned result shape and (b) that the generated script
// contains the load-bearing fragments (A1 ref, sheet/table names, the value).

const mockedExec = vi.mocked(execFileSync);

/** The osascript script text passed to the most recent execFileSync call. */
function lastScript(): string {
  const calls = mockedExec.mock.calls;
  const args = calls[calls.length - 1][1] as string[];
  return args.find((a) => a.includes("with timeout")) ?? "";
}

describe("setFormula", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the formula, returns the computed value parsed from osascript", () => {
    mockedExec.mockReturnValue("42\n" as unknown as Buffer);
    const res = setFormula("/tmp/book.numbers", "Sheet 1", "Table 1", 2, 3, "=SUM(A1:A2)");

    expect(res).toEqual({
      path: "/tmp/book.numbers",
      sheetName: "Sheet 1",
      tableName: "Table 1",
      cell: "D3",
      formula: "=SUM(A1:A2)",
      computedValue: "42",
    });

    const script = lastScript();
    expect(script).toContain('cell "D3"');
    expect(script).toContain('sheet "Sheet 1"');
    expect(script).toContain('tell table "Table 1"');
    expect(script).toContain("=SUM(A1:A2)");
    expect(script).toContain("(computedVal as text)");
  });
});

describe("setFormulasBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits one set command per formula and reports the count", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setFormulasBatch("/tmp/book.numbers", "S", "T", [
      { row: 0, col: 0, formula: "=1+1" },
      { row: 1, col: 1, formula: "=2+2" },
    ]);

    expect(res).toEqual({
      path: "/tmp/book.numbers",
      sheetName: "S",
      tableName: "T",
      cellsSet: 2,
    });

    const script = lastScript();
    expect(script).toContain('cell "A1"');
    expect(script).toContain('cell "B2"');
    expect(script).toContain("=1+1");
    expect(script).toContain("=2+2");
  });
});

describe("setCellStyle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds style commands for every provided property", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setCellStyle("/tmp/b.numbers", "S", "T", 0, 0, {
      fontName: "Helvetica",
      fontSize: 14,
      textColor: { red: 65535, green: 0, blue: 0 },
      backgroundColor: { red: 0, green: 0, blue: 65535 },
      format: "currency",
      alignment: "center",
      verticalAlignment: "top",
      textWrap: true,
    });

    expect(res).toEqual({
      path: "/tmp/b.numbers",
      sheetName: "S",
      tableName: "T",
      cell: "A1",
    });

    const script = lastScript();
    expect(script).toContain('set font name of cell "A1" to "Helvetica"');
    expect(script).toContain('set font size of cell "A1" to 14');
    expect(script).toContain('set text color of cell "A1" to {65535, 0, 0}');
    expect(script).toContain('set background color of cell "A1" to {0, 0, 65535}');
    expect(script).toContain('set format of cell "A1" to currency');
    expect(script).toContain('set alignment of cell "A1" to center');
    expect(script).toContain('set vertical alignment of cell "A1" to top');
    expect(script).toContain('set text wrap of cell "A1" to true');
  });

  it("does not invoke osascript when the style is empty", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setCellStyle("/tmp/b.numbers", "S", "T", 1, 1, {});

    expect(res.cell).toBe("B2");
    expect(mockedExec).not.toHaveBeenCalled();
  });
});

describe("setCellsStyleBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accumulates style commands across entries and counts them", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setCellsStyleBatch("/tmp/b.numbers", "S", "T", [
      { row: 0, col: 0, style: { fontSize: 10 } },
      { row: 1, col: 0, style: { fontSize: 12 } },
    ]);

    expect(res).toEqual({
      path: "/tmp/b.numbers",
      sheetName: "S",
      tableName: "T",
      cellsStyled: 2,
    });

    const script = lastScript();
    expect(script).toContain('set font size of cell "A1" to 10');
    expect(script).toContain('set font size of cell "A2" to 12');
  });

  it("skips osascript when no entries yield commands", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setCellsStyleBatch("/tmp/b.numbers", "S", "T", [{ row: 0, col: 0, style: {} }]);

    expect(res.cellsStyled).toBe(1);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});

describe("setColumnWidth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("targets the column letter and width", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setColumnWidth("/tmp/b.numbers", "S", "T", 2, 120);

    expect(res).toEqual({ path: "/tmp/b.numbers", sheetName: "S", tableName: "T" });
    const script = lastScript();
    expect(script).toContain('set width of column "C" to 120');
  });
});

describe("setRowHeight", () => {
  beforeEach(() => vi.clearAllMocks());

  it("targets the 1-based row and height", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = setRowHeight("/tmp/b.numbers", "S", "T", 4, 30);

    expect(res).toEqual({ path: "/tmp/b.numbers", sheetName: "S", tableName: "T" });
    const script = lastScript();
    expect(script).toContain("set height of row 5 to 30");
  });
});

describe("mergeCells", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges the A1 range", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = mergeCells("/tmp/b.numbers", "S", "T", 0, 0, 1, 2);

    expect(res).toEqual({
      path: "/tmp/b.numbers",
      sheetName: "S",
      tableName: "T",
      range: "A1:C2",
    });
    expect(lastScript()).toContain('merge range "A1:C2"');
  });
});

describe("unmergeCells", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unmerges the A1 range", () => {
    mockedExec.mockReturnValue("done" as unknown as Buffer);
    const res = unmergeCells("/tmp/b.numbers", "S", "T", 0, 0, 1, 2);

    expect(res).toEqual({
      path: "/tmp/b.numbers",
      sheetName: "S",
      tableName: "T",
      range: "A1:C2",
    });
    expect(lastScript()).toContain('unmerge range "A1:C2"');
  });
});

describe("getCellStyle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses the pipe-delimited round-trip output into a style object", () => {
    // fn | fs | tcStr | bgStr | fmt | al | va | tw
    mockedExec.mockReturnValue(
      "Helvetica|14.0|65535,0,0|0,0,65535|currency|center|top|true" as unknown as Buffer
    );
    const res = getCellStyle("/tmp/b.numbers", "S", "T", 0, 0);

    expect(res).toEqual({
      fontName: "Helvetica",
      fontSize: 14,
      textColor: { red: 65535, green: 0, blue: 0 },
      backgroundColor: { red: 0, green: 0, blue: 65535 },
      format: "currency",
      alignment: "center",
      verticalAlignment: "top",
      textWrap: true,
    });

    const script = lastScript();
    expect(script).toContain('set c to cell "A1"');
    expect(script).toContain("font name of c");
  });

  it("treats a non-'true' textWrap token as false", () => {
    mockedExec.mockReturnValue(
      "Arial|11|0,0,0|65535,65535,65535|automatic|left|bottom|false" as unknown as Buffer
    );
    const res = getCellStyle("/tmp/b.numbers", "S", "T", 1, 1);

    expect(res.textWrap).toBe(false);
    expect(res.fontName).toBe("Arial");
    expect(res.format).toBe("automatic");
  });
});
