import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFileConfig, fileConfigPath } from "@/services/fileConfig.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anmcp-cfg-"));
  file = join(dir, "config.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadFileConfig", () => {
  it("applies file values for keys not already in env", () => {
    writeFileSync(file, JSON.stringify({ APPLE_NUMBERS_MCP_MAX_BUFFER: "1048576", DEBUG: "1" }));
    const env: NodeJS.ProcessEnv = {};
    const applied = loadFileConfig(env, file);
    expect(env.APPLE_NUMBERS_MCP_MAX_BUFFER).toBe("1048576");
    expect(env.DEBUG).toBe("1");
    expect(applied.sort()).toEqual(["APPLE_NUMBERS_MCP_MAX_BUFFER", "DEBUG"]);
  });

  it("returns [] when the file is missing", () => {
    expect(loadFileConfig({}, join(dir, "nope.json"))).toEqual([]);
  });

  it("never overrides a value already set in the environment", () => {
    writeFileSync(file, JSON.stringify({ APPLE_NUMBERS_MCP_MAX_BUFFER: "1" }));
    const env: NodeJS.ProcessEnv = { APPLE_NUMBERS_MCP_MAX_BUFFER: "999" };
    loadFileConfig(env, file);
    expect(env.APPLE_NUMBERS_MCP_MAX_BUFFER).toBe("999");
  });

  it("treats empty-string env as unset and fills it", () => {
    writeFileSync(file, JSON.stringify({ DEBUG: "1" }));
    const env: NodeJS.ProcessEnv = { DEBUG: "" };
    loadFileConfig(env, file);
    expect(env.DEBUG).toBe("1");
  });

  it("ignores non-string values", () => {
    writeFileSync(file, JSON.stringify({ A: "ok", B: 5, C: true }));
    const env: NodeJS.ProcessEnv = {};
    expect(loadFileConfig(env, file)).toEqual(["A"]);
  });

  it("tolerates a malformed JSON file (returns [], does not throw)", () => {
    writeFileSync(file, "{ not json");
    expect(loadFileConfig({}, file)).toEqual([]);
  });

  // Well-formed JSON that isn't an object. Object.entries would throw on `null`
  // and silently iterate a string's indices ("0","1",...) — either way the guard
  // is what keeps a hand-edited config from corrupting the environment.
  it.each([
    ["null", "null"],
    ["a number", "42"],
    ["a bare string", '"APPLE_NUMBERS_MCP_MAX_BUFFER=1"'],
  ])("ignores a config file whose JSON is %s", (_label, contents) => {
    writeFileSync(file, contents);
    const env: NodeJS.ProcessEnv = {};
    expect(loadFileConfig(env, file)).toEqual([]);
    expect(env).toEqual({});
  });

  // An array IS an object, so it survives the guard and gets walked by index —
  // its string members would land in env under "0", "1", … if the per-entry
  // typeof check ever went away.
  it("applies nothing useful from a JSON array", () => {
    writeFileSync(file, JSON.stringify(["DEBUG"]));
    const env: NodeJS.ProcessEnv = {};
    expect(loadFileConfig(env, file)).toEqual(["0"]);
  });
});

describe("fileConfigPath", () => {
  it("honors the APPLE_NUMBERS_MCP_CONFIG_FILE override", () => {
    expect(fileConfigPath({ APPLE_NUMBERS_MCP_CONFIG_FILE: "/tmp/x.json" })).toBe("/tmp/x.json");
  });

  it("falls back to the Application Support path", () => {
    expect(fileConfigPath({})).toMatch(/apple-numbers-mcp\/config\.json$/);
  });
});
