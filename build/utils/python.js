import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// pip/display name vs. the importable module name (underscore).
const PACKAGE = "numbers-parser";
const MODULE = "numbers_parser";
const ENV_PREFIX = "APPLE_NUMBERS_MCP";
function getProjectRoot() {
    // build/utils/ or src/utils/ -> project root
    return join(__dirname, "..", "..");
}
function getScriptPath() {
    return join(getProjectRoot(), "src", "utils", "numbers_reader.py");
}
function venvPythonPath() {
    return join(getProjectRoot(), "venv", "bin", "python3");
}
function requirementsPath() {
    return join(getProjectRoot(), "requirements.txt");
}
function setupScriptPath() {
    return join(getProjectRoot(), "scripts", "setup.sh");
}
// Written by scripts/setup.sh after a successful install; holds a copy of the
// requirements.txt the venv was built against, so we can detect a stale venv
// after a package update changes requirements.
function depsMarkerPath() {
    return join(getProjectRoot(), "venv", ".deps-ok");
}
function readIfExists(p) {
    try {
        return existsSync(p) ? readFileSync(p, "utf8") : null;
    }
    catch {
        return null;
    }
}
/**
 * True when the venv exists AND was built against the CURRENT requirements.txt.
 * A package update that changes requirements invalidates the marker, so the
 * server knows to rebuild rather than run against stale deps.
 */
function venvIsReady() {
    if (!existsSync(venvPythonPath()))
        return false;
    const reqs = readIfExists(requirementsPath());
    // If requirements.txt isn't present (unexpected), trust an existing venv.
    if (reqs === null)
        return true;
    const marker = readIfExists(depsMarkerPath());
    return marker !== null && marker.trim() === reqs.trim();
}
let cachedPython = null;
let readyConfirmed = false;
let bootstrapAttempted = false;
/** Reset cached interpreter + bootstrap state (useful for testing). */
export function _resetPythonCache() {
    cachedPython = null;
    readyConfirmed = false;
    bootstrapAttempted = false;
}
function findSystemPython() {
    // The interpreter names below are hardcoded literals (no user/env input), so
    // this command is not injectable. The env-derived python path used elsewhere
    // (execReader, checkDependencies) goes through execFileSync with no shell.
    for (const cmd of ["python3", "python"]) {
        try {
            execSync(`${cmd} --version`, { stdio: "pipe" });
            return cmd;
        }
        catch {
            continue;
        }
    }
    throw new Error('Python 3 not found. Run "npm run setup" to create a venv, or ensure python3 is on PATH.');
}
/**
 * Resolve a Python interpreter. The project venv is cached once present (it's
 * stable); a system-Python fallback is deliberately NOT cached, so a venv
 * created later (e.g. by auto-bootstrap, or a manual `npm run setup`) is picked
 * up on the very next call WITHOUT requiring a server restart.
 */
function resolvePython() {
    if (cachedPython && existsSync(cachedPython))
        return cachedPython;
    cachedPython = null;
    const venv = venvPythonPath();
    if (existsSync(venv)) {
        cachedPython = venv;
        return venv;
    }
    return findSystemPython();
}
function isTrueish(v) {
    return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}
/** Auto-bootstrap is off under tests, or when explicitly disabled via env. */
function autoSetupDisabled() {
    if (process.env.VITEST || process.env.NODE_ENV === "test")
        return true;
    return isTrueish(process.env[`${ENV_PREFIX}_NO_AUTO_SETUP`]);
}
function bootstrapTimeoutMs() {
    const raw = process.env[`${ENV_PREFIX}_SETUP_TIMEOUT`];
    if (raw !== undefined) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return 5 * 60 * 1000; // 5 minutes — pip install of numbers-parser can be slow.
}
/**
 * Create or refresh the venv by running scripts/setup.sh. Returns true on
 * success. Progress is logged to STDERR only — stdout is the MCP protocol
 * channel and must never be written to.
 */
