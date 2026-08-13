/**
 * Guard B — the README `## Tool Reference` matches the advertised tool surface.
 *
 * Both directions, because a one-directional check misses half the drift:
 *   (i)  no advertised tool is undocumented (a new tool shipped without docs)
 *   (ii) no documented tool is absent from the server (a renamed/removed tool
 *        still sitting in the README)
 *
 * The truth comes from the BUILT server over stdio (initialize -> tools/list),
 * not from regexing src/index.ts: the wire is the contract a user actually sees,
 * and a tool can be registered in source yet fail to reach the wire.
 *
 * build/ availability in CI: `build/index.js` is git-tracked (see .gitignore's
 * `!build/` / `build/*` / `!build/index.js` re-includes), so it exists at
 * checkout, and `pnpm install --frozen-lockfile` additionally runs
 * prepare -> `pnpm run build` before any test step. There is deliberately no
 * skip-if-missing branch here — a missing bundle fails this suite loudly rather
 * than passing vacuously forever.
 *
 * Lives in the unit suite (vitest.config.ts) so the required `test (22)` /
 * `test (24)` contexts run it; this repo has no required integration context.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { REPO_ROOT, readDoc } from "./docSources.js";

const SERVER = join(REPO_ROOT, "build", "index.js");

/**
 * Tool names documented under `## Tool Reference` — that section only. The rest
 * of the README names tools in prose, workflows and cross-links, and counting
 * those would let a tool look "documented" because a usage example mentions it.
 *
 * One `####` heading may cover a symmetric pair (`rename-sheet` / `rename-table`),
 * so every backticked name in a heading counts.
 */
function documentedTools(): string[] {
  const lines = readDoc("README.md").split("\n");
  const start = lines.findIndex((l) => /^##\s+Tool Reference\s*$/.test(l));
  if (start < 0) {
    throw new Error("README.md has no `## Tool Reference` section");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \S/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const names: string[] = [];
  const headingsWithoutNames: string[] = [];
  for (let i = start + 1; i < end; i++) {
    if (!/^#### /.test(lines[i])) continue;
    const backticked = [...lines[i].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    if (backticked.length === 0) headingsWithoutNames.push(`README.md:${i + 1} ${lines[i]}`);
    names.push(...backticked);
  }
  if (headingsWithoutNames.length > 0) {
    // A heading the parser cannot read is a tool this guard would silently miss.
    throw new Error(
      `Tool Reference headings with no \`backticked\` tool name:\n${headingsWithoutNames.join("\n")}`
    );
  }
  return [...new Set(names)].sort();
}

describe("Guard B — README Tool Reference matches the advertised tool surface", () => {
  let advertised: string[] = [];
  let client: Client | undefined;

  beforeAll(async () => {
    expect(
      existsSync(SERVER),
      `${SERVER} is missing. It is git-tracked and rebuilt by prepare on install; run \`pnpm run build\`.`
    ).toBe(true);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      // Keep the handshake offline: never let the Python sidecar bootstrap a venv.
      env: { ...process.env, APPLE_NUMBERS_MCP_NO_AUTO_SETUP: "1" } as Record<string, string>,
    });
    client = new Client({ name: "tool-reference-guard", version: "0.0.0" });
    await client.connect(transport);
    advertised = (await client.listTools()).tools.map((t) => t.name).sort();
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("has a non-empty tool surface on both sides", () => {
    // Vacuity guards: deleting the Tool Reference section, or a server that
    // advertises nothing, must fail rather than trivially agree.
    expect(advertised.length, "the built server advertised no tools").toBeGreaterThan(0);
    expect(
      documentedTools().length,
      "README.md's `## Tool Reference` documents no tools"
    ).toBeGreaterThan(0);
  });

  it("documents every tool the server advertises", () => {
    const documented = new Set(documentedTools());
    const undocumented = advertised.filter((name) => !documented.has(name));
    expect(
      undocumented,
      `tools advertised by the server but missing from README.md's \`## Tool Reference\`: ${undocumented.join(", ")}`
    ).toEqual([]);
  });

  it("documents no tool the server does not advertise", () => {
    const live = new Set(advertised);
    const phantom = documentedTools().filter((name) => !live.has(name));
    expect(
      phantom,
      `tools documented in README.md's \`## Tool Reference\` that the server does not advertise (renamed or removed?): ${phantom.join(", ")}`
    ).toEqual([]);
  });
});
