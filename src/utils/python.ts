import { execSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getProjectRoot(): string {
  // Walk up from build/utils/ or src/utils/ to project root
  return join(__dirname, "..", "..");
}

// Resolve path to the Python helper script
function getScriptPath(): string {
  return join(getProjectRoot(), "src", "utils", "numbers_reader.py");
}

/**
 * Find the best Python executable. Preference order:
 *   1. Project-local venv (./venv/bin/python3)
 *   2. System python3
 *   3. System python
 */
function findPython(): string {
  const projectRoot = getProjectRoot();
  const venvPython = join(projectRoot, "venv", "bin", "python3");

  // Prefer the project venv — it has numbers-parser installed
  if (existsSync(venvPython)) {
    return venvPython;
  }

  // Fall back to system Python
  for (const cmd of ["python3", "python"]) {
    try {
      execSync(`${cmd} --version`, { stdio: "pipe" });
      return cmd;
    } catch {
      continue;
    }
  }
  throw new Error(
    'Python 3 not found. Run "npm run setup" to create a venv, or ensure python3 is on PATH.'
  );
}

export interface PythonResult<T = unknown> {
  data?: T;
  error?: string;
}

let cachedPython: string | null = null;

/** Reset the cached Python path (useful for testing). */
export function _resetPythonCache(): void {
  cachedPython = null;
}

export function runNumbersReader<T = unknown>(
  command: string,
  args: string[],
  timeoutMs = 30000
): PythonResult<T> {
  const python = cachedPython ?? (cachedPython = findPython());
  const scriptPath = getScriptPath();
  const fullArgs = [scriptPath, command, ...args];

  const debug = process.env.DEBUG || process.env.VERBOSE;
  if (debug) {
    console.error(`[numbers-mcp] ${python} ${fullArgs.join(" ")}`);
  }

  try {
    const stdout = execFileSync(python, fullArgs, {
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB for large spreadsheets
      stdio: ["pipe", "pipe", "pipe"],
    });

    const result = JSON.parse(stdout.trim());
    if (result.error) {
      return { error: result.error };
    }
    return { data: result as T };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string; status?: number };
    if (error.stderr?.includes("numbers-parser not installed")) {
      return { error: "numbers-parser not installed. Run: npm run setup" };
    }
    if (error.message?.includes("ETIMEDOUT") || error.message?.includes("timed out")) {
      return { error: `Operation timed out after ${timeoutMs}ms. File may be very large.` };
    }
    return { error: error.message || "Unknown error executing Python script" };
  }
}

export function checkDependencies(): { ok: boolean; message: string } {
  try {
    const python = cachedPython ?? (cachedPython = findPython());
    const version = execSync(
      `${python} -c "import numbers_parser; print(numbers_parser.__version__)"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return { ok: true, message: `All dependencies available (numbers-parser ${version})` };
  } catch {
    return {
      ok: false,
      message: "numbers-parser not installed. Run: npm run setup",
    };
  }
}
