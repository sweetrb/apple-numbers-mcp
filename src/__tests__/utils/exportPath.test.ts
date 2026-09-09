/**
 * Regression tests for the filesystem boundary (src/utils/exportPath.ts).
 *
 * These run against the REAL filesystem — no fs mocks — because the whole
 * point of the guard is symlink resolution and true on-disk name canonicalization,
 * both of which a mock would fake away. Every fixture is built under `/tmp`,
 * which the policy ALLOWS, so a test that is meant to reach the boundary check
 * is not short-circuited by an earlier failure.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ALLOWED_EXPORT_ROOTS,
  ALLOWED_EXPORT_ROOTS_TEXT,
  EXTRA_ROOTS_ENV,
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
    expect(ALLOWED_EXPORT_ROOTS).toEqual([
      homedir(),
      tmpdir(),
      "/private/var/folders",
      "/tmp",
      "/private/tmp",
      "/Volumes",
    ]);
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

describe("dangling symlinks and the segment boundary (adversarial round 2)", () => {
  it("refuses a DANGLING symlink that points outside the allowed roots", () => {
    // existsSync FOLLOWS links, so a broken link reads as "does not exist" and the
    // walk-up would treat it as a not-yet-created tail component, re-append it
    // verbatim, and never canonicalize it — the sidecar then follows it on write.
    const dir = mkdtempSync(join(homedir(), ".np-dangling-"));
    try {
      const link = join(dir, "gone");
      symlinkSync("/private/var/tmp/np-does-not-exist-yet", link);
      expect(() => resolveWithinAllowedRoots(join(link, "out.csv"), "Output path")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a sibling directory whose name merely shares a root's prefix", () => {
    // The boundary must compare path SEGMENTS. A bare startsWith would admit all
    // of these while every other test in this file stayed green.
    for (const p of [
      "/Volumes-evil/out.csv",
      "/private/tmp-evil/out.csv",
      "/private/var/folders-evil/out.csv",
      `${homedir()}other/out.csv`,
    ]) {
      expect(() => resolveWithinAllowedRoots(p, "Output path")).toThrow(/outside/i);
    }
  });

  it("still accepts the canonical macOS temp dir that os.tmpdir() returns", () => {
    // $TMPDIR is /var/folders/<hash>/T — the most ordinary scratch destination
    // there is, and what this repo's own fixtures use.
    const f = join(tmpdir(), "np-ok.csv");
    expect(() => resolveWithinAllowedRoots(f, "Output path")).not.toThrow();
  });
});

/**
 * The opt-in extra roots. Nothing set APPLE_NUMBERS_MCP_EXTRA_ROOTS, so the
 * whole parser — the split/trim/filter pipeline and both of its predicates —
 * was dead in the coverage report while shipping as the documented escape
 * hatch for an unusual layout.
 */
describe("APPLE_NUMBERS_MCP_EXTRA_ROOTS", () => {
  // Deliberately a location the built-in roots do NOT cover, so a path under it
  // can only be admitted by the extra-roots parser. It need not exist:
  // isPathWithinAllowedRoots compares canonicalized strings, and a root that
  // cannot be canonicalized is still kept in its literal form.
  const extraRoot = "/opt/numbers-fixtures";
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[EXTRA_ROOTS_ENV];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[EXTRA_ROOTS_ENV];
    else process.env[EXTRA_ROOTS_ENV] = prev;
  });

  it("admits a path under a configured extra root", () => {
    process.env[EXTRA_ROOTS_ENV] = extraRoot;
    expect(isPathWithinAllowedRoots(`${extraRoot}/data/book.numbers`)).toBe(true);
    // and the root itself
    expect(isPathWithinAllowedRoots(extraRoot)).toBe(true);
  });

  it("does not admit a sibling that merely shares the extra root's prefix", () => {
    process.env[EXTRA_ROOTS_ENV] = extraRoot;
    expect(isPathWithinAllowedRoots(`${extraRoot}-evil/book.numbers`)).toBe(false);
  });

  it("splits on ':' and trims surrounding whitespace", () => {
    process.env[EXTRA_ROOTS_ENV] = ` ${extraRoot} : /opt/second `;
    expect(isPathWithinAllowedRoots(`${extraRoot}/a`)).toBe(true);
    expect(isPathWithinAllowedRoots("/opt/second/a")).toBe(true);
  });

  // A relative or empty entry must be dropped, not resolved against the
  // process cwd — that would widen the boundary to wherever the server happens
  // to have been started.
  it.each([
    ["an empty entry", "::", "/"],
    ["a relative entry", "relative/dir", "relative/dir"],
    ["a bare dot", ".", "."],
  ])("ignores %s", (_label, value, probe) => {
    process.env[EXTRA_ROOTS_ENV] = value;
    // Nothing new is admitted: the probe is judged only by the built-in roots.
    expect(isPathWithinAllowedRoots(probe)).toBe(false);
  });

  it("ignores the variable entirely when it is empty", () => {
    process.env[EXTRA_ROOTS_ENV] = "";
    expect(isPathWithinAllowedRoots("/opt/anything")).toBe(false);
  });

  // A root written with a trailing separator names the same directory; the
  // boundary strips it before comparing, so "/opt/x/" must not turn every
  // sibling of /opt/x into a match (nor stop /opt/x itself from matching).
  it("normalizes a trailing separator on an extra root", () => {
    process.env[EXTRA_ROOTS_ENV] = `${extraRoot}/`;
    expect(isPathWithinAllowedRoots(extraRoot)).toBe(true);
    expect(isPathWithinAllowedRoots(`${extraRoot}/book.numbers`)).toBe(true);
    expect(isPathWithinAllowedRoots(`${extraRoot}-evil/book.numbers`)).toBe(false);
  });
});

