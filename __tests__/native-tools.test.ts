import { describe, expect, it } from "vitest";
import { nativeToolFields, requireMcpResult, scriptMcpResult } from "../native-tools.ts";
import { resolveDirectTools } from "../direct-tool-surface.ts";
import { computeServerHash } from "../metadata-cache.ts";

const spec = { serverName: "demo", originalName: "echo", prefixedName: "demo_echo", description: "Echo" };

describe("native Pi tool bridge", () => {
  it("exposes search tools as deferred and passes cached output schemas and annotations", () => {
    const definition = { command: "demo", directTools: "search" as const };
    const outputSchema = { type: "object", properties: { value: { type: "string" } } };
    const annotations = { readOnlyHint: true, destructiveHint: false };
    const cache = { version: 1, servers: { demo: {
      configHash: computeServerHash(definition), cachedAt: Date.now(),
      tools: [{ name: "echo", description: "Echo", outputSchema, annotations }], resources: [],
    } } };
    const [resolved] = resolveDirectTools({ mcpServers: { demo: definition } }, cache as any, "server");
    expect(resolved).toMatchObject({ lazy: true, outputSchema, annotations });
    const fields = nativeToolFields(resolved!);
    expect(fields.exposure).toBe("deferred");
    expect(fields.namespace.name).toBe("mcp__demo");
    expect(fields.annotations).toEqual(annotations);
    expect(fields.outputSchema?.properties.structuredContent).toEqual(outputSchema);
    expect(nativeToolFields(spec).exposure).toBe("direct");
  });

  it("preserves complete results and image blocks but strips private MCP metadata", () => {
    const raw = { content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], structuredContent: { value: "x".repeat(100_000) }, _meta: { secret: "app-only" } };
    const result = scriptMcpResult(raw) as any;
    expect(result.content).toEqual(raw.content);
    expect(result.structuredContent).toEqual(raw.structuredContent);
    expect(result).not.toHaveProperty("_meta");
    expect(raw._meta.secret).toBe("app-only");
  });

  it("keeps MCP errors structured and marks pre-dispatch failures explicitly", () => {
    const error = { content: [{ type: "text" as const, text: "denied" }], details: { error: "approval_required" } };
    expect(requireMcpResult(error, spec)).toMatchObject({ isError: true, structuredContent: { content: error.content, isError: true } });
    const serverError = { ...error, structuredContent: { content: error.content, isError: true }, isError: true };
    expect(requireMcpResult(serverError, spec)).toBe(serverError);
    expect(() => requireMcpResult({ content: [], details: {} }, spec)).toThrow("no structured result");
  });

  it("does not change the existing resource text contract", () => {
    const resource = { ...spec, resourceUri: "file:///example" };
    expect(nativeToolFields(resource)).not.toHaveProperty("outputSchema");
    const result = { content: [{ type: "text" as const, text: "resource" }], details: {} };
    expect(requireMcpResult(result, resource)).toBe(result);
  });
});
