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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NumbersManager } from "../services/numbersManager.js";
export declare function registerResourcesAndPrompts(server: McpServer, manager: NumbersManager): void;
//# sourceMappingURL=resourcesAndPrompts.d.ts.map