function bootstrapVenv() {
    bootstrapAttempted = true;
    const setup = setupScriptPath();
    if (!existsSync(setup))
        return false;
    console.error(`[numbers-mcp] ${PACKAGE} not ready — setting up the Python venv (one-time; this can take a minute)…`);
    try {
        const out = execFileSync("bash", [setup], {
            encoding: "utf-8",
            timeout: bootstrapTimeoutMs(),
            // A chatty pip install (numbers-parser pulls in pandas etc.) easily exceeds
            // Node's ~1 MB default maxBuffer, which would throw ENOBUFS and fail an
            // otherwise-successful setup. Give it generous headroom.
            maxBuffer: 64 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
        });
        const last = out.trim().split("\n").pop() ?? "";
        console.error(`[numbers-mcp] Python venv ready. ${last}`.trim());
        cachedPython = null;
        readyConfirmed = false;
        return true;
    }
    catch (err) {
        const e = err;
        const detail = (e.stderr?.toString() || e.stdout?.toString() || e.message || "").trim();
        console.error(`[numbers-mcp] Automatic venv setup failed: ${detail.split("\n").pop() ?? detail}`);
        return false;
    }
}
/**
 * Ensure the Python deps are ready, auto-bootstrapping the venv if it's missing
 * or stale (and auto-setup isn't disabled). Cheap and idempotent: once the venv
 * is confirmed ready it short-circuits, and bootstrap is attempted at most once
 * per process.
 */
function ensureReady() {
    if (readyConfirmed)
        return;
    if (venvIsReady()) {
        readyConfirmed = true;
        return;
    }
    if (bootstrapAttempted || autoSetupDisabled())
        return;
    if (bootstrapVenv() && venvIsReady()) {
        readyConfirmed = true;
    }
}
function looksLikeMissingDep(message) {
    return /not installed|No module named|ModuleNotFoundError/i.test(message);
}
function setupHint() {
    return `Run: npm run setup (or set ${ENV_PREFIX}_NO_AUTO_SETUP=0 to allow automatic setup).`;
}
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50MB for large spreadsheets
/** Max stdout bytes from the Python sidecar, overridable via env for huge files. */
function getMaxBuffer() {
    const raw = process.env[`${ENV_PREFIX}_MAX_BUFFER`];
    if (raw !== undefined) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return DEFAULT_MAX_BUFFER_BYTES;
}
function execReader(command, args, timeoutMs) {
    const python = resolvePython();
    const scriptPath = getScriptPath();
    const fullArgs = [scriptPath, command, ...args];
    if (process.env.DEBUG || process.env.VERBOSE) {
        console.error(`[numbers-mcp] ${python} ${fullArgs.join(" ")}`);
    }
    try {
        const stdout = execFileSync(python, fullArgs, {
            encoding: "utf-8",
            timeout: timeoutMs,
            maxBuffer: getMaxBuffer(),
            stdio: ["pipe", "pipe", "pipe"],
        });
        const result = JSON.parse(stdout.trim());
        if (result.error) {
            return { error: result.error };
        }
        return { data: result };
    }
    catch (err) {
        const error = err;
        const stderr = error.stderr?.toString().trim() ?? "";
        if (stderr.includes(`${PACKAGE} not installed`) || looksLikeMissingDep(stderr)) {
            return { error: `${PACKAGE} not installed. ${setupHint()}` };
        }
        if (error.message?.includes("ETIMEDOUT") || error.message?.includes("timed out")) {
            return { error: `Operation timed out after ${timeoutMs}ms. File may be very large.` };
        }
        // Surface the Python traceback when there is one — without it the user just
        // sees "Command failed: <python> <args>" with no clue what actually broke.
        if (stderr) {
            return { error: stderr };
        }
        return { error: error.message || "Unknown error executing Python script" };
    }
}
export function runNumbersReader(command, args, timeoutMs = 30000) {
    ensureReady();
    const result = execReader(command, args, timeoutMs);
    // Belt-and-suspenders: if the deps still look missing and we haven't tried a
    // bootstrap yet, attempt it once and retry — covers a venv that exists but is
    // missing the package, which the marker check alone wouldn't catch.
    if (result.error &&
        looksLikeMissingDep(result.error) &&
        !bootstrapAttempted &&
        !autoSetupDisabled()) {
        if (bootstrapVenv()) {
            return execReader(command, args, timeoutMs);
        }
    }
    return result;
}
export function checkDependencies() {
    ensureReady();
    try {
        const python = resolvePython();
        const version = execFileSync(python, ["-c", `import ${MODULE}; print(${MODULE}.__version__)`], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        return { ok: true, message: `All dependencies available (${PACKAGE} ${version})` };
    }
    catch {
        return {
            ok: false,
            message: `${PACKAGE} not installed. ${setupHint()}`,
        };
    }
}
//# sourceMappingURL=python.js.map