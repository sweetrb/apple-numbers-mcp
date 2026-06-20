import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Opt-in integration suite. Runs the real numbers-parser pipeline against the
// generated fixtures (test/fixtures/*.numbers). Invoked via
// `npm run test:integration`; kept out of the default `vitest run` so unit runs
// stay hermetic. The tests self-skip when fixtures/numbers-parser are absent.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/integration/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
