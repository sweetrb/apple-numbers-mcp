/**
 * Guard A — every documented example is real.
 *
 *   (a) every fenced ```json block in README.md, CLAUDE.md and docs/*.md parses
 *       as JSON. A malformed config example actively breaks the user who copies
 *       it into claude_desktop_config.json.
 *   (b) every APPLE_*_MCP_* variable the docs name exists in src/. This catches a
 *       doc still advertising a renamed or deleted knob.
 *
 * Deliberate NON-json snippets (fragments, ellipses) must be retagged ```jsonc or
 * ```text so the fence is honest — never allowlisted here, which is how a guard
 * turns decorative.
 *
 * Reads files off disk; no server, no Python, no network. Lives in the unit suite
 * so the required `test (22)` / `test (24)` contexts run it.
 */
import { describe, expect, it } from "vitest";
import { allFences, envTokensInDocs, knownEnvVars, unbackedEnvTokens } from "./docSources.js";

describe("Guard A(a) — documented JSON examples parse", () => {
  const jsonFences = allFences().filter((f) => f.lang === "json");

  it("has json fences to check at all", () => {
    // Vacuity guard: retagging every fence to make this suite pass must fail here.
    expect(
      jsonFences.length,
      "no ```json fences found in README.md / CLAUDE.md / docs/*.md — either the " +
        "fence scanner broke or every example was retagged away"
    ).toBeGreaterThan(0);
    expect(
      jsonFences.filter((f) => f.file === "README.md").length,
      "README.md is the published doc and carries the host config examples — it must contribute at least one ```json fence"
    ).toBeGreaterThan(0);
  });

  it("every ```json fence in the docs is valid JSON", () => {
    const broken: string[] = [];
    for (const fence of jsonFences) {
      try {
        JSON.parse(fence.body);
      } catch (err) {
        broken.push(`${fence.file}:${fence.line} — ${(err as Error).message}`);
      }
    }
    expect(
      broken,
      `malformed \`\`\`json examples (fix the JSON, or retag the fence \`\`\`jsonc / \`\`\`text if it is a deliberate fragment):\n${broken.join("\n")}`
    ).toEqual([]);
  });
});

describe("Guard A(b) — documented environment variables exist in src/", () => {
  it("finds env-var tokens in the docs and real names in src/", () => {
    // Vacuity guard: an empty corpus on either side would make the check below
    // pass on nothing at all.
    expect(envTokensInDocs().length, "no APPLE_*_MCP_* tokens found in the docs").toBeGreaterThan(
      0
    );
    expect(knownEnvVars().size, "no APPLE_*_MCP_* variable names found in src/").toBeGreaterThan(0);
  });

  it("every environment variable named in the docs exists in src/", () => {
    const unbacked = unbackedEnvTokens();
    const detail = unbacked.map((t) => `${t.token} (docs: ${t.where.join(", ")})`);
    expect(
      detail,
      `documented environment variables with no counterpart in src/ — either the doc names a renamed/deleted knob, or the variable was never implemented:\n${detail.join("\n")}`
    ).toEqual([]);
  });
});
