import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { DirectToolSpec } from "./types.ts";

/** Pi >= 0.99 routes outputSchema + structuredContent to native codemode. */
export function nativeToolFields(spec: DirectToolSpec) {
  return {
    exposure: spec.lazy ? "deferred" as const : "direct" as const,
    namespace: { name: `mcp__${spec.serverName}`, description: `MCP tools from ${spec.serverName}.` },
    ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
    // Resource tools retain their existing text contract; this schema is CallToolResult.
    ...(!spec.resourceUri ? { outputSchema: {
      type: "object",
      properties: {
        content: { type: "array", items: { type: "object" } },
        ...(spec.outputSchema !== undefined ? { structuredContent: spec.outputSchema } : {}),
        isError: { type: "boolean" },
      },
      required: ["content"],
    } } : {}),
  };
}

/** MCP _meta can contain app-only data; never expose it to the model or scripts. */
export function scriptMcpResult(result: Record<string, unknown>): NonNullable<AgentToolResult<Record<string, unknown>>["structuredContent"]> {
  const { _meta: _private, ...publicResult } = result;
  return publicResult as NonNullable<AgentToolResult<Record<string, unknown>>["structuredContent"]>;
}

/** Pre-dispatch/transport failures have no server result: return an explicit error envelope. */
export function requireMcpResult(result: AgentToolResult<Record<string, unknown>>, spec: DirectToolSpec) {
  if (!spec.resourceUri && result.structuredContent === undefined) {
    if (result.details.error) {
      return { ...result, isError: true, structuredContent: scriptMcpResult({ content: result.content, isError: true }) };
    }
    throw new Error(`MCP tool ${spec.prefixedName} returned no structured result`);
  }
  return result;
}
