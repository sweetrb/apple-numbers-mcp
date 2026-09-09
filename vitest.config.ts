import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
    // The integration suite (real numbers-parser + fixtures) is opt-in and runs
    // via `npm run test:integration` (its own config). Keep it out of the
    // default `vitest run` / coverage run.
    exclude: ["node_modules/**", "build/**", "src/__tests__/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules/",
        "build/",
        "**/*.test.ts",
        "scripts/",
        "*.config.*",
        // Integration tests are not part of the unit coverage run.
        "src/__tests__/**",
        // Entry point (server wiring; exercised by the integration suite) and the
        // type-only module have no meaningful unit-testable logic.
        "src/index.ts",
        "src/types.ts",
      ],
      thresholds: {
        // Per-directory thresholds on the testable logic, mirroring the
        // apple-photos-mcp / apple-notes-mcp standard. Floors sit a few points
        // below the measured coverage so routine changes don't trip CI.
        //
        // Measured (vitest run --coverage), under vitest 4:
        //   services: stmts 81.61 / branch 72.26 / funcs 74.19 / lines 90.30
        //   tools:    stmts 97.36 / branch 92.10 / funcs 100.0 / lines 97.01
        //   utils:    stmts 86.97 / branch 76.44 / funcs 88.88 / lines 88.20
        //
        // Those numbers are NOT comparable to the vitest 3 ones they replace
        // (services 78.77/77.58/73.33/78.77, tools 95.48/92.68/100/95.48,
        // utils 96.83/93.44/96.00/96.83). vitest 4's coverage-v8 provider
        // remaps V8 ranges through the source AST by default
        // (ast-v8-to-istanbul), where vitest 3 remapped them through source
        // maps alone and credited whole statements it could not actually
        // resolve. The tests, and the code they execute, are unchanged; only
        // the accounting is. Branch and function figures moved most (utils
        // branch 93.44 -> 76.44), so the floors below were re-derived from the
        // new measurement rather than carried over — a stale floor here would
        // either fail CI on an unchanged suite or, worse, stop meaning anything.
        //
        // tools/ is now fully unit-tested (respond + resourcesAndPrompts +
        // doctor), so its floors sit in the 90s. utils/ is now fully unit-tested
        // too: python.ts plus the AppleScript layer in applescript.ts — both
        // runAppleScript/A1/timeout helpers AND the write-path builders
        // (setFormula, setCellStyle, merge, dimensions, getCellStyle, …) are
        // covered by mocking execFileSync, so the builders no longer rely on the
        // integration suite for unit coverage. Floors sit a few points under the
        // measured values so routine changes don't trip CI.
        // python.ts's auto-bootstrap path (creating the venv via setup.sh) is
        // validated live, not in unit tests — it is intentionally disabled under
        // VITEST so the suite never spawns a real install — so the utils floor
        // accounts for those few uncovered lines.
        "src/services/**/*.ts": { statements: 77, branches: 66, functions: 69, lines: 85 },
        "src/tools/**/*.ts": { statements: 92, branches: 86, functions: 95, lines: 92 },
        "src/utils/**/*.ts": { statements: 82, branches: 70, functions: 83, lines: 83 },
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
