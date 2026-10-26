/**
 * export-table, create-spreadsheet and import-csv refuse an existing
 * destination unless the caller passes overwrite: true. Runs against a real
 * temp directory (only the Python sidecar is mocked), so the check sees real
 * files and real symlinks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NumbersManager } from "../../services/numbersManager.js";
import * as pythonUtils from "../../utils/python.js";

vi.mock("../../utils/python.js", () => ({
  runNumbersReader: vi.fn(),
  checkDependencies: vi.fn(),
}));

const sidecar = vi.mocked(pythonUtils.runNumbersReader);

let dir: string;
let source: string;
let csv: string;

beforeEach(() => {
  vi.clearAllMocks();
  sidecar.mockReturnValue({ data: {} });
  dir = mkdtempSync(join(tmpdir(), "numbers-overwrite-"));
  source = join(dir, "source.numbers");
  csv = join(dir, "input.csv");
  writeFileSync(source, "not really numbers");
  writeFileSync(csv, "a,b\n1,2\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writers: [string, (m: NumbersManager, out: string, overwrite?: boolean) => unknown][] = [
  [
    "export-table",
    (m, out, overwrite) => m.exportTable(source, "csv", out, undefined, undefined, overwrite),
  ],
  ["create-spreadsheet", (m, out, overwrite) => m.createSpreadsheet(out, ["A"], { overwrite })],
  ["import-csv", (m, out, overwrite) => m.importFile(csv, out, { overwrite })],
];

describe.each(writers)("%s overwrite guard", (_name, write) => {
  const ext = _name === "export-table" ? ".csv" : ".numbers";

  it("writes to a path that does not exist", () => {
    write(new NumbersManager(), join(dir, `fresh${ext}`));
    expect(sidecar).toHaveBeenCalledTimes(1);
  });

  it("refuses an existing file without calling the sidecar", () => {
    const out = join(dir, `taken${ext}`);
    writeFileSync(out, "keep me");
    expect(() => write(new NumbersManager(), out)).toThrow(/already exists.*overwrite: true/);
    expect(sidecar).not.toHaveBeenCalled();
  });

  it("replaces an existing file when overwrite is true", () => {
    const out = join(dir, `taken${ext}`);
    writeFileSync(out, "replace me");
    write(new NumbersManager(), out, true);
    expect(sidecar).toHaveBeenCalledTimes(1);
  });

  it("refuses a symlink to an existing file", () => {
    const target = join(dir, `target${ext}`);
    const link = join(dir, `link${ext}`);
    writeFileSync(target, "keep me");
    symlinkSync(target, link);
    expect(() => write(new NumbersManager(), link)).toThrow(/already exists/);
    expect(sidecar).not.toHaveBeenCalled();
  });
});