describe("canonicalizeCandidate edge cases", () => {
  it("stops walking up at a component that is a FILE, not a directory", () => {
    // lstat of "<regular file>/child" fails with ENOTDIR, not ENOENT. Both mean
    // "not present" for the walk; anything else (EACCES) must stop it instead.
    const file = join(tmpRoot, "plain.csv");
    writeFileSync(file, "a,b\n");
    const through = join(file, "child.csv");
    expect(canonicalizeCandidate(through)).toBe(
      join(realpathSync.native(tmpRoot), "plain.csv", "child.csv")
    );
  });

  it("resolves a DANGLING symlink that is itself the whole path", () => {
    // No trailing components: the link IS the candidate, so the resolved target
    // is returned directly rather than having a tail re-appended to it.
    const link = join(tmpRoot, "dangling-leaf.numbers");
    symlinkSync("/private/tmp/np-not-created-yet.numbers", link);
    expect(canonicalizeCandidate(link)).toBe("/private/tmp/np-not-created-yet.numbers");
  });

  it("terminates on a symlink CYCLE instead of spinning on it", () => {
    // a -> b -> a, both with RELATIVE targets so each hop is resolved by hand
    // against the link's parent. realpath throws ELOOP, so the hand-resolution
    // path takes over and would recurse forever without the depth cap. The cap
    // fires inside resolveDanglingLink's own try, so the caller does not see
    // "Too many symbolic links" — the walk simply gives up and hands back the
    // literal path, which is what the boundary check then judges. A cycle must
    // therefore still be unable to escape the roots.
    const a = join(tmpRoot, "loop-a");
    const b = join(tmpRoot, "loop-b");
    symlinkSync("loop-b", a);
    symlinkSync("loop-a", b);

    const resolved = canonicalizeCandidate(a);

    expect(resolved).toBe(join(realpathSync.native(tmpRoot), "loop-a"));
    expect(isPathWithinAllowedRoots(resolved)).toBe(true);
    expect(() => resolveWithinAllowedRoots(a, "Output path")).not.toThrow();
  });

  it("does not let a symlink cycle under an allowed root reach outside it", () => {
    // Same cycle, but the first hop points at /etc. The cycle must not become a
    // way to launder an out-of-roots destination past the check.
    const dir = join(tmpRoot, "cycle-escape");
    mkdirSync(dir);
    const a = join(dir, "a");
    const b = join(dir, "b");
    symlinkSync("/etc/hosts", b);
    symlinkSync("b", a);
    expect(() => resolveWithinAllowedRoots(a, "Input path")).toThrow(/outside the allowed roots/);
  });

  // A path that lstat can see but realpath refuses, and which is NOT a symlink,
  // must fall back to the literal path so the boundary check still runs against
  // something real rather than walking past it.
  it("falls back to the literal path when canonicalization is refused", () => {
    if (process.getuid?.() === 0) return; // root traverses regardless of mode
    const locked = join(tmpRoot, "locked");
    const inner = join(locked, "book.numbers");
    mkdirSync(locked);
    writeFileSync(inner, "");
    chmodSync(locked, 0o000);
    try {
      // lstat(inner) -> EACCES, which entryPresent treats as PRESENT; realpath
      // then fails too, and there is no symlink to resolve by hand.
      expect(canonicalizeCandidate(inner)).toBe(inner);
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});

/**
 * The walk-up's termination guard.
 *
 * `canonicalizeCandidate` climbs toward the root while nothing on the path is
 * present. On a working filesystem "/" always lstats, so the loop always stops
 * on something real and `parent === existing` never fires — which left the only
 * thing standing between a pathological filesystem and an infinite loop
 * untested. This is the one place in this file that mocks fs, and it mocks
 * exactly one call: `lstatSync`, so that NOTHING (not even "/") reads as
 * present. realpath stays real.
 */
describe("walk-up termination", () => {
  it("stops at the filesystem root instead of looping when nothing is present", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        lstatSync: () => {
          const e = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
          e.code = "ENOENT";
          throw e;
        },
      };
    });

    try {
      const fresh = await import("../../utils/exportPath.js");
      // Every component walks up to "/", where dirname("/") === "/" ends it.
      // The path is then reassembled from the real root plus the whole tail.
      expect(fresh.canonicalizeCandidate("/a/b/c.numbers")).toBe("/a/b/c.numbers");
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
