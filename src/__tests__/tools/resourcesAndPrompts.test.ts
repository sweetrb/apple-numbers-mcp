import { describe, it, expect, vi } from "vitest";
import { registerResourcesAndPrompts } from "../../tools/resourcesAndPrompts.js";
import type { NumbersManager } from "../../services/numbersManager.js";

/** Minimal fake McpServer capturing resource/prompt registrations. */
function fakeServer() {
  const resources = new Map<string, (uri: URL, vars?: Record<string, unknown>) => unknown>();
  const prompts = new Map<string, (args: Record<string, unknown>) => unknown>();
  return {
    resources,
    prompts,

    resource(name: string, _uriOrTemplate: unknown, cb: unknown) {
      resources.set(name, cb as (uri: URL, vars?: Record<string, unknown>) => unknown);
    },
    // prompt(name, description, [argsSchema], cb)

    prompt(name: string, _desc: string, schemaOrCb: unknown, maybeCb?: unknown) {
      prompts.set(
        name,
        (typeof schemaOrCb === "function" ? schemaOrCb : maybeCb) as (
          args: Record<string, unknown>
        ) => unknown
      );
    },
  };
}

function mockManager(overrides: Partial<Record<keyof NumbersManager, unknown>> = {}) {
  return {
    getFileInfo: (path: string) => ({ path, sheets: [], defaultSheet: "Sheet 1" }),
    readTable: (path: string) => ({
      sheetName: "Sheet 1",
      tableName: "Table 1",
      headers: ["A"],
      rows: [[1]],
      numRows: 1,
      numCols: 1,
      path,
    }),
    ...overrides,
  } as unknown as NumbersManager;
}

describe("registerResourcesAndPrompts", () => {
  it("registers all resources and prompts", () => {
    const server = fakeServer();
    registerResourcesAndPrompts(server as never, mockManager());
    expect([...server.resources.keys()].sort()).toEqual(["file-info", "table"]);
    expect([...server.prompts.keys()].sort()).toEqual([
      "analyze-spreadsheet",
      "bulk-edit",
      "import-csv-guide",
    ]);
  });

  it("file-info resource returns the manager's file info as JSON", () => {
    const server = fakeServer();
    const getFileInfo = vi.fn((path: string) => ({ path, sheets: [], defaultSheet: "S" }));
    registerResourcesAndPrompts(server as never, mockManager({ getFileInfo }));
    const out = server.resources.get("file-info")!(new URL("numbers://file/x.numbers"), {
      path: "x.numbers",
    }) as { contents: { text: string }[] };
    expect(getFileInfo).toHaveBeenCalledWith("x.numbers");
    expect(JSON.parse(out.contents[0].text)).toEqual({
      path: "x.numbers",
      sheets: [],
      defaultSheet: "S",
    });
  });

  it("table template resource decodes the path variable", () => {
    const server = fakeServer();
    const readTable = vi.fn((path: string) => ({ path, headers: [], rows: [] }));
    registerResourcesAndPrompts(server as never, mockManager({ readTable }));
    const out = server.resources.get("table")!(
      new URL("numbers://table/%2FUsers%2Frob%2Fmy%20file.numbers"),
      { path: "%2FUsers%2Frob%2Fmy%20file.numbers" }
    ) as { contents: { text: string }[] };
    expect(readTable).toHaveBeenCalledWith("/Users/rob/my file.numbers");
    expect(JSON.parse(out.contents[0].text).path).toBe("/Users/rob/my file.numbers");
  });

  it("a failing resource returns a JSON error payload instead of throwing", () => {
    const server = fakeServer();
    registerResourcesAndPrompts(
      server as never,
      mockManager({
        getFileInfo: () => {
          throw new Error("File not found");
        },
      })
    );
    const out = server.resources.get("file-info")!(new URL("numbers://file/missing.numbers"), {
      path: "missing.numbers",
    }) as { contents: { text: string }[] };
    expect(JSON.parse(out.contents[0].text).error).toContain("not found");
  });

  it("prompts produce a user message referencing their inputs", () => {
    const server = fakeServer();
    registerResourcesAndPrompts(server as never, mockManager());

    const analyze = server.prompts.get("analyze-spreadsheet")!({
      path: "/tmp/budget.numbers",
    }) as { messages: { content: { text: string } }[] };
    expect(analyze.messages[0].content.text).toContain("/tmp/budget.numbers");

    const bulk = server.prompts.get("bulk-edit")!({
      path: "/tmp/data.numbers",
      instructions: "set A1 to 5",
    }) as { messages: { content: { text: string } }[] };
    expect(bulk.messages[0].content.text).toContain("/tmp/data.numbers");
    expect(bulk.messages[0].content.text).toContain("set A1 to 5");

    const guide = server.prompts.get("import-csv-guide")!({}) as {
      messages: { content: { text: string } }[];
    };
    expect(guide.messages[0].content.text).toContain("import-csv");
  });
});
