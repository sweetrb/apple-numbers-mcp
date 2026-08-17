/**
 * Every tool that opens a file must DOCUMENT the path boundary.
 *
 * A tool description is the only place an AI assistant learns a constraint
 * before it calls the tool. `apple-numbers-mcp` 1.2.0 bounded the `.numbers`
 * file itself to the allowed roots, but the descriptions still said nothing —
 * so 21 tools could refuse a path for a reason a caller had no way to
 * anticipate, and would discover as a runtime failure.
 *
 * This reads `src/index.ts` as TEXT rather than importing it: importing opens a
 * stdio transport. Crude, and that is fine — it is a conformance check on the
 * source, not a behavioural test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts"), "utf8");

/** Every registerTool block, keyed by tool name. */
function toolBlocks(): { name: string; body: string }[] {
  const re = /registerTool\(\s*"([a-z-]+)"/g;
  const found: { name: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) found.push({ name: m[1], start: m.index });
  return found.map((f, i) => ({
    name: f.name,
    body: src.slice(f.start, i + 1 < found.length ? found[i + 1].start : src.length),
  }));
}

describe("tool descriptions document the path boundary", () => {
  const blocks = toolBlocks();

  it("finds the tools at all (guards the parser itself)", () => {
    expect(blocks.length).toBeGreaterThan(20);
    expect(blocks.map((b) => b.name)).toContain("read-table");
  });

  it("every tool taking a file path documents the boundary", () => {
    const takesPath = blocks.filter((b) => /\b(path|inputPath|filePath):\s*z\./.test(b.body));
    expect(takesPath.length).toBeGreaterThan(20);

    const undocumented = takesPath
      .filter((b) => !/PATH_BOUNDARY_NOTE|allowed roots|home directory/.test(b.body))
      .map((b) => b.name);

    // Named explicitly so a failure says WHICH tool, not just a count.
    expect(undocumented).toEqual([]);
  });

  it("the shared note names the roots and the escape hatch", () => {
    // Line-based, not a `…*?;` regex: the note itself contains a semicolon
    // ("…/Volumes; anything else…"), which truncates a non-greedy capture and
    // makes this assertion pass or fail for the wrong reason.
    const lines = src.split("\n");
    const at = lines.findIndex((l) => l.includes("const PATH_BOUNDARY_NOTE"));
    expect(at).toBeGreaterThan(-1);
    const note = lines.slice(at, at + 3).join("\n");
    expect(note).toMatch(/ALLOWED_EXPORT_ROOTS_TEXT/);
    expect(note).toMatch(/EXTRA_ROOTS_ENV/);
    // Interpolated, not hand-copied — a literal list here would drift silently
    // the moment the roots changed.
    expect(note).not.toMatch(/\/private\/tmp/);
  });
});
