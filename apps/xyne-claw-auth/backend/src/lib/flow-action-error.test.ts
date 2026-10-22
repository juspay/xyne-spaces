import { describe, expect, it } from "vitest";
import { SpacesApiError } from "../mcp/servers/xyne-spaces-client.js";
import { classifyToolError, extractErrorStatus, extractUpstreamMessage, flowActionError } from "./flow-action-error.js";

describe("classifyToolError (XYNE-66467)", () => {
  it("maps the 13 Oct canvas incident (read-only user, Spaces 403) to PERMISSION_DENIED with readable copy", () => {
    // What callTool throws: plain Error from the MCP text + httpStatus lifted from _meta.
    const err = Object.assign(new Error('Edit canvas error: Spaces API 403: {"error":"Permission denied"}'), {
      httpStatus: 403,
    });
    const out = classifyToolError(err, { tool: "spaces-edit-canvas" });
    expect(out).toEqual({
      type: "error",
      code: "PERMISSION_DENIED",
      retryable: false,
      message: "You don't have edit access to this canvas. Ask its owner to give you edit access, then try again.",
    });
    expect(out.message).not.toMatch(/422|\{|Spaces API/);
  });

  it("falls back to the `Spaces API <status>` prefix when no structured status survived", () => {
    const out = classifyToolError(new Error('Edit canvas error: Spaces API 403: {...}'), { tool: "spaces-edit-canvas" });
    expect(out.code).toBe("PERMISSION_DENIED");
  });

  it.each([
    [401, "PERMISSION_DENIED", false],
    [403, "PERMISSION_DENIED", false],
    [404, "NOT_FOUND", false],
    [409, "CONFLICT", false],
    [400, "INVALID_INPUT", false],
    [422, "INVALID_INPUT", false],
    [429, "RATE_LIMITED", true],
    [500, "UPSTREAM_UNAVAILABLE", true],
    [503, "UPSTREAM_UNAVAILABLE", true],
    [418, "INTERNAL", false],
  ] as const)("SpacesApiError %i → %s (retryable=%s)", (status, code, retryable) => {
    const out = classifyToolError(new SpacesApiError(status, `Spaces API ${status}: nope`), { tool: "spaces-create-ticket" });
    expect(out.code).toBe(code);
    expect(out.retryable).toBe(retryable);
  });

  it("treats status 0 / network failures as retryable UPSTREAM_UNAVAILABLE", () => {
    expect(classifyToolError(new SpacesApiError(0, "Spaces API network error: "), { tool: "x" }).code).toBe(
      "UPSTREAM_UNAVAILABLE",
    );
    expect(classifyToolError(new Error("fetch failed: ECONNRESET"), { tool: "x" })).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("keeps the old conversation-not-found guidance", () => {
    const out = classifyToolError(new Error("conversation not found"), { tool: "spaces-send-message" });
    expect(out.code).toBe("NOT_FOUND");
    expect(out.message).toMatch(/Re-run the agent/);
  });

  it("maps revoked OAuth to CONNECTION_REQUIRED", () => {
    expect(classifyToolError(new Error("invalid_grant: token has been revoked"), { tool: "gmail-send" }).code).toBe(
      "CONNECTION_REQUIRED",
    );
  });

  it("prefers an out-of-band status (gateway backendStatus) over text", () => {
    expect(classifyToolError(new Error("HTTP 500"), { tool: "x", status: 409 }).code).toBe("CONFLICT");
  });

  it("passes a readable validation message through for INVALID_INPUT, but never raw JSON", () => {
    const readable = classifyToolError(
      new SpacesApiError(400, 'Spaces API 400: {"error":"title is required"}'),
      { tool: "spaces-create-ticket" },
    );
    expect(readable.message).toBe("The change was rejected: title is required");

    const unreadable = classifyToolError(new SpacesApiError(422, "Spaces API 422: <html>bad</html>"), { tool: "x" });
    expect(unreadable.message).not.toMatch(/html/);
  });

  it("unknown errors become INTERNAL with generic copy, not the raw text", () => {
    const out = classifyToolError(new Error("TypeError: cannot read properties of undefined"), { tool: "x" });
    expect(out.code).toBe("INTERNAL");
    expect(out.message).not.toMatch(/TypeError/);
  });
});

describe("helpers", () => {
  it("extractErrorStatus reads status, httpStatus and message prefixes", () => {
    expect(extractErrorStatus(new SpacesApiError(404, "x"))).toBe(404);
    expect(extractErrorStatus(Object.assign(new Error("x"), { httpStatus: 403 }))).toBe(403);
    expect(extractErrorStatus(new Error("Spaces app API 409: dup"))).toBe(409);
    expect(extractErrorStatus(new Error("nothing"))).toBeUndefined();
  });

  it("extractUpstreamMessage pulls error/message out of a JSON body", () => {
    expect(extractUpstreamMessage(new Error('Spaces API 403: {"error":"Permission denied"}'))).toBe("Permission denied");
    expect(extractUpstreamMessage(new Error("Spaces API 403: {...}"))).toBeUndefined();
  });

  it("flowActionError sets retryable from the code", () => {
    expect(flowActionError("MISCONFIGURED")).toMatchObject({ code: "MISCONFIGURED", retryable: false });
    expect(flowActionError("RATE_LIMITED").retryable).toBe(true);
  });
});
