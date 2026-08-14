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
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Roots under which these tools are permitted to read and write. */
export const ALLOWED_EXPORT_ROOTS = [
  homedir(),
  // os.tmpdir() is the canonical per-user temp dir on macOS (/var/folders/<hash>/T,
  // real path /private/var/folders/...). It is what Node's os.tmpdir(), Python's
  // tempfile and $TMPDIR all return — and what this repo's own fixtures use — so
  // omitting it refuses the most ordinary scratch destination there is.
  tmpdir(),
  "/private/var/folders",
  "/tmp",
  "/private/tmp",
  "/Volumes",
];

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
/**
 * True if the path itself is present, WITHOUT following a final symlink.
 *
 * `existsSync` follows links, so it answers "false" for a dangling symlink —
 * which would let the walk-up below treat that link as a not-yet-created tail
 * component, re-append it verbatim, and never canonicalize it. The sidecar then
 * follows the link and writes outside the allowed roots. `lstat` sees the link
 * itself. Only ENOENT/ENOTDIR mean genuinely absent; any other error (EACCES on
 * a non-traversable parent) is treated as PRESENT so the walk stops there and
 * the boundary check runs against something real rather than walking past it.
 */
function entryPresent(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return !(code === "ENOENT" || code === "ENOTDIR");
  }
}

export function canonicalizeCandidate(p: string, depth = 0): string {
  // Symlink chains are bounded so a cycle cannot spin here.
  if (depth > 32) throw new Error(`Too many symbolic links resolving "${p}"`);
  let existing = p;
  const tail: string[] = [];
  while (!entryPresent(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    tail.unshift(basename(existing));
    existing = parent;
  }
  let real: string;
  try {
    real = canonicalize(existing);
  } catch {
    // `existing` is present per lstat but will not canonicalize. The usual cause
    // is a DANGLING symlink: realpath throws ENOENT because the target does not
    // exist YET — but a write through this path creates exactly that target, so
    // falling back to the raw path here would hand the boundary check a location
    // the write is not going to touch. Resolve the link by hand against its
    // parent's real path and re-run, so the check sees where bytes actually land.
    const viaLink = resolveDanglingLink(existing, depth);
    if (viaLink !== null) {
      return canonicalizeCandidate(tail.length ? join(viaLink, ...tail) : viaLink, depth + 1);
    }
    real = existing;
  }
  return tail.length ? join(real, ...tail) : real;
}

/** The target of a symlink that realpath refused, or null if it is not a link. */
function resolveDanglingLink(p: string, depth: number): string | null {
  try {
    if (!lstatSync(p).isSymbolicLink()) return null;
    const target = readlinkSync(p);
    if (isAbsolute(target)) return target;
    return resolve(canonicalizeCandidate(dirname(p), depth + 1), target);
  } catch {
    return null;
  }
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
