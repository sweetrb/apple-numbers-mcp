import type { NumbersManager } from "../services/numbersManager.js";
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
/**
 * Run all diagnostic checks. This function NEVER throws — every probe is wrapped
 * in try/catch and converted to a fail/warn/ok check.
 *
 * The `manager` parameter is accepted for symmetry with the other tools and to
 * leave room for future manager-backed probes; the current checks don't need it.
 */
export declare function runDoctor(_manager: NumbersManager): DoctorReport;
/** Render a DoctorReport as readable text. */
export declare function formatDoctorReport(r: DoctorReport): string;
//# sourceMappingURL=doctor.d.ts.map