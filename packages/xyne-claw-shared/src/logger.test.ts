import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import winston from "winston";
import { logger, redactLogInfo, redactUrlQuery, redactValue } from "./logger.js";

describe("redactUrlQuery", () => {
  it("redacts every query value and keeps names", () => {
    expect(redactUrlQuery("/claw/api/v1/public/gmail-push?token=abc&code=xyz&flag")).toBe(
      "/claw/api/v1/public/gmail-push?token=[REDACTED]&code=[REDACTED]&flag",
    );
  });

  it("leaves query-less paths untouched", () => {
    expect(redactUrlQuery("/claw/api/v1/health")).toBe("/claw/api/v1/health");
  });

  it("drops fragments and userinfo", () => {
    expect(redactUrlQuery("https://user:pw@mcp.example.com/sse?key=k#access_token=t")).toBe(
      "https://[REDACTED]@mcp.example.com/sse?key=[REDACTED]",
    );
  });
});

describe("redactValue", () => {
  it("redacts secret-named keys but keeps booleans and numbers", () => {
    expect(
      redactValue({
        access_token: "ya29.abc",
        "X-Api-Key": "k",
        Authorization: "Basic Zm9v",
        headers: { cookie: ["a=b"] },
        hasToken: true,
        token: 3,
        name: "ok",
      }),
    ).toEqual({
      access_token: "[REDACTED]",
      "X-Api-Key": "[REDACTED]",
      Authorization: "[REDACTED]",
      headers: { cookie: "[REDACTED]" },
      hasToken: true,
      token: 3,
      name: "ok",
    });
  });

  it("replaces cycles without failing and keeps shared non-cyclic refs", () => {
    const shared = { n: 1 };
    const a: Record<string, unknown> = { left: shared, right: shared };
    a.self = a;
    expect(redactValue(a)).toEqual({ left: { n: 1 }, right: { n: 1 }, self: "[Circular]" });
  });

  it("caps depth", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(redactValue(deep))).toContain("[Truncated]");
  });

  it("normalises errors to name/message/stack", () => {
    const err = Object.assign(new Error("failed with Bearer abcdefghijklmnopqrstuvwxyz"), {
      config: { headers: { Authorization: "Bearer secret" } },
    });
    const out = redactValue({ err }) as { err: Record<string, unknown> };
    expect(Object.keys(out.err).sort()).toEqual(["message", "name", "stack"]);
    expect(out.err.message).toBe("failed with Bearer <redacted>");
  });

  it("redacts JWTs in strings", () => {
    expect(redactValue("id=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl done")).toBe(
      "id=[REDACTED_JWT] done",
    );
  });
});

describe("redactLogInfo", () => {
  it("drops HTTP-client request/response objects at the top level", () => {
    const info = redactLogInfo({
      level: "error",
      message: "boom",
      config: { headers: { Authorization: "Bearer x" } },
      response: { status: 500 },
      request: "GET /",
      status: 500,
    });
    expect(info).toMatchObject({ config: "[REDACTED]", response: "[REDACTED]", request: "GET /", status: 500 });
  });
});

describe("logger pipeline", () => {
  it("does not leak the props of a sole Error meta", () => {
    const seen: Array<Record<string, unknown>> = [];
    const capture = new winston.transports.Stream({
      stream: new Writable({
        objectMode: true,
        write(info: Record<string, unknown>, _enc, done) {
          seen.push(info);
          done();
        },
      }),
    });
    logger.add(capture);
    try {
      const err = Object.assign(new Error("Request failed"), {
        config: { headers: { Authorization: "Bearer sa-token-0123456789abcdef" } },
        response: { req: { _header: "authorization: Bearer sa-token-0123456789abcdef" } },
        statusCode: 403,
      });
      logger.error("delete failed", err);
    } finally {
      logger.remove(capture);
    }
    const info = seen[0]!;
    expect(JSON.stringify(info)).not.toContain("sa-token");
    expect(info.statusCode).toBe(403);
    expect(info.details).toEqual([{ name: "Error", message: "Request failed", stack: expect.any(String) }]);
  });
});
