import { describe, it, expect } from "vitest";
import { classifyToolResult } from "./mcp-tool-result.js";

describe("classifyToolResult", () => {
  it("catches the shape Asana rejects a bad token with", () => {
    expect(classifyToolResult('{"error":"Unauthorized"}')).toEqual({ kind: "auth", message: "Unauthorized" });
  });

  it("reads a nested error message", () => {
    expect(classifyToolResult('{"error":{"message":"Invalid API key","code":401}}')).toEqual({
      kind: "auth",
      message: "Invalid API key",
    });
  });

  it("catches an errors array", () => {
    expect(classifyToolResult('{"errors":[{"message":"Not Authorized"}]}')?.message).toContain(
      "Not Authorized",
    );
  });

  it("catches a plain-text refusal", () => {
    expect(classifyToolResult("403 Forbidden")).toEqual({ kind: "auth", message: "403 Forbidden" });
  });

  it("passes a real payload through", () => {
    expect(classifyToolResult('{"workspaces":[{"gid":"1","name":"Juspay"}]}')).toBeNull();
    expect(classifyToolResult("")).toBeNull();
  });

  it("does not read data that merely mentions an auth word as a failure", () => {
    const doc = `${"Review of unauthorized access attempts. ".repeat(12)}`;
    expect(doc.length).toBeGreaterThan(300);
    expect(classifyToolResult(doc)).toBeNull();
  });

  it("treats an explicit error:false as fine", () => {
    expect(classifyToolResult('{"error":false,"data":[]}')).toBeNull();
  });

  it("does not blame the credential when the health tool was called wrong", () => {
    const verdict = classifyToolResult('{"error":"Error: Either user_id or device_id must be provided"}');
    expect(verdict?.kind).toBe("params");
  });

  it("treats throttling as transient, not as a bad key", () => {
    const verdict = classifyToolResult(
      '{"error":"Reddit 403: unauthenticated request was rate-limited/blocked. Retry later."}',
    );
    expect(verdict?.kind).toBe("transient");
  });

  it("does not blame the credential for an error it does not recognise", () => {
    // figma's health check asks for fileKey "test"; a VALID token still 404s.
    const verdict = classifyToolResult('{"error":"File not found: test"}');
    expect(verdict?.kind).toBe("unknown");
  });
});
