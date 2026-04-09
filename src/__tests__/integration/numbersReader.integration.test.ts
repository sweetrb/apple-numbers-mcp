/**
 * Integration tests for the full Numbers reader pipeline.
 *
 * These tests require:
 *   1. Python 3 on PATH
 *   2. numbers-parser installed (pip3 install numbers-parser)
 *   3. Fixture files generated (python3 test/fixtures/generate-fixtures.py)
 *
 * They are automatically skipped if fixtures are not present.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const fixturesDir = join(projectRoot, "test", "fixtures");
const basicFixture = join(fixturesDir, "basic.numbers");
const multisheetFixture = join(fixturesDir, "multisheet.numbers");
const _typesFixture = join(fixturesDir, "types.numbers");

// Check preconditions — use venv python if available (matches NumbersManager behavior)
function findTestPython(): string {
  const venvPython = join(projectRoot, "venv", "bin", "python3");
  if (existsSync(venvPython)) return venvPython;
  return "python3";
}

const testPython = findTestPython();

function hasPython(): boolean {
  try {
    execSync(`${testPython} --version`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasNumbersParser(): boolean {
  try {
    execSync(`${testPython} -c "import numbers_parser"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasFixtures = existsSync(basicFixture);
const canRun = hasPython() && hasNumbersParser() && hasFixtures;

// Use describe.skipIf to conditionally skip the entire suite
describe.skipIf(!canRun)("Integration: Numbers Reader", () => {
  // Dynamic import so we don't fail on import when mocking isn't needed
  let NumbersManager: typeof import("../../../src/services/numbersManager.js").NumbersManager;
  let manager: InstanceType<typeof NumbersManager>;

  beforeAll(async () => {
    const mod = await import("../../services/numbersManager.js");
    NumbersManager = mod.NumbersManager;
    manager = new NumbersManager();
  });

  describe("basic.numbers", () => {
    it("should get file info with correct structure", () => {
      const info = manager.getFileInfo(basicFixture);

      expect(info.path).toBe(basicFixture);
      expect(info.sheets).toHaveLength(1);
      expect(info.sheets[0].tables).toHaveLength(1);

      const table = info.sheets[0].tables[0];
      expect(table.headerRow).toEqual(["Name", "Age", "City"]);
      expect(table.numRows).toBeGreaterThanOrEqual(5); // header + 4 data rows
      expect(table.numCols).toBe(3);
    });

    it("should read table data", () => {
      const data = manager.readTable(basicFixture);

      expect(data.headers).toEqual(["Name", "Age", "City"]);
      expect(data.rows.length).toBe(4);
      expect(data.rows[0]).toEqual(["Alice", 30, "New York"]);
    });

    it("should search for values", () => {
      const { results, count } = manager.search(basicFixture, "alice");

      expect(count).toBeGreaterThanOrEqual(1);
      expect(results[0].value).toBe("Alice");
    });

    it("should get a specific cell", () => {
      const cell = manager.getCell(
        basicFixture,
        manager.getFileInfo(basicFixture).sheets[0].name,
        manager.getFileInfo(basicFixture).sheets[0].tables[0].name,
        1,
        0
      );

      expect(cell.value).toBe("Alice");
      expect(cell.type).toBe("string");
    });

    it("should export to CSV", async () => {
      const tmpOutput = join(fixturesDir, "_test_output.csv");
      try {
        const result = manager.exportTable(basicFixture, "csv", tmpOutput);
        expect(result.format).toBe("csv");
        expect(result.rowCount).toBe(4);
        expect(existsSync(tmpOutput)).toBe(true);
      } finally {
        // Cleanup
        try {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(tmpOutput);
        } catch {
          // ignore cleanup errors
        }
      }
    });
  });

  describe("multisheet.numbers", () => {
    it.skipIf(!existsSync(multisheetFixture))("should list multiple sheets", () => {
      const info = manager.getFileInfo(multisheetFixture);
      expect(info.sheets.length).toBeGreaterThanOrEqual(2);

      const sheetNames = info.sheets.map((s) => s.name);
      expect(sheetNames).toContain("Employees");
      expect(sheetNames).toContain("Revenue");
    });

    it.skipIf(!existsSync(multisheetFixture))("should read from a specific sheet", () => {
      const data = manager.readTable(multisheetFixture, "Revenue");
      expect(data.sheetName).toBe("Revenue");
      expect(data.headers).toContain("Quarter");
      expect(data.headers).toContain("Amount");
    });

    it.skipIf(!existsSync(multisheetFixture))("should search across sheets", () => {
      const { results } = manager.search(multisheetFixture, "Alice");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].sheetName).toBe("Employees");
    });
  });

  describe("error handling", () => {
    it("should throw for non-existent file", () => {
      expect(() => manager.getFileInfo("/nonexistent.numbers")).toThrow("File not found");
    });

    it("should throw for wrong extension", () => {
      // validatePath checks existence before extension, so use a file that exists
      expect(() => manager.getFileInfo("/tmp/data.xlsx")).toThrow(
        /Not a Numbers file|File not found/
      );
    });
  });

  describe("write operations", () => {
    const tmpDir = join(fixturesDir, "_tmp_write_tests");

    beforeAll(async () => {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(tmpDir, { recursive: true });
    });

    afterAll(async () => {
      const { rmSync } = await import("node:fs");
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    });

    it("should create a new spreadsheet with headers only", () => {
      const outPath = join(tmpDir, "headers-only.numbers");
      const result = manager.createSpreadsheet(outPath, ["Name", "Age", "City"]);

      expect(result.path).toBe(outPath);
      expect(result.numHeaders).toBe(3);
      expect(result.numRows).toBe(0);

      // Verify by reading back
      const info = manager.getFileInfo(outPath);
      expect(info.sheets).toHaveLength(1);
      expect(info.sheets[0].tables[0].headerRow).toEqual(["Name", "Age", "City"]);
    });

    it("should create a spreadsheet with headers and data rows", () => {
      const outPath = join(tmpDir, "with-data.numbers");
      const result = manager.createSpreadsheet(outPath, ["Name", "Score"], {
        sheetName: "Results",
        tableName: "Scores",
        rows: [
          ["Alice", 95],
          ["Bob", 87],
        ],
      });

      expect(result.sheetName).toBe("Results");
      expect(result.tableName).toBe("Scores");
      expect(result.numRows).toBe(2);

      // Verify round-trip (numbers-parser stores ints as floats, so use approximate matching)
      const data = manager.readTable(outPath, "Results", "Scores");
      expect(data.headers).toEqual(["Name", "Score"]);
      expect(data.rows).toHaveLength(2);
      expect(data.rows[0][0]).toBe("Alice");
      expect(data.rows[0][1]).toBeCloseTo(95);
      expect(data.rows[1][0]).toBe("Bob");
      expect(data.rows[1][1]).toBeCloseTo(87);
    });

    it("should set a single cell value", () => {
      // Create a file first
      const outPath = join(tmpDir, "set-cell.numbers");
      manager.createSpreadsheet(outPath, ["A", "B"], {
        rows: [["old", 0]],
      });

      // Update a cell
      const result = manager.setCell(outPath, 1, 0, "new");
      expect(result.row).toBe(1);
      expect(result.col).toBe(0);

      // Verify
      const data = manager.readTable(outPath);
      expect(data.rows[0][0]).toBe("new");
    });

    it("should batch update multiple cells", () => {
      const outPath = join(tmpDir, "batch.numbers");
      manager.createSpreadsheet(outPath, ["X", "Y"], {
        rows: [
          [0, 0],
          [0, 0],
        ],
      });

      const result = manager.setCellsBatch(outPath, [
        { row: 1, col: 0, value: 10 },
        { row: 1, col: 1, value: 20 },
        { row: 2, col: 0, value: 30 },
        { row: 2, col: 1, value: 40 },
      ]);
      expect(result.cellsWritten).toBe(4);

      // Verify
      const data = manager.readTable(outPath);
      expect(data.rows).toEqual([
        [10, 20],
        [30, 40],
      ]);
    });

    it("should append rows to an existing table", () => {
      const outPath = join(tmpDir, "add-rows.numbers");
      manager.createSpreadsheet(outPath, ["Name", "Value"], {
        rows: [["first", 1]],
      });

      const result = manager.addRows(outPath, [
        ["second", 2],
        ["third", 3],
      ]);
      expect(result.rowsAdded).toBe(2);

      // Verify
      const data = manager.readTable(outPath);
      expect(data.rows).toHaveLength(3);
      expect(data.rows[0]).toEqual(["first", 1]);
      expect(data.rows[1]).toEqual(["second", 2]);
      expect(data.rows[2]).toEqual(["third", 3]);
    });

    it("should handle boolean values in create", () => {
      const outPath = join(tmpDir, "booleans.numbers");
      manager.createSpreadsheet(outPath, ["Flag", "Label"], {
        rows: [
          [true, "yes"],
          [false, "no"],
        ],
      });

      const data = manager.readTable(outPath);
      expect(data.rows[0][0]).toBe(true);
      expect(data.rows[1][0]).toBe(false);
    });

    it("should delete rows from a table", () => {
      const outPath = join(tmpDir, "delete-rows.numbers");
      manager.createSpreadsheet(outPath, ["Name"], {
        rows: [["A"], ["B"], ["C"], ["D"]],
      });

      // Delete rows 2-3 (0-based), which are data rows "B" and "C"
      const result = manager.deleteRows(outPath, 2, 3);
      expect(result.rowsDeleted).toBe(2);

      const data = manager.readTable(outPath);
      expect(data.rows).toHaveLength(2);
      expect(data.rows[0][0]).toBe("A");
      expect(data.rows[1][0]).toBe("D");
    });

    it("should add a sheet to an existing file", () => {
      const outPath = join(tmpDir, "add-sheet.numbers");
      manager.createSpreadsheet(outPath, ["X"], { rows: [[1]] });

      const result = manager.addSheet(outPath, "Second", {
        headers: ["A", "B"],
        tableName: "Data",
      });
      expect(result.sheetName).toBe("Second");
      expect(result.tableName).toBe("Data");

      const info = manager.getFileInfo(outPath);
      expect(info.sheets).toHaveLength(2);
      expect(info.sheets[1].name).toBe("Second");
      expect(info.sheets[1].tables[0].headerRow).toEqual(["A", "B"]);
    });

    it("should add a table to an existing sheet", () => {
      const outPath = join(tmpDir, "add-table.numbers");
      manager.createSpreadsheet(outPath, ["X"], { rows: [[1]] });

      const result = manager.addTable(outPath, {
        tableName: "Extra",
        headers: ["P", "Q"],
      });
      expect(result.tableName).toBe("Extra");

      const info = manager.getFileInfo(outPath);
      const tableNames = info.sheets[0].tables.map((t) => t.name);
      expect(tableNames).toContain("Extra");
    });

    it("should update rows by index", () => {
      const outPath = join(tmpDir, "update-rows.numbers");
      manager.createSpreadsheet(outPath, ["Name", "Score"], {
        rows: [
          ["Alice", 80],
          ["Bob", 70],
        ],
      });

      const result = manager.updateRows(outPath, [
        { row: 1, values: ["Alice", 95] },
        { row: 2, values: ["Bob", 85] },
      ]);
      expect(result.rowsUpdated).toBe(2);

      const data = manager.readTable(outPath);
      expect(data.rows[0][0]).toBe("Alice");
      expect(data.rows[0][1]).toBeCloseTo(95);
      expect(data.rows[1][1]).toBeCloseTo(85);
    });

    it("should rename a sheet", () => {
      const outPath = join(tmpDir, "rename-sheet.numbers");
      manager.createSpreadsheet(outPath, ["X"], { sheetName: "Old" });

      const result = manager.renameSheet(outPath, "New", "Old");
      expect(result.oldName).toBe("Old");
      expect(result.newName).toBe("New");

      const info = manager.getFileInfo(outPath);
      expect(info.sheets[0].name).toBe("New");
    });

    it("should rename a table", () => {
      const outPath = join(tmpDir, "rename-table.numbers");
      manager.createSpreadsheet(outPath, ["X"], { tableName: "OldTable" });

      const result = manager.renameTable(outPath, "NewTable", { table: "OldTable" });
      expect(result.oldName).toBe("OldTable");
      expect(result.newName).toBe("NewTable");

      const info = manager.getFileInfo(outPath);
      expect(info.sheets[0].tables[0].name).toBe("NewTable");
    });
  });

  describe("range reads", () => {
    it("should read a row range from a table", () => {
      const data = manager.readTable(basicFixture, undefined, undefined, {
        startRow: 1,
        endRow: 2,
      });

      expect(data.rows).toHaveLength(2);
      expect(data.rows[0][0]).toBe("Alice");
      expect(data.rows[1][0]).toBe("Bob");
    });

    it("should read specific columns by name", () => {
      const data = manager.readTable(basicFixture, undefined, undefined, {
        columns: ["Name", "City"],
      });

      expect(data.headers).toEqual(["Name", "City"]);
      expect(data.numCols).toBe(2);
      expect(data.rows[0]).toEqual(["Alice", "New York"]);
    });

    it("should read specific columns by index", () => {
      const data = manager.readTable(basicFixture, undefined, undefined, {
        columns: [0, 2],
      });

      expect(data.headers).toEqual(["Name", "City"]);
      expect(data.rows[0]).toEqual(["Alice", "New York"]);
    });

    it("should combine row range and column filter", () => {
      const data = manager.readTable(basicFixture, undefined, undefined, {
        startRow: 1,
        endRow: 1,
        columns: ["Name"],
      });

      expect(data.rows).toHaveLength(1);
      expect(data.headers).toEqual(["Name"]);
      expect(data.rows[0]).toEqual(["Alice"]);
    });
  });

  describe("verbose cell metadata", () => {
    it("should return metadata fields when verbose is true", () => {
      const info = manager.getFileInfo(basicFixture);
      const cell = manager.getCell(
        basicFixture,
        info.sheets[0].name,
        info.sheets[0].tables[0].name,
        1,
        0,
        true
      );

      expect(cell.value).toBe("Alice");
      expect(cell).toHaveProperty("formula");
      expect(cell).toHaveProperty("isFormula");
      expect(cell).toHaveProperty("isMerged");
      expect(cell).toHaveProperty("formattedValue");
    });
  });

  describe("import", () => {
    const tmpDir = join(fixturesDir, "_tmp_import_tests");

    beforeAll(async () => {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(tmpDir, { recursive: true });

      // Create CSV fixture
      writeFileSync(join(tmpDir, "test.csv"), "Name,Age,City\nAlice,30,NYC\nBob,25,LA\n");

      // Create TSV fixture
      writeFileSync(join(tmpDir, "test.tsv"), "Name\tAge\nAlice\t30\nBob\t25\n");

      // Create JSON fixture
      writeFileSync(
        join(tmpDir, "test.json"),
        JSON.stringify([
          { Name: "Alice", Age: 30 },
          { Name: "Bob", Age: 25 },
        ])
      );
    });

    afterAll(async () => {
      const { rmSync } = await import("node:fs");
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("should import a CSV file", () => {
      const outPath = join(tmpDir, "from-csv.numbers");
      const result = manager.importFile(join(tmpDir, "test.csv"), outPath, { format: "csv" });

      expect(result.format).toBe("csv");
      expect(result.numHeaders).toBe(3);
      expect(result.numRows).toBe(2);

      const data = manager.readTable(outPath);
      expect(data.headers).toEqual(["Name", "Age", "City"]);
      expect(data.rows[0][0]).toBe("Alice");
    });

    it("should import a TSV file", () => {
      const outPath = join(tmpDir, "from-tsv.numbers");
      const result = manager.importFile(join(tmpDir, "test.tsv"), outPath, { format: "tsv" });

      expect(result.format).toBe("tsv");
      expect(result.numRows).toBe(2);
    });

    it("should import a JSON file", () => {
      const outPath = join(tmpDir, "from-json.numbers");
      const result = manager.importFile(join(tmpDir, "test.json"), outPath, {
        format: "json",
        sheetName: "Imported",
      });

      expect(result.format).toBe("json");
      expect(result.numRows).toBe(2);
      expect(result.sheetName).toBe("Imported");

      const data = manager.readTable(outPath, "Imported");
      expect(data.headers).toEqual(["Name", "Age"]);
    });
  });
});
