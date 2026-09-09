import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// We need to mock child_process and fs before importing the module under test.
// Auto-setup/bootstrap is OFF under vitest (the VITEST env var is set by the
// test runner), so these tests never spawn scripts/setup.sh.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

// Reset the cached python between tests by re-importing
let runNumbersReader: typeof import("../../utils/python.js").runNumbersReader;
let checkDependencies: typeof import("../../utils/python.js").checkDependencies;
let getPythonInfo: typeof import("../../utils/python.js").getPythonInfo;

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
      readFileSync: mockedReadFileSync,
    }));

    // Default: no venv, python3 is on PATH
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue("numbers-parser\n");
    mockedExecSync.mockReturnValue(Buffer.from("Python 3.11.0"));

    const mod = await import("../../utils/python.js");
    runNumbersReader = mod.runNumbersReader;
    checkDependencies = mod.checkDependencies;
    getPythonInfo = mod.getPythonInfo;
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

    it("should return a setup hint with the env var on the missing-dep path", () => {
      const error = new Error("Process exited with code 1") as Error & {
        stderr: string;
        status: number;
      };
      // Simulate a Python ModuleNotFoundError for the underscore module name.
      error.stderr = "ModuleNotFoundError: No module named 'numbers_parser'";
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toContain("numbers-parser not installed");
      expect(result.error).toContain("pip3 install numbers-parser");
      expect(result.error).toContain("scripts/setup.sh");
      expect(result.error).toContain(
        "https://github.com/sweetrb/apple-numbers-mcp#troubleshooting"
      );
      expect(result.error).toContain("APPLE_NUMBERS_MCP_NO_AUTO_SETUP");
    });

    it("should surface the sidecar's JSON error from stdout on a non-zero exit", () => {
      // The sidecar prints {"error": ...} to STDOUT then exits 1 (top-level
      // exception handler in numbers_reader.py); execFileSync throws with the
      // captured output attached. The structured error must win over both the
      // generic "Command failed" message and incidental stderr noise.
      const error = new Error("Command failed: python3 numbers_reader.py info") as Error & {
        stdout: string;
        stderr: string;
        status: number;
      };
      error.stdout = JSON.stringify({
        error: "File not found: /bad.numbers",
      });
      error.stderr = "UserWarning: some incidental python warning";
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/bad.numbers"]);

      expect(result.error).toBe("File not found: /bad.numbers");
      expect(result.data).toBeUndefined();
    });

    it("should normalize the import guard's stdout JSON missing-dep error to the setup hint", () => {
      // numbers_reader.py's import guard reports "numbers-parser not installed"
      // as JSON on STDOUT (stderr stays empty) before exit(1) — it must hit the
      // same normalized setup-hint path as a stderr ModuleNotFoundError.
      const error = new Error("Command failed: python3 numbers_reader.py info") as Error & {
        stdout: string;
        status: number;
      };
      error.stdout = JSON.stringify({
        error: "numbers-parser not installed. Install it with: pip3 install numbers-parser",
      });
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toContain("numbers-parser not installed");
      expect(result.error).toContain("pip3 install numbers-parser");
      expect(result.error).toContain("APPLE_NUMBERS_MCP_NO_AUTO_SETUP");
    });

    it("should fall back to stderr when stdout on a non-zero exit is not JSON", () => {
      const error = new Error("Command failed: python3 numbers_reader.py info") as Error & {
        stdout: string;
        stderr: string;
        status: number;
      };
      error.stdout = "partial garbage that is not JSON {";
      error.stderr = "Traceback (most recent call last):\n  something broke";
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toContain("Traceback");
    });

    it("should fall back to the error message when stdout is not JSON and stderr is empty", () => {
      const error = new Error("Command failed: python3 numbers_reader.py info") as Error & {
        stdout: string;
        stderr: string;
        status: number;
      };
      error.stdout = "not json";
      error.stderr = "";
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toBe("Command failed: python3 numbers_reader.py info");
    });

    it("should ignore stdout JSON on a non-zero exit when it has no string error field", () => {
      // Valid JSON but not the sidecar's error shape (e.g. truncated-but-parseable
      // data) — must not be surfaced as the error; fall through to stderr.
      const error = new Error("Command failed: python3 numbers_reader.py info") as Error & {
        stdout: string;
        stderr: string;
        status: number;
      };
      error.stdout = JSON.stringify({ rows: [] });
      error.stderr = "killed";
      error.status = 1;
      mockedExecFileSync.mockImplementation(() => {
        throw error;
      });

      const result = runNumbersReader("info", ["/test.numbers"]);

      expect(result.error).toBe("killed");
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

    it("should use the default 50MB maxBuffer", () => {
      mockedExecFileSync.mockReturnValue('{"ok": true}');

      runNumbersReader("info", ["/test.numbers"]);

      expect(mockedExecFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ maxBuffer: 50 * 1024 * 1024 })
      );
    });

    it("should allow overriding maxBuffer via APPLE_NUMBERS_MCP_MAX_BUFFER", async () => {
      vi.resetModules();
      const prev = process.env.APPLE_NUMBERS_MCP_MAX_BUFFER;
      process.env.APPLE_NUMBERS_MCP_MAX_BUFFER = String(200 * 1024 * 1024);

      try {
        const localExecFileSync = vi.fn().mockReturnValue('{"ok": true}');
        vi.doMock("node:child_process", () => ({
          execFileSync: localExecFileSync,
          execSync: vi.fn().mockReturnValue(Buffer.from("Python 3.11.0")),
        }));
        vi.doMock("node:fs", () => ({
          existsSync: vi.fn().mockReturnValue(false),
          readFileSync: vi.fn().mockReturnValue("numbers-parser\n"),
        }));

        const mod = await import("../../utils/python.js");
        mod.runNumbersReader("info", ["/test.numbers"]);

        expect(localExecFileSync).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({ maxBuffer: 200 * 1024 * 1024 })
        );
      } finally {
        if (prev === undefined) delete process.env.APPLE_NUMBERS_MCP_MAX_BUFFER;
        else process.env.APPLE_NUMBERS_MCP_MAX_BUFFER = prev;
      }
    });

    // A junk value must fall back to the 50MB default rather than hand
    // execFileSync a NaN/zero/negative cap, which would truncate every read.
    it.each([
      ["non-numeric", "plenty"],
      ["zero", "0"],
      ["negative", "-1"],
      ["empty", ""],
    ])(
      "falls back to the default maxBuffer for a %s APPLE_NUMBERS_MCP_MAX_BUFFER",
      async (_label, value) => {
        vi.resetModules();
        const prev = process.env.APPLE_NUMBERS_MCP_MAX_BUFFER;
        process.env.APPLE_NUMBERS_MCP_MAX_BUFFER = value;

        try {
          const localExecFileSync = vi.fn().mockReturnValue('{"ok": true}');
          vi.doMock("node:child_process", () => ({
            execFileSync: localExecFileSync,
            execSync: vi.fn().mockReturnValue(Buffer.from("Python 3.11.0")),
          }));
          vi.doMock("node:fs", () => ({
            existsSync: vi.fn().mockReturnValue(false),
            readFileSync: vi.fn().mockReturnValue("numbers-parser\n"),
          }));

          const mod = await import("../../utils/python.js");
          mod.runNumbersReader("info", ["/test.numbers"]);

          expect(localExecFileSync).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Array),
            expect.objectContaining({ maxBuffer: 50 * 1024 * 1024 })
          );
        } finally {
          if (prev === undefined) delete process.env.APPLE_NUMBERS_MCP_MAX_BUFFER;
          else process.env.APPLE_NUMBERS_MCP_MAX_BUFFER = prev;
        }
      }
    );
  });

  describe("resolvePython", () => {
    it("should prefer venv python when it exists (with a fresh deps marker)", async () => {
      vi.resetModules();
      const localExecFileSync = vi.fn();
      const localExecSync = vi.fn();
      // venv exists; marker present and matching requirements => venv is ready.
      const localExistsSync = vi.fn().mockReturnValue(true);

      vi.doMock("node:child_process", () => ({
        execFileSync: localExecFileSync,
        execSync: localExecSync,
      }));

      vi.doMock("node:fs", () => ({
        existsSync: localExistsSync,
        readFileSync: vi.fn().mockReturnValue("numbers-parser\n"),
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
        readFileSync: vi.fn().mockReturnValue("numbers-parser\n"),
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
        readFileSync: vi.fn().mockReturnValue("numbers-parser\n"),
      }));

      // Both python3 and python fail
      localExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const mod = await import("../../utils/python.js");

      // findSystemPython throws, which runNumbersReader doesn't catch.
      expect(() => mod.runNumbersReader("info", ["/test.numbers"])).toThrow(
        "Python 3 not found on PATH"
      );
    });
  });

  describe("getPythonInfo", () => {
    it("reports the resolved interpreter path and version", () => {
      // findSystemPython probes via execSync; the --version read runs via execFileSync.
      mockedExecSync.mockReturnValue(Buffer.from("Python 3.9.6"));
      mockedExecFileSync.mockReturnValue("Python 3.9.6\n" as unknown as Buffer);

      const info = getPythonInfo();

      expect(info).toEqual({ path: "python3", version: "Python 3.9.6" });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        "python3",
        ["--version"],
        expect.objectContaining({ encoding: "utf-8" })
      );
    });

    it("returns null when no interpreter can be resolved", () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      expect(getPythonInfo()).toBeNull();
    });
  });

  describe("checkDependencies", () => {
    it("should return ok when numbers-parser is available", () => {
      // findSystemPython probes the interpreter via execSync (Buffer);
      // checkDependencies' import probe runs via execFileSync (no shell) -> string.
      mockedExecSync.mockReturnValue(Buffer.from("Python 3.11.0")); // findSystemPython
      mockedExecFileSync.mockReturnValue("4.3.0\n" as unknown as Buffer); // import probe

      const result = checkDependencies();

      expect(result.ok).toBe(true);
      expect(result.message).toContain("available");
      expect(result.message).toContain("4.3.0");
    });

    it("should return not ok when numbers-parser import fails", () => {
      // findSystemPython succeeds (execSync); the execFileSync import probe throws.
      mockedExecSync.mockReturnValue(Buffer.from("Python 3.11.0")); // findSystemPython
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("ModuleNotFoundError");
      });

      const result = checkDependencies();

      expect(result.ok).toBe(false);
      expect(result.message).toContain("numbers-parser not installed");
    });
  });
});

