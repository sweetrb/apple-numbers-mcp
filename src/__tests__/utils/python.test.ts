import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";

// We need to mock child_process and fs before importing the module under test
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);

// Reset the cached python between tests by re-importing
let runNumbersReader: typeof import("../../utils/python.js").runNumbersReader;
let checkDependencies: typeof import("../../utils/python.js").checkDependencies;

describe("python.ts", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Re-mock after resetModules
    vi.doMock("node:child_process", () => ({
      execFileSync: mockedExecFileSync,
      execSync: mockedExecSync,
    }));

    vi.doMock("node:fs", () => ({
      existsSync: mockedExistsSync,
    }));

    // Default: no venv, python3 is on PATH
    mockedExistsSync.mockReturnValue(false);
    mockedExecSync.mockReturnValue(Buffer.from("Python 3.11.0"));

    const mod = await import("../../utils/python.js");
    runNumbersReader = mod.runNumbersReader;
    checkDependencies = mod.checkDependencies;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runNumbersReader", () => {
    it("should parse successful JSON output", () => {
      const mockData = { path: "/test.numbers", sheets: [] };
      mockedExecFileSync.mockReturnValue(JSON.stringify(mockData));

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.data).toEqual(mockData);
      expect(result.error).toBeUndefined();
    });

    it("should return error when Python script returns error JSON", () => {
      mockedExecFileSync.mockReturnValue(JSON.stringify({ error: "File not found" }));

      const result = runNumbersReader("info", ["/bad.numbers"]);

      expect(result.error).toBe("File not found");
      expect(result.data).toBeUndefined();
    });

    it("should handle numbers-parser not installed error from stderr", () => {
      const error = new Error("Process exited with code 1") as Error & {
        stderr: string;
        status: number;
      };
      error.stderr = "numbers-parser not installed";
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toContain("numbers-parser not installed");
    });

    it("should handle timeout errors", () => {
      const error = new Error("Command timed out");
      error.message = "ETIMEDOUT: operation timed out";
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"], 5000);

      expect(result.error).toContain("timed out");
    });

    it("should handle generic errors", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("Something unexpected");
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toBe("Something unexpected");
    });

    it("should pass correct arguments to execFileSync", () => {
      mockedExecFileSync.mockReturnValue('{"ok": true}');

      runNumbersReader("read", ["/test.numbers", "--sheet", "Sheet1"]);

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "python3",
        expect.arrayContaining(["read", "/test.numbers", "--sheet", "Sheet1"]),
        expect.objectContaining({
          encoding: "utf-8",
          timeout: 30000,
          maxBuffer: 50 * 1024 * 1024,
        })
      );
    });

    it("should use custom timeout when provided", () => {
      mockedExecFileSync.mockReturnValue('{"ok": true}');

      runNumbersReader("info", ["/test.numbers"], 10000);

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ timeout: 10000 })
      );
    });
  });

  describe("findPython", () => {
    it("should prefer venv python when it exists", async () => {
      vi.resetModules();
      const localExecFileSync = vi.fn();
      const localExecSync = vi.fn();
      const localExistsSync = vi.fn().mockReturnValue(true); // venv exists

      vi.doMock("node:child_process", () => ({
        execFileSync: localExecFileSync,
        execSync: localExecSync,
      }));

      vi.doMock("node:fs", () => ({
        existsSync: localExistsSync,
      }));

      localExecFileSync.mockReturnValue('{"ok": true}');

      const mod = await import("../../utils/python.js");
      mod.runNumbersReader("info", ["/test.numbers"]);

      // Should use the venv python, not call execSync to find system python
      expect(localExecSync).not.toHaveBeenCalled();
      expect(localExecFileSync).toHaveBeenCalledWith(
        expect.stringContaining("venv/bin/python3"),
        expect.any(Array),
        expect.any(Object)
      );
    });

    it("should fall back to python when python3 is not available", async () => {
      vi.resetModules();
      const localExecSync = vi.fn();
      const localExecFileSync = vi.fn();

      vi.doMock("node:child_process", () => ({
        execFileSync: localExecFileSync,
        execSync: localExecSync,
      }));

      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      // python3 fails, python succeeds
      localExecSync
        .mockImplementationOnce(() => {
          throw new Error("not found");
        })
        .mockReturnValueOnce(Buffer.from("Python 3.11.0"));

      localExecFileSync.mockReturnValue('{"ok": true}');

      const mod = await import("../../utils/python.js");
      mod.runNumbersReader("info", ["/test.numbers"]);

      expect(localExecFileSync).toHaveBeenCalledWith(
        "python",
        expect.any(Array),
        expect.any(Object)
      );
    });

    it("should return error when no python is found", async () => {
      vi.resetModules();
      const localExecSync = vi.fn();
      const localExecFileSync = vi.fn();

      vi.doMock("node:child_process", () => ({
        execFileSync: localExecFileSync,
        execSync: localExecSync,
      }));

      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      // Both python3 and python fail
      localExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const mod = await import("../../utils/python.js");

      // findPython throws, which runNumbersReader catches
      // The error propagates since runNumbersReader doesn't catch findPython errors
      expect(() => mod.runNumbersReader("info", ["/test.numbers"])).toThrow("Python 3 not found");
    });
  });

  describe("checkDependencies", () => {
    it("should return ok when numbers-parser is available", () => {
      // findPython's execSync (no encoding) returns Buffer;
      // checkDependencies' execSync (encoding: 'utf-8') returns string with .trim()
      mockedExecSync
        .mockReturnValueOnce(Buffer.from("Python 3.11.0")) // findPython
        .mockReturnValueOnce("4.3.0\n" as unknown as Buffer); // import check

      const result = checkDependencies();

      expect(result.ok).toBe(true);
      expect(result.message).toContain("available");
      expect(result.message).toContain("4.3.0");
    });

    it("should return not ok when numbers-parser import fails", async () => {
      vi.resetModules();
      const localExecSync = vi.fn();

      vi.doMock("node:child_process", () => ({
        execFileSync: vi.fn(),
        execSync: localExecSync,
      }));

      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      // First call (findPython) succeeds, second call (import check) fails
      localExecSync.mockReturnValueOnce(Buffer.from("Python 3.11.0")).mockImplementationOnce(() => {
        throw new Error("ModuleNotFoundError");
      });

      const mod = await import("../../utils/python.js");
      const result = mod.checkDependencies();

      expect(result.ok).toBe(false);
      expect(result.message).toContain("numbers-parser not installed");
    });
  });
});
