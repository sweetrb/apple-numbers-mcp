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
        //   services: stmts 100.0 / branch 100.0 / funcs 100.0 / lines 100.0
        //   tools:    stmts 98.68 / branch 100.0 / funcs 100.0 / lines 98.51
        //   utils:    stmts 99.47 / branch 98.76 / funcs 100.0 / lines 99.71
        //
        // --- the vitest 3 -> 4 discontinuity, and what it exposed ---
        //
        // Those numbers are NOT comparable to the vitest 3 ones they replaced
        // (services 78.77/77.58/73.33/78.77, tools 95.48/92.68/100/95.48,
        // utils 96.83/93.44/96.00/96.83). vitest 4's coverage-v8 provider
        // remaps V8 ranges through the source AST by default
        // (ast-v8-to-istanbul), where vitest 3 remapped them through source
        // maps alone and credited whole statements it could not actually
        // resolve. The tests, and the code they executed, were unchanged; only
        // the accounting was. Branch and function figures moved most (utils
        // branch 93.44 -> 76.44 on the very same suite).
        //
        // The vitest 4 bump therefore did not break coverage — it revealed
        // gaps the old accounting had been papering over, and the first pass
        // re-derived the floors DOWNWARD to match (services branch 72 -> 66,
        // utils branch 80 -> 70). That was the wrong direction: a floor exists
        // to catch untested code, so lowering it to fit newly-visible untested
        // code retires the check. The gaps were real and are now tested:
        //   - numbersManager's eight AppleScript-backed methods (formulas,
        //     styles, column width / row height, merge / unmerge) were shipped
        //     tools with no unit test at all — eight uncovered functions;
        //   - the `if (result.error) throw` arm of thirteen sidecar-backed
        //     methods had never been driven with a sidecar error;
        //   - ~20 optional-flag branches were only ever exercised one way;
        //   - python.ts's whole auto-bootstrap path (bootstrapVenv,
        //     setupScriptPath, bootstrapTimeoutMs, isTrueish, ensureReady's
        //     rebuild arm, runNumbersReader's missing-dep retry) was dark
        //     because autoSetupDisabled() short-circuits on VITEST. The gate
        //     exists so the suite never spawns a real pip install; the tests
        //     lift it deliberately with node:child_process mocked, so
        //     scripts/setup.sh is asserted about but never executed;
        //   - exportPath's APPLE_NUMBERS_MCP_EXTRA_ROOTS parser, the ENOTDIR
        //     walk-up case, dangling-leaf and cyclic symlinks;
        //   - the resource callbacks' String(err) arm in tools/.
        //
        // Three branches remain uncovered and are unreachable rather than
        // untested: python.ts's two `.split("\n").pop() ?? …` fallbacks (split
        // always yields at least one element, so pop() is never undefined), and
        // exportPath's `!lstatSync(p).isSymbolicLink()` arm, which needs
        // realpath to refuse a path lstat can still read as a non-symlink — a
        // TOCTOU race, not a state a test can hold still.
        //
        // The floors below are restored ABOVE their pre-bump values and
        // re-derived from the new measurement.
        "src/services/**/*.ts": { statements: 96, branches: 96, functions: 96, lines: 96 },
        "src/tools/**/*.ts": { statements: 95, branches: 96, functions: 96, lines: 95 },
        "src/utils/**/*.ts": { statements: 96, branches: 94, functions: 96, lines: 96 },
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
