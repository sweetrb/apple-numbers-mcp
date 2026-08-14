/**
 * Regression tests for the filesystem boundary (src/utils/exportPath.ts).
 *
 * These run against the REAL filesystem — no fs mocks — because the whole
 * point of the guard is symlink resolution and true on-disk name canonicalization,
 * both of which a mock would fake away. Every fixture is built under `/tmp`,
 * which the policy ALLOWS, so a test that is meant to reach the boundary check
 * is not short-circuited by an earlier failure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  ALLOWED_EXPORT_ROOTS,
  ALLOWED_EXPORT_ROOTS_TEXT,
  isPathWithinAllowedRoots,
  canonicalizeCandidate,
  expandTilde,
  resolveWithinAllowedRoots,
} from "../../utils/exportPath.js";

// Fixtures live under /tmp (an allowed root), never under os.tmpdir() — on
// macOS that is /var/folders/… which is deliberately OUTSIDE the allowlist.
let tmpRoot: string;
let homeRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync("/tmp/apple-numbers-boundary-");
  homeRoot = mkdtempSync(join(homedir(), "apple-numbers-boundary-"));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(homeRoot, { recursive: true, force: true });
});

describe("exportPath allowlist", () => {
  it("names the roots it enforces", () => {
    expect(ALLOWED_EXPORT_ROOTS).toEqual([homedir(), "/tmp", "/private/tmp", "/Volumes"]);
    expect(ALLOWED_EXPORT_ROOTS_TEXT).toContain("/Volumes");
  });

  it("accepts an existing directory under /tmp and returns its canonical path", () => {
    const dest = join(tmpRoot, "out.csv");
    const resolved = resolveWithinAllowedRoots(dest, "Output path");
    expect(resolved).toBe(join(realpathSync.native(tmpRoot), "out.csv"));
    expect(isPathWithinAllowedRoots(resolved)).toBe(true);
  });

  it("accepts a path under the home directory, expanding ~", () => {
    const rel = `~/${basename(homeRoot)}/out.numbers`;
    const resolved = resolveWithinAllowedRoots(rel, "Output path");
    expect(resolved).toBe(join(realpathSync.native(homeRoot), "out.numbers"));
  });

  it("accepts a path whose parent directories do not exist yet", () => {
    const dest = join(tmpRoot, "not", "created", "yet.csv");
    expect(() => resolveWithinAllowedRoots(dest, "Output path")).not.toThrow();
  });

  it.each([
    ["/etc/passwd", "system config"],
    ["/Library/LaunchAgents/com.evil.plist", "a LaunchAgent"],
    ["/Applications/Numbers.app/Contents/evil.csv", "an app bundle"],
    ["/usr/local/bin/evil", "a binary directory"],
    ["/var/db/evil.csv", "a system database directory"],
  ])("rejects %s (%s)", (dest) => {
    expect(() => resolveWithinAllowedRoots(dest, "Output path")).toThrow(
      /outside the allowed roots/
    );
  });

  it("rejects an escape via .. even when the literal prefix is allowed", () => {
    expect(() => resolveWithinAllowedRoots("/tmp/../etc/passwd", "Output path")).toThrow(
      /outside the allowed roots/
    );
  });

  it("names the offending path AND the roots in the error", () => {
    expect(() => resolveWithinAllowedRoots("/etc/evil.csv", "Input path")).toThrow(
      /Input path "\/etc\/evil.csv" resolves to "\/(private\/)?etc\/evil.csv"/
    );
    expect(() => resolveWithinAllowedRoots("/etc/evil.csv", "Input path")).toThrow(
      /your home directory, \/tmp, \/private\/tmp, or \/Volumes/
    );
  });
});

describe("segment-boundary matching (a bare startsWith is not enough)", () => {
  it.each([
    "/Volumes-evil/loot.csv",
    "/tmpevil/loot.csv",
    "/private/tmpevil/loot.csv",
    `${homedir()}-evil/loot.csv`,
  ])("rejects sibling %s that merely shares an allowed root's prefix", (dest) => {
    expect(isPathWithinAllowedRoots(dest)).toBe(false);
    expect(() => resolveWithinAllowedRoots(dest, "Output path")).toThrow(
      /outside the allowed roots/
    );
  });

  it("accepts the root itself and true children of it", () => {
    expect(isPathWithinAllowedRoots("/private/tmp")).toBe(true);
    expect(isPathWithinAllowedRoots("/private/tmp/child")).toBe(true);
    expect(isPathWithinAllowedRoots(homedir())).toBe(true);
  });
});

describe("symlink resolution", () => {
  it("rejects a symlinked DIRECTORY under /tmp that points outside the roots", () => {
    const link = join(tmpRoot, "escape-dir");
    symlinkSync("/etc", link);
    expect(() => resolveWithinAllowedRoots(join(link, "evil.csv"), "Output path")).toThrow(
      /outside the allowed roots/
    );
  });

  it("rejects a symlinked FILE under /tmp whose target is outside the roots", () => {
    const link = join(tmpRoot, "escape-file.csv");
    symlinkSync("/etc/hosts", link);
    expect(() => resolveWithinAllowedRoots(link, "Input path")).toThrow(
      /outside the allowed roots/
    );
  });

  it("rejects a symlink chain that leaves the roots only at the second hop", () => {
    const first = join(tmpRoot, "hop1");
    const second = join(tmpRoot, "hop2");
    symlinkSync("/private/etc", second);
    symlinkSync(second, first);
    expect(() => resolveWithinAllowedRoots(join(first, "evil.csv"), "Output path")).toThrow(
      /outside the allowed roots/
    );
  });

  it("accepts a symlink that stays inside the roots, returning the resolved target", () => {
    const target = join(tmpRoot, "real-dir");
    mkdirSync(target);
    const link = join(tmpRoot, "inside-link");
    symlinkSync(target, link);
    const resolved = resolveWithinAllowedRoots(join(link, "out.csv"), "Output path");
    expect(resolved).toBe(join(realpathSync.native(target), "out.csv"));
  });
});

describe("native canonicalization (case-insensitive APFS)", () => {
  const caseInsensitive = existsSync("/PRIVATE/TMP");

  it("returns the TRUE on-disk spelling for a respelled path segment", () => {
    if (!caseInsensitive) return; // case-sensitive volume: the respelling does not exist
    const dir = join(tmpRoot, "CaseDir");
    mkdirSync(dir);
    writeFileSync(join(dir, "data.csv"), "a,b\n");
    // Same file, respelled — opens fine on APFS, and only realpathSync.native
    // reports it back under its real name. Plain fs.realpathSync preserves the
    // caller's casing, which lets one spelling of a path compare differently
    // from another spelling of the very same file.
    const respelled = join(tmpRoot, "CASEDIR", "data.csv");
    expect(existsSync(respelled)).toBe(true);
    const resolved = resolveWithinAllowedRoots(respelled, "Input path");
    expect(resolved).toBe(join(realpathSync.native(dir), "data.csv"));
    expect(resolved).not.toContain("CASEDIR");
  });

  it("still rejects a respelled path outside the roots", () => {
    expect(() => resolveWithinAllowedRoots("/ETC/passwd", "Input path")).toThrow(
      /outside the allowed roots/
    );
  });
});

describe("helpers", () => {
  it("expandTilde only expands a leading ~ segment", () => {
    expect(expandTilde("~")).toBe(homedir());
    expect(expandTilde("~/a")).toBe(join(homedir(), "a"));
    expect(expandTilde("~notme/a")).toBe("~notme/a");
    expect(expandTilde("/tmp/~/a")).toBe("/tmp/~/a");
  });

  it("canonicalizeCandidate re-appends the not-yet-created remainder", () => {
    const p = join(tmpRoot, "a", "b", "c.csv");
    expect(canonicalizeCandidate(p)).toBe(join(realpathSync.native(tmpRoot), "a", "b", "c.csv"));
  });
});
