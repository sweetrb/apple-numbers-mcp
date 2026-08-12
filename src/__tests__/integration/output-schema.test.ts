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
