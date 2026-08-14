/**
 * Filesystem boundary for caller-supplied paths.
 *
 * `export-table`, `create-spreadsheet` and `import-csv` are the tools that
 * touch files outside any sandbox: the first two WRITE wherever `outputPath` /
 * `path` points, and `import-csv` READS whatever `inputPath` names (and writes
 * its `outputPath`). Restrict all of that to a small set of roots so a confused
 * or prompt-injected agent can't scribble into system locations, app bundles,
 * or LaunchAgent directories — nor read a file outside the user's own space.
 * Mirrors apple-photos-mcp's utils/exportPath.ts and apple-mail-mcp's
 * ALLOWED_SAVE_ROOTS / isPathWithinAllowedRoots.
 *
 * This is a ROOT boundary only. It deliberately does not change overwrite
 * semantics: every one of these tools documents that an existing file at the
 * target path is overwritten, and the path is caller-supplied rather than
 * attacker-named (unlike an inbound mail attachment's filename), so refusing
 * to overwrite would break documented behaviour without closing this hole.
 *
 * @module utils/exportPath
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

/** Roots under which these tools are permitted to read and write. */
export const ALLOWED_EXPORT_ROOTS = [homedir(), "/tmp", "/private/tmp", "/Volumes"];

/** Human-readable rendering of the allowed roots for error messages. */
export const ALLOWED_EXPORT_ROOTS_TEXT = "your home directory, /tmp, /private/tmp, or /Volumes";

/**
 * Canonicalize with the platform call, not the JS emulation.
 *
 * `fs.realpathSync` resolves symlinks but preserves whatever casing the caller
 * supplied; only `fs.realpathSync.native` returns the true on-disk name. macOS
 * APFS is case-insensitive by default, so without the native call a root check
 * can be defeated by respelling one segment — `/private/TMP/x` and
 * `/private/tmp/x` name the same file but compare differently. Both the
 * candidate and the roots go through this, so the comparison is between two
 * true on-disk spellings; on a case-sensitive volume the respelling simply
 * does not exist and canonicalization throws.
 */
function canonicalize(path: string): string {
  return realpathSync.native(path);
}

/**
 * Allowed roots in BOTH their literal and their true on-disk spelling.
 *
 * The canonical form is what a canonicalized candidate is normally compared
 * against (`/tmp` really is `/private/tmp` on macOS). The literal form is kept
 * as well so a root that cannot be canonicalized — it does not exist on this
 * machine, or `/Volumes` on a Mac with nothing mounted — still authorizes the
 * paths under it rather than silently disappearing from the allowlist. Both
 * forms name the same directory, so keeping both cannot widen the boundary:
 * candidates are canonicalized before the comparison, and a canonical
 * candidate can only match a non-canonical root spelling by being that same
 * directory.
 */
function allowedRoots(): string[] {
  const roots: string[] = [];
  for (const root of ALLOWED_EXPORT_ROOTS) {
    if (!roots.includes(root)) roots.push(root);
    try {
      const canonical = canonicalize(root);
      if (!roots.includes(canonical)) roots.push(canonical);
    } catch {
      // A root that does not exist cannot authorize anything on its own; its
      // literal form is already in the list for the not-yet-created case.
    }
  }
  return roots;
}

/**
 * True if `resolvedPath` is one of the allowed roots or strictly inside one.
 *
 * Uses a path-segment boundary check rather than a bare `startsWith`, which
 * would let a sibling whose name merely shares the prefix slip through —
 * `/Volumes-evil` startsWith `/Volumes`, `/Users/robother` startsWith
 * `/Users/rob`. `resolvedPath` must already be absolute, normalized and
 * canonicalized (callers pass canonicalizeCandidate output).
 */
export function isPathWithinAllowedRoots(resolvedPath: string): boolean {
  return allowedRoots().some((root) => {
    const base = root.endsWith(sep) ? root.slice(0, -1) : root;
    return resolvedPath === base || resolvedPath.startsWith(base + sep);
  });
}

/** Expand a leading `~` / `~/` to the user's home directory (like the sidecar's expanduser). */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith(`~${sep}`) || p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve symlinks in `p` even when `p` itself doesn't exist yet (export and
 * import both CREATE their output): canonicalize the deepest EXISTING
 * ancestor, then re-append the not-yet-created remainder. This is what defeats
 * a symlink under an allowed root pointing outside it (e.g. /tmp/link -> /etc),
 * and also canonicalizes macOS's /tmp -> /private/tmp.
 */
export function canonicalizeCandidate(p: string): string {
  let existing = p;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    tail.unshift(basename(existing));
    existing = parent;
  }
  let real: string;
  try {
    real = canonicalize(existing);
  } catch {
    real = existing;
  }
  return tail.length ? join(real, ...tail) : real;
}

/**
 * Canonicalize a caller-supplied path (expand `~`, resolve `..` and symlinks)
 * and enforce the allowlist. Returns the canonical absolute path to hand to
 * the sidecar — validating and using the SAME path closes the gap where the
 * validated string and the file actually touched could differ.
 *
 * @param label how to name this path in the error ("Output path", "Input path").
 * @throws Error naming the allowed roots when the path falls outside them.
 */
export function resolveWithinAllowedRoots(path: string, label: string): string {
  const resolved = canonicalizeCandidate(resolve(expandTilde(path)));
  if (!isPathWithinAllowedRoots(resolved)) {
    throw new Error(
      `${label} "${path}" resolves to "${resolved}", which is outside the ` +
        `allowed roots (${ALLOWED_EXPORT_ROOTS_TEXT}). Choose a path under one of those roots.`
    );
  }
  return resolved;
}
