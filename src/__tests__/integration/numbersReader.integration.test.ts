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

import { describe, it, expect, beforeAll } from "vitest";
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

// Check preconditions
function hasPython(): boolean {
  try {
    execSync("python3 --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasNumbersParser(): boolean {
  try {
    execSync('python3 -c "import numbers_parser"', { stdio: "pipe" });
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
      expect(() => manager.getFileInfo("/tmp/data.xlsx")).toThrow("Not a Numbers file");
    });
  });
});
