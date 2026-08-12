/**
 * Unit tests for the JSON Schema dialect normalizer.
 *
 * The MCP SDK stamps draft-07 onto every emitted inputSchema/outputSchema, and
 * clients now reject anything that is not 2020-12. These tests pin both halves
 * of the fix: the document-level conversion (keyword rewrites + a root-only
 * "$schema") and the transport seam that applies it to outgoing tools/list.
 */
import { describe, it, expect, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  JSON_SCHEMA_2020_12,
  toJsonSchema2020_12,
  normalizeOutgoingMessage,
  withJsonSchema2020_12,
} from "../../utils/jsonSchemaDialect.js";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

type JsonObject = Record<string, unknown>;

/** Convert a schema document, keeping the result loosely typed for assertions. */
const convert = (schema: JsonObject): JsonObject => toJsonSchema2020_12(schema);

describe("toJsonSchema2020_12", () => {
  it("stamps the 2020-12 dialect at the root", () => {
    const converted = convert({
      $schema: DRAFT_07,
      type: "object",
      properties: { path: { type: "string" } },
    });

    expect(converted.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(converted.$schema).toBe(JSON_SCHEMA_2020_12);
    // Everything else survives untouched.
    expect(converted.type).toBe("object");
    expect(converted.properties).toEqual({ path: { type: "string" } });
  });

  it("adds the dialect even when the source declared none", () => {
    expect(convert({ type: "string" })).toEqual({ $schema: JSON_SCHEMA_2020_12, type: "string" });
  });

  it("returns non-object inputs unchanged", () => {
    expect(toJsonSchema2020_12(undefined)).toBeUndefined();
    expect(toJsonSchema2020_12(null)).toBeNull();
    expect(toJsonSchema2020_12("string")).toBe("string");
    expect(toJsonSchema2020_12([1, 2])).toEqual([1, 2]);
  });

  it("strips $schema from nested subschemas — only the root declares a dialect", () => {
    const converted = convert({
      $schema: DRAFT_07,
      type: "object",
      properties: {
        nested: {
          $schema: DRAFT_07,
          type: "object",
          properties: { deeper: { $schema: DRAFT_07, type: "number" } },
        },
        inArray: { anyOf: [{ $schema: DRAFT_07, type: "string" }] },
      },
    });

    expect(JSON.stringify(converted)).not.toContain("draft-07");

    const properties = converted.properties as JsonObject;
    expect(properties.nested).toEqual({
      type: "object",
      properties: { deeper: { type: "number" } },
    });
    expect(properties.inArray).toEqual({ anyOf: [{ type: "string" }] });

    // Exactly one dialect declaration, at the root.
    expect((JSON.stringify(converted).match(/\$schema/g) ?? []).length).toBe(1);
  });

  it("renames definitions to $defs and rewrites #/definitions/ refs", () => {
    const converted = convert({
      $schema: DRAFT_07,
      definitions: { Cell: { type: "string" } },
      type: "object",
      properties: {
        a: { $ref: "#/definitions/Cell" },
        b: { $ref: "#/properties/a" },
      },
    });

    expect(converted.$defs).toEqual({ Cell: { type: "string" } });
    expect(converted.definitions).toBeUndefined();

    const properties = converted.properties as Record<string, { $ref: string }>;
    expect(properties.a.$ref).toBe("#/$defs/Cell");
    // A non-definitions pointer is dialect-neutral and must pass through.
    expect(properties.b.$ref).toBe("#/properties/a");
  });

  it("leaves a non-string $ref alone", () => {
    expect(convert({ $ref: 42 }).$ref).toBe(42);
  });

  it("converts tuple items to prefixItems and additionalItems to items", () => {
    const converted = convert({
      type: "array",
      items: [{ type: "string" }, { type: "number" }],
      additionalItems: { type: "boolean" },
    });

    expect(converted.prefixItems).toEqual([{ type: "string" }, { type: "number" }]);
    expect(converted.items).toEqual({ type: "boolean" });
    expect(converted.additionalItems).toBeUndefined();
  });

  it("converts tuple items with no additionalItems sibling", () => {
    const converted = convert({ type: "array", items: [{ type: "string" }] });

    expect(converted.prefixItems).toEqual([{ type: "string" }]);
    expect(converted.items).toBeUndefined();
  });

  it("drops a stray additionalItems rather than clobbering a non-tuple items", () => {
    const converted = convert({
      type: "array",
      items: { type: "string" },
      additionalItems: { type: "boolean" },
    });

    // items must survive as the single-schema form it already was.
    expect(converted.items).toEqual({ type: "string" });
    expect(converted.additionalItems).toBeUndefined();
    expect(converted.prefixItems).toBeUndefined();
  });

  it("splits dependencies into dependentRequired and dependentSchemas", () => {
    const converted = convert({
      type: "object",
      dependencies: {
        creditCard: ["billingAddress"],
        shipTo: { type: "object", properties: { zip: { type: "string" } } },
      },
    });

    expect(converted.dependentRequired).toEqual({ creditCard: ["billingAddress"] });
    expect(converted.dependentSchemas).toEqual({
      shipTo: { type: "object", properties: { zip: { type: "string" } } },
    });
    expect(converted.dependencies).toBeUndefined();
  });

  it("emits only the halves of dependencies that are actually present", () => {
    const requiredOnly = convert({ dependencies: { a: ["b"] } });
    expect(requiredOnly.dependentRequired).toEqual({ a: ["b"] });
    expect(requiredOnly.dependentSchemas).toBeUndefined();

    const schemasOnly = convert({ dependencies: { a: { type: "string" } } });
    expect(schemasOnly.dependentSchemas).toEqual({ a: { type: "string" } });
    expect(schemasOnly.dependentRequired).toBeUndefined();

    const empty = convert({ dependencies: {} });
    expect(empty.dependentRequired).toBeUndefined();
    expect(empty.dependentSchemas).toBeUndefined();
    expect(empty.dependencies).toBeUndefined();
  });

  it("collapses boolean exclusiveMinimum/Maximum onto the numeric bound", () => {
    const converted = convert({
      type: "number",
      minimum: 5,
      exclusiveMinimum: true,
      maximum: 10,
      exclusiveMaximum: true,
    });

    expect(converted.exclusiveMinimum).toBe(5);
    expect(converted.exclusiveMaximum).toBe(10);
    expect(converted.minimum).toBeUndefined();
    expect(converted.maximum).toBeUndefined();
  });

  it("drops a false exclusiveMinimum/Maximum and keeps the inclusive bound", () => {
    const converted = convert({
      type: "number",
      minimum: 5,
      exclusiveMinimum: false,
      maximum: 10,
      exclusiveMaximum: false,
    });

    expect(converted.minimum).toBe(5);
    expect(converted.maximum).toBe(10);
    expect(converted.exclusiveMinimum).toBeUndefined();
    expect(converted.exclusiveMaximum).toBeUndefined();
  });

  it("passes an already-numeric exclusiveMinimum/Maximum through untouched", () => {
    const converted = convert({ exclusiveMinimum: 0, exclusiveMaximum: 100 });
    expect(converted.exclusiveMinimum).toBe(0);
    expect(converted.exclusiveMaximum).toBe(100);
  });

  it("keeps a boolean exclusiveMinimum that has no numeric bound to fold into", () => {
    // Nothing to collapse onto, so the keyword is preserved rather than lost.
    expect(convert({ exclusiveMinimum: true }).exclusiveMinimum).toBe(true);
  });

  it("does not mutate the input document", () => {
    const source: JsonObject = {
      $schema: DRAFT_07,
      definitions: { A: { type: "string" } },
      properties: { a: { $ref: "#/definitions/A" } },
    };
    const snapshot = JSON.parse(JSON.stringify(source));

    convert(source);

    expect(source).toEqual(snapshot);
  });
});

describe("normalizeOutgoingMessage", () => {
  const toolsListResult = () => ({
    jsonrpc: "2.0",
    id: 2,
    result: {
      tools: [
        {
          name: "read-table",
          description: "Read a table",
          inputSchema: {
            $schema: DRAFT_07,
            type: "object",
            properties: { path: { type: "string" } },
          },
          outputSchema: {
            $schema: DRAFT_07,
            type: "object",
            properties: { rows: { type: "array" } },
          },
        },
        {
          name: "health-check",
          inputSchema: { $schema: DRAFT_07, type: "object" },
        },
      ],
    },
  });

  const toolsOf = (message: unknown) =>
    (message as { result: { tools: JsonObject[] } }).result.tools;

  it("rewrites inputSchema and outputSchema on every tool", () => {
    const normalized = normalizeOutgoingMessage(toolsListResult());

    for (const tool of toolsOf(normalized)) {
      expect((tool.inputSchema as JsonObject).$schema).toBe(JSON_SCHEMA_2020_12);
    }
    expect((toolsOf(normalized)[0].outputSchema as JsonObject).$schema).toBe(JSON_SCHEMA_2020_12);
    expect(JSON.stringify(normalized)).not.toContain("draft-07");
  });

  it("leaves a tool without an outputSchema alone", () => {
    const normalized = normalizeOutgoingMessage(toolsListResult());

    expect(toolsOf(normalized)[1]).not.toHaveProperty("outputSchema");
    expect(toolsOf(normalized)[1].name).toBe("health-check");
  });

  it("preserves every other tool field", () => {
    const normalized = normalizeOutgoingMessage(toolsListResult());
    expect(toolsOf(normalized)[0].description).toBe("Read a table");
  });

  it("does not mutate the original message", () => {
    const message = toolsListResult();
    normalizeOutgoingMessage(message);
    expect(message.result.tools[0].inputSchema.$schema).toBe(DRAFT_07);
  });

  it("returns a tools/call result unchanged", () => {
    const message = {
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "ok" }], structuredContent: { rows: [] } },
    };
    expect(normalizeOutgoingMessage(message)).toBe(message);
  });

  it("returns a notification unchanged", () => {
    const message = { jsonrpc: "2.0", method: "notifications/tools/list_changed" };
    expect(normalizeOutgoingMessage(message)).toBe(message);
  });

  it("returns an error response unchanged", () => {
    const message = { jsonrpc: "2.0", id: 4, error: { code: -32602, message: "bad" } };
    expect(normalizeOutgoingMessage(message)).toBe(message);
  });

  it("returns non-object and malformed payloads unchanged", () => {
    expect(normalizeOutgoingMessage(null)).toBeNull();
    expect(normalizeOutgoingMessage("nope")).toBe("nope");
    const notAnArray = { result: { tools: { name: "x" } } };
    expect(normalizeOutgoingMessage(notAnArray)).toBe(notAnArray);
  });

  it("passes non-object entries in the tools array through untouched", () => {
    const normalized = normalizeOutgoingMessage({ result: { tools: [null, "weird"] } });
    expect(toolsOf(normalized)).toEqual([null, "weird"]);
  });
});

