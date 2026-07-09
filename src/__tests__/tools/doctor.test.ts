import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/python.js", () => ({
  checkDependencies: vi.fn(),
  getPythonInfo: vi.fn(),
  setupHint: vi.fn(() => "Install it with: pip3 install numbers-parser"),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { runDoctor, formatDoctorReport } from "../../tools/doctor.js";
import { checkDependencies, getPythonInfo } from "../../utils/python.js";
import { existsSync } from "node:fs";
import type { NumbersManager } from "../../services/numbersManager.js";

const checkMock = vi.mocked(checkDependencies);
const pythonInfoMock = vi.mocked(getPythonInfo);
const existsMock = vi.mocked(existsSync);

/** runDoctor only needs a NumbersManager-shaped object; nothing is called on it. */
const fakeManager = {} as unknown as NumbersManager;

describe("runDoctor", () => {
  beforeEach(() => {
    checkMock.mockReset();
    pythonInfoMock.mockReset();
    existsMock.mockReset();
    pythonInfoMock.mockReturnValue({ path: "/usr/bin/python3", version: "Python 3.12.4" });
  });

  it("reports healthy when numbers-parser is fine and Numbers.app is present", () => {
    checkMock.mockReturnValue({
      ok: true,
      message: "All dependencies available (numbers-parser 4.4.5)",
    });
    existsMock.mockImplementation((p) => p === "/Applications/Numbers.app");

    const report = runDoctor(fakeManager);

    expect(report.healthy).toBe(true);

    const python = report.checks.find((c) => c.name === "python_interpreter");
    expect(python?.status).toBe("ok");
    expect(python?.detail).toContain("Python 3.12.4");
    expect(python?.detail).toContain("/usr/bin/python3");

    const parser = report.checks.find((c) => c.name === "numbers_parser");
    expect(parser?.status).toBe("ok");
    expect(parser?.detail).toContain("4.4.5");

    const app = report.checks.find((c) => c.name === "numbers_app");
    expect(app?.status).toBe("ok");
    expect(app?.detail).toContain("write operations available");

    const auto = report.checks.find((c) => c.name === "automation_permission");
    expect(auto?.status).toBe("ok");
  });

  it("fails and is unhealthy when numbers-parser is missing", () => {
    checkMock.mockReturnValue({
      ok: false,
      message: "numbers-parser not installed. Install it with: pip3 install numbers-parser",
    });
    existsMock.mockReturnValue(true);

    const report = runDoctor(fakeManager);

    expect(report.healthy).toBe(false);
    const parser = report.checks.find((c) => c.name === "numbers_parser");
    expect(parser?.status).toBe("fail");
    expect(parser?.detail).toContain("pip3 install numbers-parser");
  });

  it("warns on a too-old Python interpreter (the stock macOS 3.9 case)", () => {
    checkMock.mockReturnValue({
      ok: false,
      message: "numbers-parser not installed. Install it with: pip3 install numbers-parser",
    });
    existsMock.mockReturnValue(true);
    pythonInfoMock.mockReturnValue({ path: "/usr/bin/python3", version: "Python 3.9.6" });

    const report = runDoctor(fakeManager);

    const python = report.checks.find((c) => c.name === "python_interpreter");
    expect(python?.status).toBe("warn");
    expect(python?.detail).toContain("Python 3.9.6");
    expect(python?.detail).toContain("/usr/bin/python3");
    expect(python?.detail).toContain("brew install python@3.12");
  });

  it("fails the interpreter check when no Python can be resolved", () => {
    checkMock.mockReturnValue({
      ok: false,
      message: "numbers-parser not installed. Install it with: pip3 install numbers-parser",
    });
    existsMock.mockReturnValue(true);
    pythonInfoMock.mockReturnValue(null);

    const report = runDoctor(fakeManager);

    const python = report.checks.find((c) => c.name === "python_interpreter");
    expect(python?.status).toBe("fail");
    expect(python?.detail).toContain("Python 3 not found");
    expect(python?.detail).toContain("#troubleshooting");
  });

  it("warns (not fails) when Numbers.app is absent, staying healthy if the parser is fine", () => {
    checkMock.mockReturnValue({
      ok: true,
      message: "All dependencies available (numbers-parser 4.4.5)",
    });
    existsMock.mockReturnValue(false);

    const report = runDoctor(fakeManager);

    const app = report.checks.find((c) => c.name === "numbers_app");
    expect(app?.status).toBe("warn");
    expect(app?.detail).toMatch(/reads.*work|read/i);

    // Parser is OK and nothing failed, so the report stays healthy.
    expect(report.healthy).toBe(true);
    expect(report.checks.some((c) => c.status === "fail")).toBe(false);
  });

  it("never throws even if a probe throws", () => {
    checkMock.mockImplementation(() => {
      throw new Error("boom");
    });
    pythonInfoMock.mockImplementation(() => {
      throw new Error("bang");
    });
    existsMock.mockImplementation(() => {
      throw "kaboom";
    });

    expect(() => runDoctor(fakeManager)).not.toThrow();

    const report = runDoctor(fakeManager);
    const parser = report.checks.find((c) => c.name === "numbers_parser");
    expect(parser?.status).toBe("fail");
    const python = report.checks.find((c) => c.name === "python_interpreter");
    expect(python?.status).toBe("warn");
  });
});

describe("formatDoctorReport", () => {
  beforeEach(() => {
    pythonInfoMock.mockReturnValue({ path: "/usr/bin/python3", version: "Python 3.12.4" });
  });

  it("renders icons and check names", () => {
    checkMock.mockReturnValue({
      ok: true,
      message: "All dependencies available (numbers-parser 4.4.5)",
    });
    existsMock.mockReturnValue(true);

    const text = formatDoctorReport(runDoctor(fakeManager));

    expect(text).toContain("✅");
    expect(text).toContain("apple-numbers-mcp doctor");
    expect(text).toContain("python_interpreter");
    expect(text).toContain("numbers_parser");
    expect(text).toContain("numbers_app");
    expect(text).toContain("automation_permission");
  });

  it("shows the failure icon and ISSUES FOUND header when unhealthy", () => {
    checkMock.mockReturnValue({
      ok: false,
      message: "numbers-parser not installed. Install it with: pip3 install numbers-parser",
    });
    existsMock.mockReturnValue(false);

    const text = formatDoctorReport(runDoctor(fakeManager));

    expect(text).toContain("❌");
    expect(text).toContain("ISSUES FOUND");
    expect(text).toContain("⚠️");
  });
});
