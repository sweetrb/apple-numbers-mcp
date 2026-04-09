import { describe, it, expect, vi, beforeEach } from "vitest";
import { NumbersManager } from "../../services/numbersManager.js";
import * as pythonUtils from "../../utils/python.js";
import type {
  NumbersFileInfo,
  TableData,
  SearchResult,
  ExportResult,
  CellValue,
  CreateResult,
  SetCellResult,
  SetCellsBatchResult,
  AddRowsResult,
  DeleteRowsResult,
  AddSheetResult,
  AddTableResult,
  ImportResult,
  UpdateRowsResult,
  RenameResult,
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
      expect(args).not.toContain("--start-row");
      expect(args).not.toContain("--end-row");
      expect(args).not.toContain("--columns");
    });

    it("should pass range parameters when provided", () => {
      mockedRunNumbersReader.mockReturnValue({
        data: {
          sheetName: "S",
          tableName: "T",
          headers: ["A"],
          rows: [[1]],
          numRows: 1,
          numCols: 1,
        },
      });

      manager.readTable("/test.numbers", undefined, undefined, {
        startRow: 2,
        endRow: 5,
        columns: ["Name", 2],
      });

      const args = mockedRunNumbersReader.mock.calls[0][1];
      expect(args).toContain("--start-row");
      expect(args).toContain("2");
      expect(args).toContain("--end-row");
      expect(args).toContain("5");
      expect(args).toContain("--columns");
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

    it("should pass --verbose flag when requested", () => {
      const mockCell: CellValue = {
        row: 0,
        col: 0,
        value: "test",
        type: "string",
        formula: null,
        isFormula: false,
        isMerged: false,
        formattedValue: "test",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockCell });

      manager.getCell("/test.numbers", "Sheet 1", "Table 1", 0, 0, true);

      const args = mockedRunNumbersReader.mock.calls[0][1];
      expect(args).toContain("--verbose");
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

  describe("createSpreadsheet", () => {
    it("should pass headers and options to Python bridge", () => {
      const mockResult: CreateResult = {
        path: "/tmp/new.numbers",
        sheetName: "Data",
        tableName: "Table 1",
        numHeaders: 3,
        numRows: 2,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.createSpreadsheet("/tmp/new.numbers", ["A", "B", "C"], {
        sheetName: "Data",
        rows: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      });

      expect(result).toEqual(mockResult);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "create",
        expect.arrayContaining(["--sheet-name", "Data", "--rows"])
      );
    });

    it("should reject non-.numbers extension", () => {
      expect(() => manager.createSpreadsheet("/tmp/data.xlsx", ["A"])).toThrow(
        "Not a Numbers file path"
      );
    });

    it("should not require the file to already exist", () => {
      mockedExistsSync.mockReturnValue(false);
      const mockResult: CreateResult = {
        path: "/tmp/new.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        numHeaders: 1,
        numRows: 0,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.createSpreadsheet("/tmp/new.numbers", ["A"]);
      expect(result).toEqual(mockResult);
    });

    it("should omit optional args when not provided", () => {
      mockedRunNumbersReader.mockReturnValue({
        data: {
          path: "/t.numbers",
          sheetName: "Sheet 1",
          tableName: "Table 1",
          numHeaders: 1,
          numRows: 0,
        },
      });

      manager.createSpreadsheet("/tmp/test.numbers", ["Col1"]);

      const args = mockedRunNumbersReader.mock.calls[0][1];
      expect(args).not.toContain("--sheet-name");
      expect(args).not.toContain("--table-name");
      expect(args).not.toContain("--rows");
    });
  });

  describe("setCell", () => {
    it("should pass row, col, value, and options", () => {
      const mockResult: SetCellResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        row: 1,
        col: 2,
        value: "hello",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.setCell("/test.numbers", 1, 2, "hello", {
        sheet: "Sheet 1",
        table: "Table 1",
        type: "string",
      });

      expect(result).toEqual(mockResult);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "set-cell",
        expect.arrayContaining([
          "1",
          "2",
          '"hello"',
          "--sheet",
          "Sheet 1",
          "--table",
          "Table 1",
          "--type",
          "string",
        ])
      );
    });

    it("should throw for non-existent file", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(() => manager.setCell("/missing.numbers", 0, 0, "x")).toThrow("File not found");
    });
  });

  describe("setCellsBatch", () => {
    it("should pass updates array to Python bridge", () => {
      const mockResult: SetCellsBatchResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        cellsWritten: 3,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const updates = [
        { row: 0, col: 0, value: "A" },
        { row: 0, col: 1, value: "B" },
        { row: 1, col: 0, value: 42 },
      ];
      const result = manager.setCellsBatch("/test.numbers", updates, { sheet: "S1" });

      expect(result.cellsWritten).toBe(3);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "set-cells",
        expect.arrayContaining([expect.stringContaining("["), "--sheet", "S1"])
      );
    });
  });

  describe("addRows", () => {
    it("should pass rows array to Python bridge", () => {
      const mockResult: AddRowsResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        rowsAdded: 2,
        startRow: 5,
        newTotalRows: 7,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const rows = [
        ["Alice", 30],
        ["Bob", 25],
      ];
      const result = manager.addRows("/test.numbers", rows, {
        sheet: "Sheet 1",
        table: "Table 1",
      });

      expect(result.rowsAdded).toBe(2);
      expect(result.startRow).toBe(5);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "add-rows",
        expect.arrayContaining(["--sheet", "Sheet 1", "--table", "Table 1"])
      );
    });

    it("should omit optional args when not provided", () => {
      mockedRunNumbersReader.mockReturnValue({
        data: {
          path: "/t.numbers",
          sheetName: "S",
          tableName: "T",
          rowsAdded: 1,
          startRow: 1,
          newTotalRows: 2,
        },
      });

      manager.addRows("/test.numbers", [["x"]]);

      const args = mockedRunNumbersReader.mock.calls[0][1];
      expect(args).not.toContain("--sheet");
      expect(args).not.toContain("--table");
    });

    it("should throw when Python bridge returns error", () => {
      mockedRunNumbersReader.mockReturnValue({ error: "Table not found" });

      expect(() => manager.addRows("/test.numbers", [["x"]])).toThrow("Table not found");
    });
  });

  describe("deleteRows", () => {
    it("should pass start and end row indices", () => {
      const mockResult: DeleteRowsResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        rowsDeleted: 3,
        newTotalRows: 5,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.deleteRows("/test.numbers", 2, 4, { sheet: "Sheet 1" });

      expect(result.rowsDeleted).toBe(3);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "delete-rows",
        expect.arrayContaining(["2", "4", "--sheet", "Sheet 1"])
      );
    });

    it("should throw when Python bridge returns error", () => {
      mockedRunNumbersReader.mockReturnValue({ error: "Row range out of bounds" });

      expect(() => manager.deleteRows("/test.numbers", 0, 100)).toThrow("Row range out of bounds");
    });
  });

  describe("addSheet", () => {
    it("should pass sheet name and options", () => {
      const mockResult: AddSheetResult = {
        path: "/test.numbers",
        sheetName: "New Sheet",
        tableName: "Data",
        numRows: 1,
        numCols: 3,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.addSheet("/test.numbers", "New Sheet", {
        tableName: "Data",
        headers: ["A", "B", "C"],
      });

      expect(result.sheetName).toBe("New Sheet");
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "add-sheet",
        expect.arrayContaining(["New Sheet", "--table-name", "Data", "--headers"])
      );
    });
  });

  describe("addTable", () => {
    it("should pass options to Python bridge", () => {
      const mockResult: AddTableResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 2",
        numRows: 1,
        numCols: 2,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.addTable("/test.numbers", {
        sheet: "Sheet 1",
        tableName: "Table 2",
        headers: ["X", "Y"],
      });

      expect(result.tableName).toBe("Table 2");
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "add-table",
        expect.arrayContaining(["--sheet", "Sheet 1", "--table-name", "Table 2", "--headers"])
      );
    });
  });

  describe("importFile", () => {
    it("should pass input and output paths", () => {
      const mockResult: ImportResult = {
        path: "/tmp/out.numbers",
        inputPath: "/tmp/data.csv",
        format: "csv",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        numHeaders: 3,
        numRows: 10,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.importFile("/tmp/data.csv", "/tmp/out.numbers", {
        format: "csv",
        sheetName: "Import",
      });

      expect(result.numRows).toBe(10);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "import",
        expect.arrayContaining(["--format", "csv", "--sheet-name", "Import"])
      );
    });

    it("should throw for non-existent input file", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(() => manager.importFile("/missing.csv", "/out.numbers")).toThrow(
        "Input file not found"
      );
    });

    it("should reject non-.numbers output path", () => {
      expect(() => manager.importFile("/data.csv", "/out.xlsx")).toThrow("Not a Numbers file path");
    });
  });

  describe("updateRows", () => {
    it("should pass updates array to Python bridge", () => {
      const mockResult: UpdateRowsResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        tableName: "Table 1",
        rowsUpdated: 2,
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const updates = [
        { row: 1, values: ["Alice", 30, "NYC"] },
        { row: 2, values: ["Bob", 25, "LA"] },
      ];
      const result = manager.updateRows("/test.numbers", updates, { sheet: "Sheet 1" });

      expect(result.rowsUpdated).toBe(2);
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "update-rows",
        expect.arrayContaining([expect.stringContaining("["), "--sheet", "Sheet 1"])
      );
    });
  });

  describe("renameSheet", () => {
    it("should pass new name and optional sheet selector", () => {
      const mockResult: RenameResult = {
        path: "/test.numbers",
        oldName: "Sheet 1",
        newName: "Data",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.renameSheet("/test.numbers", "Data", "Sheet 1");

      expect(result.oldName).toBe("Sheet 1");
      expect(result.newName).toBe("Data");
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "rename-sheet",
        expect.arrayContaining(["Data", "--sheet", "Sheet 1"])
      );
    });
  });

  describe("renameTable", () => {
    it("should pass new name and optional selectors", () => {
      const mockResult: RenameResult = {
        path: "/test.numbers",
        sheetName: "Sheet 1",
        oldName: "Table 1",
        newName: "Sales",
      };
      mockedRunNumbersReader.mockReturnValue({ data: mockResult });

      const result = manager.renameTable("/test.numbers", "Sales", {
        sheet: "Sheet 1",
        table: "Table 1",
      });

      expect(result.newName).toBe("Sales");
      expect(mockedRunNumbersReader).toHaveBeenCalledWith(
        "rename-table",
        expect.arrayContaining(["Sales", "--sheet", "Sheet 1", "--table", "Table 1"])
      );
    });
  });
});
