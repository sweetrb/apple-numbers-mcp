import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/python.js", () => ({
  checkDependencies: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { runDoctor, formatDoctorReport } from "../../tools/doctor.js";
import { checkDependencies } from "../../utils/python.js";
import { existsSync } from "node:fs";
import type { NumbersManager } from "../../services/numbersManager.js";

const checkMock = vi.mocked(checkDependencies);
const existsMock = vi.mocked(existsSync);

/** runDoctor only needs a NumbersManager-shaped object; nothing is called on it. */
const fakeManager = {} as unknown as NumbersManager;

describe("runDoctor", () => {
  beforeEach(() => {
    checkMock.mockReset();
    existsMock.mockReset();
  });

  it("reports healthy when numbers-parser is fine and Numbers.app is present", () => {
    checkMock.mockReturnValue({
      ok: true,
      message: "All dependencies available (numbers-parser 4.4.5)",
    });
    existsMock.mockImplementation((p) => p === "/Applications/Numbers.app");

    const report = runDoctor(fakeManager);

    expect(report.healthy).toBe(true);

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
      message: "numbers-parser not installed. Run: npm run setup",
    });
    existsMock.mockReturnValue(true);

    const report = runDoctor(fakeManager);

    expect(report.healthy).toBe(false);
    const parser = report.checks.find((c) => c.name === "numbers_parser");
    expect(parser?.status).toBe("fail");
    expect(parser?.detail).toContain("npm run setup");
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
    existsMock.mockImplementation(() => {
      throw "kaboom";
    });

    expect(() => runDoctor(fakeManager)).not.toThrow();

    const report = runDoctor(fakeManager);
    const parser = report.checks.find((c) => c.name === "numbers_parser");
    expect(parser?.status).toBe("fail");
  });
});

describe("formatDoctorReport", () => {
  it("renders icons and check names", () => {
    checkMock.mockReturnValue({
      ok: true,
      message: "All dependencies available (numbers-parser 4.4.5)",
    });
    existsMock.mockReturnValue(true);

    const text = formatDoctorReport(runDoctor(fakeManager));

    expect(text).toContain("✅");
    expect(text).toContain("apple-numbers-mcp doctor");
    expect(text).toContain("numbers_parser");
    expect(text).toContain("numbers_app");
    expect(text).toContain("automation_permission");
  });

  it("shows the failure icon and ISSUES FOUND header when unhealthy", () => {
    checkMock.mockReturnValue({
      ok: false,
      message: "numbers-parser not installed. Run: npm run setup",
    });
    existsMock.mockReturnValue(false);

    const text = formatDoctorReport(runDoctor(fakeManager));

    expect(text).toContain("❌");
    expect(text).toContain("ISSUES FOUND");
    expect(text).toContain("⚠️");
  });
});
