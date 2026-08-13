/**
 * outputSchema contract — belt-and-suspenders for the registerTool/outputSchema
 * migration. Boots the REAL built server over stdio and verifies the MCP
 * output-schema guarantees end-to-end through the SDK:
 *
 *   1. every tool advertises an outputSchema (none slipped back to plain server.tool)
 *   2. every outputSchema is permissive — no required fields — so the SDK's
 *      structuredContent validation can never reject a valid success result for a
 *      conditionally-absent field
 *   3. the diagnostic tools round-trip without a validation rejection. The SDK's
 *      validateToolOutput (server mcp.js) THROWS McpError when a success result's
 *      structuredContent is missing or fails the schema, which rejects callTool —
 *      so a resolving call proves a real payload validates against its schema.
 *      (Environment failures return isError results, which the SDK exempts.)
 *   4. every advertised schema declares the JSON Schema 2020-12 dialect and uses
 *      no draft-07-only construct — a client rejects EVERY tool otherwise
 *      (sweetrb/apple-mail-mcp#147)
 *   5. every advertised schema actually COMPILES under a real 2020-12 validator
 *      (ajv, the same library the MCP SDK validates with). Declaring the dialect
 *      is not the same as being valid in it.
 *
 * Needs no .numbers file, so it always runs (including CI). The Python sidecar
 * auto-bootstrap is disabled so the diagnostic round-trip stays fast and offline.
 * Requires build/ — `npm ci` runs prepare→build and test:integration runs after
 * the build in CI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Ajv2020Import from "ajv/dist/2020.js";

// ajv ships CJS: its 2020 entry sets `module.exports = Ajv2020` and *also*
// `module.exports.default = Ajv2020`. Node's ESM→CJS interop hands us the former,
// a loader that honours `__esModule` hands us the latter. Accept either rather
// than betting on one, because the wrong guess is a runtime-only TypeError that
// typechecking cannot see.
const Ajv2020 = ((Ajv2020Import as { default?: typeof Ajv2020Import }).default ??
  Ajv2020Import) as typeof Ajv2020Import;

// ajv must be a DIRECT devDependency: it reaches the tree only transitively via
// @modelcontextprotocol/sdk, and pnpm's strict node_modules layout makes a
// transitive package unimportable.

const SERVER = resolve(__dirname, "../../../build/index.js");

// The keys of a `properties` map are caller-chosen TOOL PARAMETER NAMES, not
// schema keywords, and enum/const/default hold instance DATA. Re-enter only
// genuine subschema positions — the same distinction the normalizer itself
// makes (see src/utils/jsonSchemaDialect.ts).
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "$defs", "dependentSchemas"];
const DATA_KEYWORDS = ["enum", "const", "default", "examples", "required", "dependentRequired"];

/** Re-enter only the subschema positions of `obj`, reporting each via `visit`. */
function walkSubschemas(
  obj: Record<string, unknown>,
  path: string,
  visit: (node: unknown, path: string) => void
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (DATA_KEYWORDS.includes(key)) continue;
    if (SCHEMA_MAP_KEYWORDS.includes(key)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
          visit(sub, `${path}.${key}.${name}`);
        }
      }
      continue;
    }
    visit(value, `${path}.${key}`);
  }
}

