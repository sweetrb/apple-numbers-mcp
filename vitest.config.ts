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
        // Measured (vitest run --coverage):
        //   services: stmts 78.77 / branch 77.58 / funcs 73.33 / lines 78.77
        //   tools:    stmts 95.48 / branch 92.68 / funcs 100.0 / lines 95.48
        //   utils:    stmts 96.83 / branch 93.44 / funcs 96.00 / lines 96.83
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
        "src/services/**/*.ts": { statements: 75, branches: 72, functions: 68, lines: 75 },
        "src/tools/**/*.ts": { statements: 90, branches: 85, functions: 95, lines: 90 },
        "src/utils/**/*.ts": { statements: 80, branches: 80, functions: 82, lines: 80 },
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
