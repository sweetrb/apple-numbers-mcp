/**
 * MCP resources & prompts for apple-numbers.
 *
 * Unlike a single-library server, numbers tools operate on a file PATH, so
 * resources are templated by an encoded path: an agent can attach the structure
 * of any .numbers file (or its default table) as context without a tool
 * round-trip. Prompts are reusable starting points for common spreadsheet
 * workflows (analyzing, bulk-editing, importing CSV/TSV).
 *
 * @module tools/resourcesAndPrompts
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
const json = (uri, data) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
});
export function registerResourcesAndPrompts(server, manager) {
    // --- Resources ---
    // Templated by a URL-encoded .numbers file path. There's no global list of
    // files to enumerate, so these are template-only ({ list: undefined }).
    server.resource("file-info", new ResourceTemplate("numbers://file/{path}", { list: undefined }), (uri, variables) => {
        try {
            const path = decodeURIComponent(String(variables.path));
            return json(uri, manager.getFileInfo(path));
        }
        catch (err) {
            return json(uri, { error: err instanceof Error ? err.message : String(err) });
        }
    });
    server.resource("table", new ResourceTemplate("numbers://table/{path}", { list: undefined }), (uri, variables) => {
        try {
            const path = decodeURIComponent(String(variables.path));
            return json(uri, manager.readTable(path));
        }
        catch (err) {
            return json(uri, { error: err instanceof Error ? err.message : String(err) });
        }
    });
    // --- Prompts ---
    server.prompt("analyze-spreadsheet", "Summarize the structure and key data of a .numbers spreadsheet", { path: z.string().describe("Path to the .numbers file to analyze") }, ({ path }) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Analyze the Numbers spreadsheet at "${path}". First use get-file-info to discover its sheets, tables, dimensions, and headers. Then use read-table on the most relevant table(s) to inspect the data. Give me a concise summary of the spreadsheet's structure (sheets/tables and their sizes) and the key data it contains — what each table represents, notable columns, and any obvious totals or patterns.`,
                },
            },
        ],
    }));
    server.prompt("bulk-edit", "Read a spreadsheet's table(s) and apply a batch of edits", {
        path: z.string().describe("Path to the .numbers file to edit"),
        instructions: z.string().describe("What changes to make (which cells/rows and new values)"),
    }, ({ path, instructions }) => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: `Apply the following edits to the Numbers spreadsheet at "${path}":\n\n${instructions}\n\nFirst use get-file-info and read-table to read the relevant table(s) so you know the current layout and 0-based row/column indices. Then apply the changes using the most efficient tool: set-cells-batch for scattered cell updates, add-rows to append new rows, or update-rows to overwrite full rows by index. After editing, re-read the affected cells and confirm what changed.`,
                },
            },
        ],
    }));
    server.prompt("import-csv-guide", "Explain how to convert a CSV/TSV file into a .numbers file", () => ({
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: "Explain how to use the import-csv tool to convert a CSV or TSV file into a new .numbers spreadsheet. Cover: passing inputPath (the source CSV/TSV/JSON) and outputPath (the new .numbers file); that format defaults to auto-detect from the file extension but can be set explicitly to csv/tsv/json; and the optional sheetName/tableName overrides. Note that the first row is treated as headers and that import creates a brand-new file rather than modifying an existing one.",
                },
            },
        ],
    }));
}
//# sourceMappingURL=resourcesAndPrompts.js.map