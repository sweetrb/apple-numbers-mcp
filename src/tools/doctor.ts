/**
 * Setup "doctor": one diagnostic covering the things that actually break an
 * apple-numbers-mcp setup — the resolved Python interpreter (path + version, so
 * an old stock Python is visible), the numbers-parser Python sidecar (used for
 * reads *and* value/structure writes), the presence of Numbers.app (required
 * only for the AppleScript formula/formatting tools), and the Automation
 * permission those same tools need — each reported as ok / warn / fail with an
 * actionable message.
 *
 * @module tools/doctor
 */
import { existsSync } from "node:fs";
import type { NumbersManager } from "../services/numbersManager.js";
import { checkDependencies, getPythonInfo, setupHint } from "../utils/python.js";

export type CheckStatus = "ok" | "warn" | "fail";
export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface DoctorReport {
  healthy: boolean;
  checks: DoctorCheck[];
}

/** Candidate install locations for Numbers.app. */
const NUMBERS_APP_PATHS = ["/Applications/Numbers.app", "/System/Applications/Numbers.app"];

/**
 * Run all diagnostic checks. This function NEVER throws — every probe is wrapped
 * in try/catch and converted to a fail/warn/ok check.
 *
 * The `manager` parameter is accepted for symmetry with the other tools and to
 * leave room for future manager-backed probes; the current checks don't need it.
 */
export function runDoctor(_manager: NumbersManager): DoctorReport {
  const checks: DoctorCheck[] = [];

  // 1. Python interpreter — report the resolved path + version so an old stock
  //    Python (macOS ships 3.9; numbers-parser needs >= 3.11) is visible at a glance.
  try {
    const info = getPythonInfo();
    if (info) {
      const m = /Python (\d+)\.(\d+)/.exec(info.version);
      const tooOld = m !== null && (Number(m[1]) < 3 || (Number(m[1]) === 3 && Number(m[2]) < 11));
      checks.push({
        name: "python_interpreter",
        status: tooOld ? "warn" : "ok",
        detail: tooOld
          ? `${info.version} at ${info.path} — numbers-parser requires Python >= 3.11 ` +
            `(stock macOS ships 3.9). Install a newer Python (brew install python@3.12) ` +
            `and retry — the venv rebuilds automatically. ` +
            `See https://github.com/sweetrb/apple-numbers-mcp#troubleshooting`
          : `${info.version} (${info.path})`,
      });
    } else {
      checks.push({
        name: "python_interpreter",
        status: "fail",
        detail:
          "Python 3 not found on PATH. Install Python >= 3.11 (e.g. brew install python@3.12). " +
          "See https://github.com/sweetrb/apple-numbers-mcp#troubleshooting",
      });
    }
  } catch (e) {
    checks.push({
      name: "python_interpreter",
      status: "warn",
      detail: `could not resolve the Python interpreter: ${String(e)}`,
    });
  }

  // 2. numbers-parser (Python sidecar) — powers all read/export operations.
  //    checkDependencies() already embeds the actionable install guidance
  //    (pip3 install / scripts/setup.sh / troubleshooting URL) on failure.
  try {
    const dep = checkDependencies();
    checks.push({
      name: "numbers_parser",
      status: dep.ok ? "ok" : "fail",
      detail: dep.message,
    });
  } catch (e) {
    checks.push({
      name: "numbers_parser",
      status: "fail",
      detail: `could not verify numbers-parser: ${String(e)}. ${setupHint()}`,
    });
  }

  // 3. Numbers.app — required only for the AppleScript formula/formatting tools.
  //    Reads and value/structure writes via numbers-parser still work without it,
  //    so its absence is a warn, not a fail.
  try {
    const found = NUMBERS_APP_PATHS.find((p) => existsSync(p));
    if (found) {
      checks.push({
        name: "numbers_app",
        status: "ok",
        detail: `Numbers.app present — formula and formatting tools available (${found})`,
      });
    } else {
      checks.push({
        name: "numbers_app",
        status: "warn",
        detail:
          "Numbers.app not found. Reads, exports and value/structure writes via " +
          "numbers-parser still work; only the formula and formatting tools " +
          "(set-formula(s), set-cell(s)-style, set-column-width/set-row-height, " +
          "merge-cells/unmerge-cells) need Numbers.app installed.",
      });
    }
  } catch (e) {
    checks.push({
      name: "numbers_app",
      status: "warn",
      detail:
        `could not verify Numbers.app: ${String(e)}. Reads, exports and ` +
        "value/structure writes still work; only the formula/formatting tools " +
        "need Numbers.app.",
    });
  }

  // 4. Automation permission — can't be probed without side effects, so this is
  //    informational. Only the AppleScript formula/formatting tools require
  //    Automation permission for Numbers.app, granted on first use.
  try {
    checks.push({
      name: "automation_permission",
      status: "ok",
      detail:
        "The AppleScript formula/formatting tools require Automation permission " +
        "for Numbers.app, granted on first use (System Settings > Privacy & " +
        "Security > Automation). Reads and value/structure writes do not.",
    });
  } catch (e) {
    checks.push({
      name: "automation_permission",
      status: "ok",
      detail: `informational: ${String(e)}`,
    });
  }

  const healthy = !checks.some((c) => c.status === "fail");
  return { healthy, checks };
}

/** Render a DoctorReport as readable text. */
export function formatDoctorReport(r: DoctorReport): string {
  const icon = (s: CheckStatus): string => (s === "ok" ? "✅" : s === "warn" ? "⚠️ " : "❌");
  const lines = [`🩺 apple-numbers-mcp doctor — ${r.healthy ? "healthy" : "ISSUES FOUND"}`, ""];
  for (const c of r.checks) lines.push(`${icon(c.status)} ${c.name}: ${c.detail}`);
  return lines.join("\n");
}
