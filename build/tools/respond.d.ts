/**
 * Shared MCP tool-response helpers.
 *
 * Every tool returns a human-readable `text` block AND, where it has structured
 * data, a machine-readable `structuredContent` payload — so agents can consume
 * results without parsing prose. Mirrors apple-notes-mcp / apple-mail-mcp.
 */
export interface ToolResponse {
    content: {
        type: "text";
        text: string;
        [k: string]: unknown;
    }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    [k: string]: unknown;
}
/** A successful result: human text plus optional typed JSON for agents. */
export declare function successResponse(message: string, structured?: Record<string, unknown>): ToolResponse;
/** An error result. Optional structured payload carries machine-readable detail. */
export declare function errorResponse(message: string, structured?: Record<string, unknown>): ToolResponse;
/** Plain text result with no structured payload (kept for back-compat). */
export declare function textResponse(text: string): ToolResponse;
/**
 * Wrap a tool handler so any thrown error becomes a clean error response with a
 * consistent prefix, instead of crashing the tool call.
 */
export declare function withErrorHandling<T>(handler: (params: T) => ToolResponse, prefix: string): (params: T) => ToolResponse;
//# sourceMappingURL=respond.d.ts.map