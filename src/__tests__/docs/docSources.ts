/**
 * Shared plumbing for the documentation-truth guards (docs-examples.test.ts,
 * tool-reference.test.ts).
 *
 * These guards exist because two doc defects shipped to users unnoticed: a
 * README whose escaping instructions were wrong in every example, and a CLAUDE.md
 * that kept describing behaviour the code had stopped implementing. Nothing
 * mechanical compared the prose to reality. This module supplies that comparison
 * — it only READS files off disk, so it belongs in the unit suite (vitest.config.ts,
 * required contexts `test (22)` / `test (24)`), not the opt-in integration one.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Repo root: this file lives at <root>/src/__tests__/docs/. */
export const REPO_ROOT = resolve(__dirname, "../../..");

/**
 * This directory. Excluded from the src/ corpus below so the guards can never
 * vouch for themselves: an environment variable named ONLY inside a guard is
 * documented-but-unimplemented, and must still fail.
 */
const GUARD_DIR = "src/__tests__/docs";

/** README.md, CLAUDE.md and every docs/*.md — the files a user actually reads. */
export function docFiles(): string[] {
  const out = ["README.md", "CLAUDE.md"];
  for (const name of readdirSync(join(REPO_ROOT, "docs")).sort()) {
    if (name.endsWith(".md")) out.push(`docs/${name}`);
  }
  return out;
}

export function readDoc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

export interface Fence {
  /** Repo-relative path of the containing document. */
  file: string;
  /** 1-based line number of the opening fence. */
  line: number;
  /** Lowercased first word of the info string ("json", "bash", "" when untagged). */
  lang: string;
  /** Fence content, dedented by the opening fence's own indentation. */
  body: string;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * CommonMark-ish fenced-block scanner. Handles indented fences (list items),
 * tilde fences, and long fences — a closing fence must use the same character,
 * be at least as long, and carry no info string.
 */
export function fencesIn(rel: string): Fence[] {
  const lines = readDoc(rel).split("\n");
  const out: Fence[] = [];
  let open: { marker: string; indent: number; lang: string; line: number; body: string[] } | null =
    null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = FENCE_RE.exec(raw);
    if (open) {
      const closes =
        m !== null &&
        m[2][0] === open.marker[0] &&
        m[2].length >= open.marker.length &&
        m[3].trim() === "";
      if (closes) {
        out.push({ file: rel, line: open.line, lang: open.lang, body: open.body.join("\n") });
        open = null;
      } else {
        const leading = raw.length - raw.trimStart().length;
        open.body.push(raw.slice(Math.min(open.indent, leading)));
      }
      continue;
    }
    if (m) {
      open = {
        marker: m[2],
        indent: m[1].length,
        lang: m[3]
          .trim()
          .split(/[\s,{]/)[0]
          .toLowerCase(),
        line: i + 1,
        body: [],
      };
    }
  }
  // An unterminated fence swallows the rest of the document, which would silently
  // shrink everything these guards inspect. Surface it rather than absorb it.
  if (open) throw new Error(`${rel}:${open.line}: unterminated code fence`);
  return out;
}

export function allFences(): Fence[] {
  return docFiles().flatMap(fencesIn);
}

/**
 * A token as written in prose. The trailing `_*` is deliberate: docs legitimately
 * name a FAMILY of variables by its prefix, and a prefix is validated against the
 * real names rather than special-cased by string.
 */
const DOC_ENV_TOKEN_RE = /APPLE_[A-Z0-9]+_MCP_[A-Z0-9_]*/g;

/** A complete variable name: underscore-joined segments, no trailing underscore. */
const SRC_ENV_NAME_RE = /APPLE_[A-Z0-9]+_MCP(?:_[A-Z0-9]+)+/g;

export interface DocEnvToken {
  token: string;
  /** "file:line" sites where the token appears. */
  where: string[];
}

export function envTokensInDocs(): DocEnvToken[] {
  const sites = new Map<string, string[]>();
  for (const rel of docFiles()) {
    const lines = readDoc(rel).split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const match of lines[i].match(DOC_ENV_TOKEN_RE) ?? []) {
        const at = `${rel}:${i + 1}`;
        const list = sites.get(match) ?? [];
        if (!list.includes(at)) list.push(at);
        sites.set(match, list);
      }
    }
  }
  return [...sites.entries()]
    .map(([token, where]) => ({ token, where }))
    .sort((a, b) => a.token.localeCompare(b.token));
}

/** Every file under src/, minus this guard directory. */
function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, rel)).sort()) {
      const child = `${rel}/${entry}`;
      if (statSync(join(REPO_ROOT, child)).isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk("src");
  return out.filter((f) => !f.startsWith(`${GUARD_DIR}/`));
}

/**
 * `const X = "APPLE_..._MCP"` — the prefix-constant idiom. Source builds most
 * variable names as `process.env[`${X}_SUFFIX`]`, so the full name never appears
 * as a literal anywhere in src/. Resolving the constant generically is what lets
 * this guard see those names without hardcoding the ones that exist today.
 */
const PREFIX_CONST_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*["'`](APPLE_[A-Z0-9]+_MCP)["'`]/g;

function expandPrefixConstants(corpus: string): string {
  let expanded = corpus;
  for (const m of corpus.matchAll(PREFIX_CONST_RE)) {
    expanded = expanded.split("${" + m[1] + "}").join(m[2]);
  }
  return expanded;
}

/** Every APPLE_*_MCP_* variable name the source actually knows about. */
export function knownEnvVars(): Set<string> {
  const corpus = srcFiles()
    .map((f) => readFileSync(join(REPO_ROOT, f), "utf8"))
    .join("\n");
  return new Set(expandPrefixConstants(corpus).match(SRC_ENV_NAME_RE) ?? []);
}

/**
 * Doc tokens with nothing behind them in src/. A token is backed when it names a
 * real variable, or when it is a strict prefix of one (the family-name case).
 */
export function unbackedEnvTokens(): DocEnvToken[] {
  const known = [...knownEnvVars()];
  return envTokensInDocs().filter(
    ({ token }) =>
      !known.some(
        (name) => name === token || (name.startsWith(token) && name.length > token.length)
      )
  );
}
