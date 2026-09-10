import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  API_ERROR_CODES,
  asyncHandler,
  sendApiError,
  sendApiOk,
  ok,
  errMsg,
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  errorMiddleware,
} from "./http.js";

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res._json = body;
    return res;
  }) as unknown as Response["json"];
  (res as { headersSent: boolean }).headersSent = false;
  return res;
}

describe("sendApiOk()", () => {
  it("emits the canonical success envelope", () => {
    const res = mockRes();
    sendApiOk(res, [1, 2]);
    expect(res._json).toEqual({ success: true, data: [1, 2] });
  });
  it("keeps explicit null data and optional top-level metadata", () => {
    const res = mockRes();
    sendApiOk(res, null, { total: 1 });
    expect(res._json).toEqual({ total: 1, success: true, data: null });
  });
  it("keeps ok() as a compatibility alias", () => {
    const res = mockRes();
    ok(res);
    expect(res._json).toEqual({ success: true });
  });
});

describe("sendApiError()", () => {
  it("preserves the legacy error string and adds a stable code", () => {
    const res = mockRes();
    sendApiError(res, 401, API_ERROR_CODES.AUTHENTICATION_REQUIRED, "Authentication required");
    expect(res._status).toBe(401);
    expect(res._json).toEqual({
      success: false,
      error: "Authentication required",
      code: "AUTHENTICATION_REQUIRED",
    });
  });
  it("allows metadata without letting it replace canonical fields", () => {
    const res = mockRes();
    sendApiError(res, 400, API_ERROR_CODES.VALIDATION_FAILED, "invalid name", {
      field: "name",
      success: true,
      code: "WRONG",
    });
    expect(res._json).toEqual({
      field: "name",
      success: false,
      error: "invalid name",
      code: "VALIDATION_FAILED",
    });
  });
});

describe("HttpError factories", () => {
  it("map statuses to canonical codes", () => {
    expect(badRequest("b")).toMatchObject({ status: 400, code: "VALIDATION_FAILED", message: "b" });
    expect(unauthorized()).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });
    expect(forbidden("f")).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(notFound("n")).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(conflict("c")).toMatchObject({ status: 409, code: "CONFLICT" });
  });
  it("derives a safe code for upstream and unknown statuses", () => {
    expect(new HttpError(503, "down").code).toBe("UPSTREAM_ERROR");
    expect(new HttpError(500, "boom").code).toBe("INTERNAL_ERROR");
  });
});

describe("asyncHandler", () => {
  it("forwards a thrown error to next() instead of crashing", async () => {
    const next = vi.fn();
    const handler = asyncHandler(async () => {
      throw badRequest("nope");
    });
    handler({} as Request, mockRes(), next as NextFunction);
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledOnce();
    expect((next.mock.calls[0]![0] as HttpError).status).toBe(400);
  });
  it("does not call next on success", async () => {
    const next = vi.fn();
    const res = mockRes();
    const handler = asyncHandler(async (_req, r) => sendApiOk(r, 1));
    handler({} as Request, res, next as NextFunction);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(res._json).toEqual({ success: true, data: 1 });
  });
});

describe("errorMiddleware", () => {
  it("renders an HttpError using the canonical envelope", () => {
    const res = mockRes();
    errorMiddleware(notFound("gone"), {} as Request, res, vi.fn() as NextFunction);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ success: false, error: "gone", code: "NOT_FOUND" });
  });
  it("merges HttpError.extra as top-level fields", () => {
    const res = mockRes();
    errorMiddleware(new HttpError(400, "invalid name", undefined, { field: "name" }), {} as Request, res, vi.fn() as NextFunction);
    expect(res._json).toEqual({ field: "name", success: false, error: "invalid name", code: "VALIDATION_FAILED" });
  });
  it("maps an unknown error to a generic logged 500", () => {
    const res = mockRes();
    errorMiddleware(new Error("boom"), { method: "GET", originalUrl: "/x" } as Request, res, vi.fn() as NextFunction);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" });
  });
  it("delegates to next when headers were already sent", () => {
    const res = mockRes();
    (res as { headersSent: boolean }).headersSent = true;
    const next = vi.fn();
    errorMiddleware(new Error("late"), {} as Request, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("errMsg", () => {
  it("extracts .message from Error and stringifies other values", () => {
    expect(errMsg(new Error("m"))).toBe("m");
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg(42)).toBe("42");
  });
});
