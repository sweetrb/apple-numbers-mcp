import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve path to the Python helper script
// In build: build/utils/python.js -> need to find src/utils/numbers_reader.py
// We ship the .py alongside the build, so look relative to project root
function getScriptPath(): string {
  // Walk up from build/utils/ or src/utils/ to project root
  const projectRoot = join(__dirname, '..', '..');
  return join(projectRoot, 'src', 'utils', 'numbers_reader.py');
}

function findPython(): string {
  // Try python3 first (macOS default), then python
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch {
      continue;
    }
  }
  throw new Error('Python 3 not found. Install Python 3 or ensure python3 is on PATH.');
}

export interface PythonResult<T = unknown> {
  data?: T;
  error?: string;
}

let cachedPython: string | null = null;

export function runNumbersReader<T = unknown>(
  command: string,
  args: string[],
  timeoutMs = 30000,
): PythonResult<T> {
  const python = cachedPython ?? (cachedPython = findPython());
  const scriptPath = getScriptPath();
  const fullArgs = [scriptPath, command, ...args];

  const debug = process.env.DEBUG || process.env.VERBOSE;
  if (debug) {
    console.error(`[numbers-mcp] ${python} ${fullArgs.join(' ')}`);
  }

  try {
    const stdout = execFileSync(python, fullArgs, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB for large spreadsheets
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const result = JSON.parse(stdout.trim());
    if (result.error) {
      return { error: result.error };
    }
    return { data: result as T };
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string; status?: number };
    if (error.stderr?.includes('numbers-parser not installed')) {
      return { error: 'numbers-parser not installed. Run: pip3 install numbers-parser' };
    }
    if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timed out')) {
      return { error: `Operation timed out after ${timeoutMs}ms. File may be very large.` };
    }
    return { error: error.message || 'Unknown error executing Python script' };
  }
}

export function checkDependencies(): { ok: boolean; message: string } {
  try {
    const python = cachedPython ?? (cachedPython = findPython());
    execSync(`${python} -c "import numbers_parser; print(numbers_parser.__version__)"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, message: 'All dependencies available' };
  } catch {
    return {
      ok: false,
      message: 'numbers-parser not installed. Run: pip3 install numbers-parser',
    };
  }
}
