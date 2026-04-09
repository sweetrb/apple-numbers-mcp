import { describe, it, expect, vi, beforeEach } from "vitest";
import { NumbersManager } from "../../services/numbersManager.js";
import * as pythonUtils from "../../utils/python.js";
import type {
  NumbersFileInfo,
  TableData,
  SearchResult,
  ExportResult,
  CellValue,
} from "../../types.js";
import { existsSync } from "node:fs";

// Mock the python utility module
vi.mock("../../utils/python.js", () => ({
  runNumbersReader: vi.fn(),
  checkDependencies: vi.fn(),
}));

// Mock fs.existsSync
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

const mockedRunNumbersReader = vi.mocked(pythonUtils.runNumbersReader);
const mockedCheckDeps = vi.mocked(pythonUtils.checkDependencies);
const mockedExistsSync = vi.mocked(existsSync);

describe("NumbersManager", () => {
  let manager: NumbersManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new NumbersManager();
    // Default: file exists
    mockedExistsSync.mockReturnValue(true);
  });

  describe("validatePath", () => {
    it("should throw for non-existent files", () => {
      mockedExistsSync.mockReturnValue(false);

      expect(() => manager.getFileInfo("/missing.numbers")).toThrow("File not found");
    });

    it("should throw for non-.numbers files", () => {
      expect(() => manager.getFileInfo("/data.xlsx")).toThrow("Not a Numbers file");
    });

    it("should expand ~ to home directory", () => {
      const mockInfo: NumbersFileInfo = {
        path: "/Users/test/test.numbers",
        sheets: [],
        defaultSheet: "",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockInfo });

      manager.getFileInfo("~/test.numbers");

      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "info",
        expect.arrayContaining([expect.stringContaining("test.numbers")])
      );
      // Verify ~ was expanded (not passed literally)
      const passedPath = mockedRunNumbersReader.mock.calls[0][1][0];
      expect(passedPath).not.toContain("~");
    });

    it("should accept valid .numbers files", () => {
      const mockInfo: NumbersFileInfo = {
        path: "/test.numbers",
        sheets: [],
        defaultSheet: "",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockInfo });

      const result = manager.getFileInfo("/test.numbers");

      expect(result).toEqual(mockInfo);
    });
  });

  describe("getFileInfo", () => {
    it("should return file info from Python bridge", () => {
      const mockInfo: NumbersFileInfo = {
        path: "/test.numbers",
        sheets: [
          {
            name: "Sheet 1",
            tables: [
              {
                name: "Table 1",
                sheetName: "Sheet 1",
                numRows: 5,
                numCols: 3,
                headerRow: ["Name", "Age", "City"],
              },
            ],
          },
        ],
        defaultSheet: "Sheet 1",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockInfo });

      const result = manager.getFileInfo("/test.numbers");

      expect(result).toEqual(mockInfo);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith("info", expect.any(Array));
    });

    it("should throw when Python bridge returns error", () => {
      mockedRunNumbersReader.mockReturnValue({
        error: "Failed to parse file",
      });

      expect(() => manager.getFileInfo("/test.numbers")).toThrow("Failed to parse file");
    });
  });

  describe("readTable", () => {
    it("should pass sheet and table args when provided", () => {
      const mockData: TableData = {
        sheetName: "Revenue",
        tableName: "Q1",
        headers: ["Month", "Amount"],
        rows: [
          ["Jan", 1000],
          ["Feb", 2000],
        ],
        numRows: 2,
        numCols: 2,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockData });

      const result = manager.readTable("/test.numbers", "Revenue", "Q1");

      expect(result).toEqual(mockData);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "read",
        expect.arrayContaining(["--sheet", "Revenue", "--table", "Q1"])
      );
    });

    it("should omit optional args when not provided", () => {
      const mockData: TableData = {
        sheetName: "Sheet 1",
        tableName: "Table 1",
        headers: ["A"],
        rows: [[1]],
        numRows: 1,
        numCols: 1,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockData });

      manager.readTable("/test.numbers");

      const args = mockedRunNumbersReader.mock.calls[0][1];
      expect(args).not.toContain("--sheet");
      expect(args).not.toContain("--table");
    });
  });

  describe("search", () => {
    it("should pass query and optional sheet", () => {
      const mockResult = {
        results: [
          {
            sheetName: "Sheet 1",
            tableName: "Table 1",
            row: 1,
            col: 0,
            header: "Name",
            value: "Alice",
          },
        ] as SearchResult[],
        count: 1,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.search("/test.numbers", "Alice", "Sheet 1");

      expect(result.count).toBe(1);
      expect(result.results[0].value).toBe("Alice");
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "search",
        expect.arrayContaining(["Alice", "--sheet", "Sheet 1"])
      );
    });

    it("should search without sheet filter", () => {
      mockedRunNumbersReader.mockReturnValue({
        data: { results: [], count: 0 },
      });

      manager.search("/test.numbers", "missing");

      const args = mockedRunNumbersReader.mock.calls[0][1];
      expect(args).not.toContain("--sheet");
    });
  });

  describe("exportTable", () => {
    it("should pass format and output path", () => {
      const mockResult: ExportResult = {
        outputPath: "/tmp/output.csv",
        format: "csv",
        rowCount: 10,
        sheetName: "Sheet 1",
        tableName: "Table 1",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.exportTable("/test.numbers", "csv", "/tmp/output.csv");

      expect(result.format).toBe("csv");
      expect(result.rowCount).toBe(10);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "export",
        expect.arrayContaining(["csv"])
      );
    });

    it("should expand ~ in output path", () => {
      mockedRunNumbersReader.mockReturnValue({
        data: {
          outputPath: "/Users/test/out.json",
          format: "json",
          rowCount: 5,
          sheetName: "S",
          tableName: "T",
        },
      });

      manager.exportTable("/test.numbers", "json", "~/out.json");

      const args = mockedRunNumbersReader.mock.calls[0][1];
      // The output path arg should not contain ~
      const outputArg = args[2];
      expect(outputArg).not.toContain("~");
    });
  });

  describe("getCell", () => {
    it("should pass all arguments correctly", () => {
      const mockCell: CellValue = {
        row: 2,
        col: 1,
        value: 42,
        type: "number",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockCell });

      const result = manager.getCell("/test.numbers", "Sheet 1", "Table 1", 2, 1);

      expect(result.value).toBe(42);
      expect(result.type).toBe("number");
      expect(mockedRunNumbersReader).toHaveBeenCalledWith("cell", [
        expect.any(String),
        "Sheet 1",
        "Table 1",
        "2",
        "1",
      ]);
    });
  });

  describe("healthCheck", () => {
    it("should delegate to checkDependencies", () => {
      mockedCheckDeps.mockReturnValue({
        ok: true,
        message: "All dependencies available",
      });

      const result = manager.healthCheck();

      expect(result.ok).toBe(true);
      expect(mockedCheckDeps).toHaveBeenCalled();
    });
  });
});
