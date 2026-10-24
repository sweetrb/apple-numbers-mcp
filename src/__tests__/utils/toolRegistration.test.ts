/**
 * Contract tests for registerToolWithContracts / integerNumber.
 *
 * The Zod 3 -> 4 migration (GHSA-mrhx-c7xc-m3w5) must not change what tools/list
 * advertises: closed (additionalProperties:false) input objects, permissive
 * output roots, and `type: "integer"` bounds on row/column indices.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv2020 from "ajv/dist/2020.js";
import { withJsonSchema2020_12 } from "../../utils/jsonSchemaDialect.js";
import { integerNumber, registerToolWithContracts } from "../../utils/toolRegistration.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function fixture() {
  const server = new McpServer({ name: "schema-contract", version: "1" });
  const client = new Client({ name: "schema-contract-test", version: "1" });
  cleanup.push(
    () => client.close(),
    () => server.close()
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  return {
    server,
    client,
    connect: async () => {
      await server.connect(withJsonSchema2020_12(serverTransport));
      await client.connect(clientTransport);
    },
  };
}

describe("tool registration contracts across Zod versions", () => {
  it("advertises closed root/nested inputs while stripping unknown keys before callbacks", async () => {
    const { server, client, connect } = await fixture();
    let received: unknown;
    registerToolWithContracts(
      server,
      "nested",
      {
        inputSchema: { updates: z.array(z.object({ row: integerNumber().min(0) })) },
        outputSchema: { row: z.object({ value: z.string() }).optional() },
      },
      async (args) => {
        received = args;
        return { content: [], structuredContent: { extra: true } };
      }
    );
    await connect();
    const { tools } = await client.listTools();
    const schema = tools[0].inputSchema;
    expect(schema.additionalProperties).toBe(false);
    const items = (schema.properties!.updates as { items: { additionalProperties: boolean } })
      .items;
    expect(items.additionalProperties).toBe(false);
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate({ updates: [{ row: 1 }] })).toBe(true);
    expect(validate({ updates: [{ row: 1, extra: true }] })).toBe(false);
    await client.callTool({
      name: "nested",
      arguments: { updates: [{ row: 1, extra: true }], extra: true },
    });
    expect(received).toEqual({ updates: [{ row: 1 }] });
    expect(tools[0].outputSchema?.additionalProperties).toBe(true);
    expect(
      (tools[0].outputSchema?.properties as Record<string, { additionalProperties: boolean }>).row
        .additionalProperties
    ).toBe(false);
  });

  it("retains raw empty input shapes' permissive advertisement", async () => {
    const { server, client, connect } = await fixture();
    registerToolWithContracts(server, "empty", { inputSchema: {}, outputSchema: {} }, async () => ({
      content: [],
      structuredContent: { extra: true },
    }));
    await connect();
    const { tools } = await client.listTools();
    expect(tools[0].inputSchema.additionalProperties).not.toBe(false);
    expect(await client.callTool({ name: "empty", arguments: { extra: true } })).toMatchObject({
      structuredContent: { extra: true },
    });
  });

  it("advertises bounded integer indices and rejects fractions and out-of-range values", async () => {
    const { server, client, connect } = await fixture();
    let received: unknown;
    registerToolWithContracts(
      server,
      "integer",
      { inputSchema: { row: integerNumber().min(0).max(1_000_000) }, outputSchema: {} },
      async (args) => {
        received = args;
        return { content: [], structuredContent: {} };
      }
    );
    await connect();
    const { tools } = await client.listTools();
    expect(tools[0].inputSchema.properties!.row).toEqual({
      type: "integer",
      minimum: 0,
      maximum: 1_000_000,
    });
    await client.callTool({ name: "integer", arguments: { row: 7 } });
    expect(received).toEqual({ row: 7 });
    for (const row of [1.5, -1, 1_000_001]) {
      expect(await client.callTool({ name: "integer", arguments: { row } })).toMatchObject({
        isError: true,
      });
    }
  });

  it("keeps the full integer domain when unbounded (no Zod 4 safe-int clamp)", async () => {
    const { server, client, connect } = await fixture();
    let received: unknown;
    registerToolWithContracts(
      server,
      "unbounded",
      { inputSchema: { count: integerNumber().min(1) }, outputSchema: {} },
      async (args) => {
        received = args;
        return { content: [], structuredContent: {} };
      }
    );
    await connect();
    const { tools } = await client.listTools();
    expect(tools[0].inputSchema.properties!.count).not.toHaveProperty("maximum");
    await client.callTool({ name: "unbounded", arguments: { count: 1e20 } });
    expect(received).toEqual({ count: 1e20 });
  });
});