describe("withJsonSchema2020_12", () => {
  function fakeTransport() {
    const send = vi.fn((_message: JSONRPCMessage, _options?: unknown) => Promise.resolve());
    const transport = {
      start: () => Promise.resolve(),
      close: () => Promise.resolve(),
      send,
    } as unknown as Transport;
    return { transport, send };
  }

  it("returns the same transport instance", () => {
    const { transport } = fakeTransport();
    expect(withJsonSchema2020_12(transport)).toBe(transport);
  });

  it("delegates to the original send with the NORMALIZED message", async () => {
    const { transport, send } = fakeTransport();
    withJsonSchema2020_12(transport);

    await transport.send({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          {
            name: "get-cell",
            inputSchema: { $schema: DRAFT_07, type: "object" },
            outputSchema: { $schema: DRAFT_07, type: "object" },
          },
        ],
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0];
    const tool = (sent as unknown as { result: { tools: JsonObject[] } }).result.tools[0];
    expect((tool.inputSchema as JsonObject).$schema).toBe(JSON_SCHEMA_2020_12);
    expect((tool.outputSchema as JsonObject).$schema).toBe(JSON_SCHEMA_2020_12);
    expect(JSON.stringify(sent)).not.toContain("draft-07");
  });

  it("forwards the send options", async () => {
    const { transport, send } = fakeTransport();
    withJsonSchema2020_12(transport);

    const options = { relatedRequestId: 7 };
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" }, options);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe(options);
  });

  it("passes non-tools/list messages through byte-identically", async () => {
    const { transport, send } = fakeTransport();
    withJsonSchema2020_12(transport);

    const message: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 9,
      result: { content: [{ type: "text", text: "hi" }] },
    };
    await transport.send(message);

    expect(send.mock.calls[0][0]).toBe(message);
  });
});