describe("outputSchema contract (real server over stdio)", () => {
  let client: Client;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      env: { ...process.env, APPLE_NUMBERS_MCP_NO_AUTO_SETUP: "1" } as Record<string, string>,
    });
    client = new Client({ name: "outputschema-contract-test", version: "0.0.0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("registers tools, and every tool advertises an outputSchema", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const missing = tools.filter((t) => !t.outputSchema).map((t) => t.name);
    expect(missing, `tools missing an outputSchema: ${missing.join(", ")}`).toEqual([]);
  });

  it("every outputSchema is permissive — no required fields", async () => {
    const { tools } = await client.listTools();
    const offenders = tools
      .filter((t) => {
        const req = (t.outputSchema as { required?: unknown } | undefined)?.required;
        return Array.isArray(req) && req.length > 0;
      })
      .map(
        (t) =>
          `${t.name}: requires [${(t.outputSchema as { required: string[] }).required.join(", ")}]`
      );
    expect(
      offenders,
      `outputSchemas must not require fields (a missing field would reject a valid result): ${offenders.join("; ")}`
    ).toEqual([]);
  });

  it("every outputSchema tolerates undeclared keys (additionalProperties !== false)", async () => {
    // The CLIENT validates structuredContent against the ADVERTISED JSON Schema
    // (client/index.js -> "Structured content does not match the tool's output
    // schema"), so `additionalProperties: false` makes any field the schema
    // didn't enumerate a hard -32602 that discards an otherwise-correct result.
    // The server never notices, because zod's own parse strips unknown keys
    // instead of failing — so nothing but this assertion catches it. A bare zod
    // raw shape renders as additionalProperties:false; registerTool() in
    // src/index.ts wraps every shape in .passthrough() to prevent that.
    // Not hypothetical: this took down get-mail-stats in the sibling
    // apple-mail-mcp (sweetrb/apple-mail-mcp#135).
    const { tools } = await client.listTools();
    const offenders = tools
      .filter(
        (t) =>
          (t.outputSchema as { additionalProperties?: unknown } | undefined)
            ?.additionalProperties === false
      )
      .map((t) => t.name);
    expect(
      offenders,
      `outputSchemas must tolerate undeclared keys — these advertise ` +
        `additionalProperties:false, so any field they don't enumerate is rejected ` +
        `client-side and the whole result is lost: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("every advertised schema declares JSON Schema 2020-12, with no draft-07 construct", async () => {
    // MCP standardized on JSON Schema 2020-12; a client rejects every tool when
    // the server advertises another dialect:
    //   Tool '<name>' has an invalid outputSchema: JSON Schema declares an
    //   unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#").
    // The SDK calls its Zod converter without a target, so it emits draft-07
    // regardless of the Zod major — src/utils/jsonSchemaDialect.ts normalizes the
    // outgoing tools/list at the transport boundary. This asserts the schemas the
    // server ACTUALLY advertises, which is the only thing the client sees.
    // Origin: sweetrb/apple-mail-mcp#135's sibling report, sweetrb/apple-mail-mcp#147.
    const { tools } = await client.listTools();
    const EXPECTED = "https://json-schema.org/draft/2020-12/schema";
    // Keywords that exist only in the older drafts. `definitions`/`dependencies`
    // are still *parseable* under 2020-12 but carry no meaning there, so a schema
    // emitting them is silently losing its constraints.
    const LEGACY_KEYWORDS = ["definitions", "dependencies", "additionalItems"];

    const offenders: string[] = [];
    for (const tool of tools) {
      for (const [kind, schema] of [
        ["inputSchema", tool.inputSchema],
        ["outputSchema", tool.outputSchema],
      ] as const) {
        if (!schema) continue;
        const declared = (schema as { $schema?: unknown }).$schema;
        if (declared !== EXPECTED) {
          offenders.push(`${tool.name}.${kind}: $schema is ${JSON.stringify(declared)}`);
        }
        if (JSON.stringify(schema).includes("draft-07")) {
          offenders.push(`${tool.name}.${kind}: contains a draft-07 reference`);
        }

        // Walk schema POSITIONS, not raw text: a substring scan false-flags a
        // tool that legitimately has a parameter NAMED "definitions", since the
        // keys of a `properties` map are caller-chosen names, not keywords.
        const walk = (node: unknown, path: string): void => {
          if (Array.isArray(node)) {
            node.forEach((child, i) => walk(child, `${path}[${i}]`));
            return;
          }
          if (typeof node !== "object" || node === null) return;
          const obj = node as Record<string, unknown>;

          for (const keyword of LEGACY_KEYWORDS) {
            if (keyword in obj) {
              offenders.push(
                `${tool.name}.${kind}: draft-07-only "${keyword}" at ${path || "root"}`
              );
            }
          }
          if (Array.isArray(obj.items)) {
            offenders.push(`${tool.name}.${kind}: tuple-form "items" at ${path || "root"}`);
          }
          for (const k of ["exclusiveMinimum", "exclusiveMaximum"] as const) {
            if (typeof obj[k] === "boolean") {
              offenders.push(`${tool.name}.${kind}: boolean ${k} at ${path || "root"}`);
            }
          }
          if (typeof obj.$ref === "string" && obj.$ref.startsWith("#/definitions/")) {
            offenders.push(`${tool.name}.${kind}: $ref into #/definitions/ (now #/$defs/)`);
          }
          // Only the ROOT may declare a dialect.
          if (path !== "" && "$schema" in obj) {
            offenders.push(`${tool.name}.${kind}: nested $schema at ${path}`);
          }

          walkSubschemas(obj, path, walk);
        };
        walk(schema as Record<string, unknown>, "");
      }
    }

    expect(
      offenders,
      `every advertised schema must declare ${EXPECTED} and use no draft-07-only ` +
        `construct — clients reject the whole tool otherwise: ${offenders.join("; ")}`
    ).toEqual([]);
  });

  it("every advertised schema compiles under a real JSON Schema 2020-12 validator", async () => {
    // The dialect assertion above checks the *label* we print on the schema; this
    // one checks the schema is actually valid in that dialect. Both are needed:
    // a schema can declare 2020-12 and still be structurally broken (a bad `type`,
    // a malformed `pattern`, a dangling `$ref`), and a client that refuses to
    // compile it drops the tool just as completely as a wrong `$schema` does.
    //
    // ajv is the validator the MCP SDK itself uses, so "compiles here" is the
    // closest local proxy for "the ecosystem accepts it" — the class of bug the
    // draft-07 incident (sweetrb/apple-mail-mcp#147) exposed: a thorough suite
    // that asserted our own behaviour and never our contract with the ecosystem.
    //
    // strict:false on purpose — strict mode rejects unknown/benign annotation
    // keywords, which is ajv's style opinion, not a validity question. And no
    // ajv-formats: no advertised schema uses the `format` KEYWORD (the six
    // `format` occurrences here are tool parameters NAMED "format", i.e. keys of
    // a `properties` map — not keywords). Note this test would NOT tell you if
    // one appeared: under strict:false ajv logs `unknown format ... ignored` to
    // stderr and compiles successfully. So a real `format` would go unvalidated
    // silently — register ajv-formats when introducing one.
    const { tools } = await client.listTools();
    const failures: string[] = [];

    for (const tool of tools) {
      for (const [kind, schema] of [
        ["inputSchema", tool.inputSchema],
        ["outputSchema", tool.outputSchema],
      ] as const) {
        if (!schema) continue;
        // A fresh instance per schema: ajv caches by $id/$ref, so one shared
        // instance could let a later schema resolve a ref only because an
        // earlier one happened to define it.
        const ajv = new Ajv2020({ strict: false });
        try {
          ajv.compile(schema as object);
        } catch (err) {
          failures.push(`${tool.name}.${kind}: ${(err as Error).message}`);
        }
      }
    }

    expect(
      failures,
      `every advertised schema must compile under JSON Schema 2020-12 — a client ` +
        `that cannot compile it refuses the whole tool: ${failures.join("; ")}`
    ).toEqual([]);
  });

  it("the 2020-12 validator itself has teeth (control)", () => {
    // Guards the test above against passing vacuously — e.g. if the ajv import
    // resolved to something that isn't a validator, or options silenced every
    // diagnostic. A schema with a bogus `type` must be rejected.
    const ajv = new Ajv2020({ strict: false });
    expect(() =>
      ajv.compile({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { broken: { type: "not-a-json-schema-type" } },
      })
    ).toThrow(/schema is invalid/i);
  });

  it("diagnostic tools' real output validates against their outputSchema (when reachable)", async () => {
    // The SDK throws an "Output validation error" McpError when a success
    // result's structuredContent is missing or fails its schema — the only
    // failure we treat as a bug. A slow or unavailable backend (e.g. AppleScript
    // timing out on a headless CI runner) is tolerated, not failed.
    for (const name of ["health-check", "doctor"]) {
      const call = client.callTool({ name, arguments: {} });
      try {
        await Promise.race([
          call,
          new Promise((resolve) => setTimeout(() => resolve(undefined), 8000)),
        ]);
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? err);
        if (/output validation error|invalid structured content/i.test(msg)) throw err;
        // otherwise: environment/transport error — the tool couldn't run here
      }
      // Swallow any late rejection (e.g. when the client closes mid-call).
      void Promise.resolve(call).catch(() => {});
    }
  }, 30_000);
});