/**
 * The venv auto-bootstrap.
 *
 * `autoSetupDisabled()` short-circuits on `process.env.VITEST`, so under the
 * normal suite this whole path — `bootstrapVenv`, `setupScriptPath`,
 * `bootstrapTimeoutMs`, `isTrueish`, `ensureReady`'s rebuild arm and
 * `runNumbersReader`'s missing-dep retry — was five uncovered functions and
 * three dozen uncovered branches. That gate exists so the suite never spawns a
 * real `pip install`; it is not a reason to leave the code untested. These
 * tests lift the gate deliberately with `node:child_process` fully mocked, so
 * `scripts/setup.sh` is asserted about but never actually executed.
 */
describe("python.ts auto-bootstrap", () => {
  const ENV_KEYS = [
    "VITEST",
    "NODE_ENV",
    "APPLE_NUMBERS_MCP_NO_AUTO_SETUP",
    "APPLE_NUMBERS_MCP_SETUP_TIMEOUT",
    "DEBUG",
    "VERBOSE",
  ];
  const saved: Record<string, string | undefined> = {};

  const VENV = "venv/bin/python3";
  const SETUP = "scripts/setup.sh";
  const REQS = "requirements.txt";
  const MARKER = "venv/.deps-ok";
  const has =
    (...suffixes: string[]) =>
    (p: string): boolean =>
      suffixes.some((s) => p.endsWith(s));

  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    delete process.env.APPLE_NUMBERS_MCP_NO_AUTO_SETUP;
    delete process.env.APPLE_NUMBERS_MCP_SETUP_TIMEOUT;
    delete process.env.DEBUG;
    delete process.env.VERBOSE;
    // Bootstrap progress goes to stderr (stdout is the MCP protocol channel).
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
    vi.restoreAllMocks();
  });

  async function load(opts: {
    exists?: (p: string) => boolean;
    read?: (p: string) => string;
    execFile?: ReturnType<typeof vi.fn>;
    exec?: ReturnType<typeof vi.fn>;
  }) {
    const existsSync = vi.fn(opts.exists ?? (() => false));
    const readFileSync = vi.fn(opts.read ?? (() => "numbers-parser\n"));
    const execFileSync = opts.execFile ?? vi.fn().mockReturnValue('{"ok": true}');
    const execSync = opts.exec ?? vi.fn().mockReturnValue(Buffer.from("Python 3.11.0"));
    vi.doMock("node:child_process", () => ({ execFileSync, execSync }));
    vi.doMock("node:fs", () => ({ existsSync, readFileSync }));
    const mod = await import("../../utils/python.js");
    return { mod, existsSync, readFileSync, execFileSync, execSync };
  }

  const commandsRun = (fn: ReturnType<typeof vi.fn>): unknown[] => fn.mock.calls.map((c) => c[0]);

  it("builds the venv when it is missing, then runs the sidecar through it", async () => {
    let venvBuilt = false;
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") {
        venvBuilt = true;
        return "Installing numbers-parser…\nSetup complete.\n";
      }
      return '{"ok": true}';
    });
    const { mod } = await load({
      exists: (p) => (has(VENV, MARKER)(p) ? venvBuilt : has(SETUP, REQS)(p)),
      execFile,
    });

    const result = mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(execFile).toHaveBeenCalledWith(
      "bash",
      [expect.stringContaining("scripts/setup.sh")],
      expect.objectContaining({
        timeout: 5 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
    // The sidecar then runs through the venv interpreter the bootstrap created.
    expect(execFile.mock.calls[1][0]).toContain("venv/bin/python3");
    expect(result.data).toEqual({ ok: true });
    // Only the LAST line of setup.sh's output is echoed, not the whole log.
    expect(errSpy).toHaveBeenCalledWith("[numbers-mcp] Python venv ready. Setup complete.");
  });

  it("does not attempt a bootstrap when scripts/setup.sh is not shipped", async () => {
    const { mod, execFileSync } = await load({ exists: () => false });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(commandsRun(execFileSync)).not.toContain("bash");
  });

  it("logs and swallows a setup.sh failure rather than throwing", async () => {
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") {
        const e = new Error("Command failed: bash setup.sh") as Error & { stderr: string };
        e.stderr = "creating venv\nERROR: could not build wheels for numbers-parser";
        throw e;
      }
      return '{"ok": true}';
    });
    const { mod } = await load({ exists: has(SETUP, REQS), execFile });

    const result = mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(errSpy).toHaveBeenCalledWith(
      "[numbers-mcp] Automatic venv setup failed: ERROR: could not build wheels for numbers-parser"
    );
    // The sidecar call still happened (against system python) and returned.
    expect(result.data).toEqual({ ok: true });
  });

  // The failure detail is pulled from stderr, else stdout, else the message.
  it.each([
    [
      "stdout when stderr is empty",
      { stdout: "pip: no matching distribution" },
      "pip: no matching distribution",
    ],
    [
      "the error message when neither stream has output",
      { message: "spawn bash ENOENT" },
      "spawn bash ENOENT",
    ],
  ])("reports the setup failure from %s", async (_label, shape, expected) => {
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") throw Object.assign(new Error(""), shape);
      return '{"ok": true}';
    });
    const { mod } = await load({ exists: has(SETUP, REQS), execFile });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(errSpy).toHaveBeenCalledWith(`[numbers-mcp] Automatic venv setup failed: ${expected}`);
  });

  it("reports an empty detail rather than crashing when the failure carries none", async () => {
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") throw Object.assign(new Error(""), { message: "" });
      return '{"ok": true}';
    });
    const { mod } = await load({ exists: has(SETUP, REQS), execFile });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(errSpy).toHaveBeenCalledWith("[numbers-mcp] Automatic venv setup failed: ");
  });

  it("attempts the bootstrap at most once per process", async () => {
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") throw new Error("setup failed");
      return '{"ok": true}';
    });
    const { mod } = await load({ exists: has(SETUP, REQS), execFile });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);
    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(commandsRun(execFile).filter((c) => c === "bash")).toHaveLength(1);
  });

  describe("APPLE_NUMBERS_MCP_NO_AUTO_SETUP", () => {
    it.each(["1", "true", "yes", "on"])("disables the bootstrap when set to %s", async (value) => {
      process.env.APPLE_NUMBERS_MCP_NO_AUTO_SETUP = value;
      const { mod, execFileSync } = await load({ exists: has(SETUP, REQS) });

      mod.runNumbersReader("info", ["/tmp/x.numbers"]);

      expect(commandsRun(execFileSync)).not.toContain("bash");
    });

    // Unset, empty, "0" and "false" all mean "not disabled" — an env var that
    // exists but reads false must not silently switch the feature off.
    it.each(["", "0", "false", "FALSE"])(
      "leaves the bootstrap enabled when set to %j",
      async (value) => {
        process.env.APPLE_NUMBERS_MCP_NO_AUTO_SETUP = value;
        const { mod, execFileSync } = await load({ exists: has(SETUP, REQS) });

        mod.runNumbersReader("info", ["/tmp/x.numbers"]);

        expect(commandsRun(execFileSync)).toContain("bash");
      }
    );
  });

  describe("APPLE_NUMBERS_MCP_SETUP_TIMEOUT", () => {
    const timeoutOf = (fn: ReturnType<typeof vi.fn>): number =>
      (fn.mock.calls.find((c) => c[0] === "bash")![2] as { timeout: number }).timeout;

    it("honors a positive numeric override", async () => {
      process.env.APPLE_NUMBERS_MCP_SETUP_TIMEOUT = "90000";
      const { mod, execFileSync } = await load({ exists: has(SETUP, REQS) });

      mod.runNumbersReader("info", ["/tmp/x.numbers"]);

      expect(timeoutOf(execFileSync)).toBe(90000);
    });

    it.each([
      ["non-numeric", "soon"],
      ["zero", "0"],
      ["negative", "-5"],
      ["empty", ""],
    ])("falls back to the 5-minute default for a %s value", async (_label, value) => {
      process.env.APPLE_NUMBERS_MCP_SETUP_TIMEOUT = value;
      const { mod, execFileSync } = await load({ exists: has(SETUP, REQS) });

      mod.runNumbersReader("info", ["/tmp/x.numbers"]);

      expect(timeoutOf(execFileSync)).toBe(5 * 60 * 1000);
    });
  });

  it("confirms readiness once and short-circuits every later call", async () => {
    const { mod, readFileSync, execFileSync } = await load({
      exists: has(VENV, REQS, MARKER, SETUP),
    });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);
    const readsAfterFirst = readFileSync.mock.calls.length;
    expect(readsAfterFirst).toBeGreaterThan(0);

    mod.runNumbersReader("info", ["/tmp/y.numbers"]);

    // The readiness check reads requirements.txt + the marker; once confirmed it
    // must not re-read them, and the interpreter stays cached.
    expect(readFileSync.mock.calls.length).toBe(readsAfterFirst);
    expect(commandsRun(execFileSync)).not.toContain("bash");
    expect(execFileSync.mock.calls[1][0]).toBe(execFileSync.mock.calls[0][0]);
  });

  it("trusts an existing venv when requirements.txt is absent", async () => {
    const { mod, execFileSync } = await load({ exists: has(VENV) });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(commandsRun(execFileSync)).not.toContain("bash");
    expect(execFileSync.mock.calls[0][0]).toContain("venv/bin/python3");
  });

  it("rebuilds when the deps marker does not match the current requirements", async () => {
    const { mod, execFileSync } = await load({
      exists: has(VENV, REQS, MARKER, SETUP),
      read: (p) => (p.endsWith(".deps-ok") ? "numbers-parser==4.3.0\n" : "numbers-parser==4.4.0\n"),
    });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(commandsRun(execFileSync)).toContain("bash");
  });

  it("logs the sidecar command line under DEBUG", async () => {
    process.env.DEBUG = "1";
    const { mod } = await load({ exists: has(VENV, REQS, MARKER) });

    mod.runNumbersReader("read", ["/tmp/x.numbers", "--sheet", "S"]);

    const logged = errSpy.mock.calls.map((c) => String(c[0]));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^\[numbers-mcp\] .*venv\/bin\/python3 /);
    expect(logged[0]).toContain("numbers_reader.py read /tmp/x.numbers --sheet S");
  });

  it("falls back to a generic message when the failure carries no text at all", async () => {
    const execFile = vi.fn(() => {
      throw new Error("");
    });
    const { mod } = await load({ exists: has(VENV, REQS, MARKER), execFile });

    const result = mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(result.error).toBe("Unknown error executing Python script");
  });

  // A venv that exists and passes the marker check can still be missing the
  // package (someone pip-uninstalled it). The marker check cannot see that, so
  // runNumbersReader retries once behind the sidecar's own missing-dep report.
  it("bootstraps and retries once when a ready-looking venv reports a missing module", async () => {
    let repaired = false;
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") {
        repaired = true;
        return "Setup complete.\n";
      }
      if (!repaired) {
        const e = new Error("Command failed") as Error & { stderr: string };
        e.stderr = "ModuleNotFoundError: No module named 'numbers_parser'";
        throw e;
      }
      return '{"rows": []}';
    });
    const { mod } = await load({ exists: has(VENV, REQS, MARKER, SETUP), execFile });

    const result = mod.runNumbersReader("read", ["/tmp/x.numbers"]);

    expect(commandsRun(execFile)).toContain("bash");
    expect(result.data).toEqual({ rows: [] });
    expect(result.error).toBeUndefined();
  });

  it("returns the missing-dep error when the repair bootstrap also fails", async () => {
    const execFile = vi.fn((cmd: string) => {
      if (cmd === "bash") throw new Error("setup failed");
      const e = new Error("Command failed") as Error & { stderr: string };
      e.stderr = "ModuleNotFoundError: No module named 'numbers_parser'";
      throw e;
    });
    const { mod } = await load({ exists: has(VENV, REQS, MARKER, SETUP), execFile });

    const result = mod.runNumbersReader("read", ["/tmp/x.numbers"]);

    expect(result.error).toContain("numbers-parser not installed");
    // One repair attempt, and the sidecar was not retried after it failed.
    expect(commandsRun(execFile).filter((c) => c === "bash")).toHaveLength(1);
  });

  it("_resetPythonCache drops the cached interpreter and the readiness latch", async () => {
    let venvPresent = true;
    // No setup.sh here, so the reset cannot be masked by a rebuild.
    const { mod, execFileSync } = await load({
      exists: (p) => (has(VENV)(p) ? venvPresent : has(REQS, MARKER)(p)),
    });

    mod.runNumbersReader("info", ["/tmp/x.numbers"]);
    expect(execFileSync.mock.calls[0][0]).toContain("venv/bin/python3");

    venvPresent = false;
    mod._resetPythonCache();
    mod.runNumbersReader("info", ["/tmp/x.numbers"]);

    expect(execFileSync.mock.calls[1][0]).toBe("python3");
  });
});
