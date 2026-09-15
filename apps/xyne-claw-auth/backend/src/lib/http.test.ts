import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { asyncHandler, ok, errMsg, HttpError, badRequest, unauthorized, forbidden, notFound, conflict, errorMiddleware } from "./http.js";

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

describe("ok()", () => {
  it("ok(res) => { success: true } only", () => {
    const res = mockRes();
    ok(res);
    expect(res._json).toEqual({ success: true });
  });
  it("ok(res, data) => { success: true, data }", () => {
    const res = mockRes();
    ok(res, [1, 2]);
    expect(res._json).toEqual({ success: true, data: [1, 2] });
  });
  it("ok(res, null) keeps an explicit null data (matches old {success:true,data:null})", () => {
    const res = mockRes();
    ok(res, null);
    expect(res._json).toEqual({ success: true, data: null });
  });
  it("ok(res, data, extra) puts extra at top level, not under data", () => {
    const res = mockRes();
    ok(res, { a: 1 }, { total: 9, nextCursor: "x" });
    expect(res._json).toEqual({ success: true, data: { a: 1 }, total: 9, nextCursor: "x" });
  });
});

describe("HttpError factories", () => {
  it("map to the right statuses and carry the message + optional code", () => {
    expect(badRequest("b")).toMatchObject({ status: 400, message: "b" });
    expect(unauthorized()).toMatchObject({ status: 401, message: "Unauthorized" });
    expect(forbidden("f")).toMatchObject({ status: 403, message: "f" });
    expect(notFound("n")).toMatchObject({ status: 404, message: "n" });
    expect(conflict("c")).toMatchObject({ status: 409, message: "c" });
    expect(badRequest("b", "CODE_X")).toMatchObject({ status: 400, code: "CODE_X" });
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
    const handler = asyncHandler(async (_req, r) => ok(r, 1));
    handler({} as Request, res, next as NextFunction);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
    expect(res._json).toEqual({ success: true, data: 1 });
  });
});

describe("errorMiddleware", () => {
  it("renders an HttpError as its status + {success:false,error}", () => {
    const res = mockRes();
    errorMiddleware(notFound("gone"), {} as Request, res, vi.fn() as NextFunction);
    expect(res._status).toBe(404);
    expect(res._json).toEqual({ success: false, error: "gone" });
  });
  it("includes code when present", () => {
    const res = mockRes();
    errorMiddleware(badRequest("bad", "X"), {} as Request, res, vi.fn() as NextFunction);
    expect(res._json).toEqual({ success: false, error: "bad", code: "X" });
  });
  it("merges HttpError.extra as top-level error fields (e.g. validation `field`)", () => {
    const res = mockRes();
    errorMiddleware(new HttpError(400, "invalid name", undefined, { field: "name" }), {} as Request, res, vi.fn() as NextFunction);
    expect(res._status).toBe(400);
    expect(res._json).toEqual({ success: false, error: "invalid name", field: "name" });
  });
  it("maps an unknown error to a generic logged 500", () => {
    const res = mockRes();
    errorMiddleware(new Error("boom"), { method: "GET", originalUrl: "/x" } as Request, res, vi.fn() as NextFunction);
    expect(res._status).toBe(500);
    expect(res._json).toEqual({ success: false, error: "Internal server error" });
  });
  it("delegates to next (does not re-respond) when headers already sent", () => {
    const res = mockRes();
    (res as { headersSent: boolean }).headersSent = true;
    const next = vi.fn();
    errorMiddleware(new Error("late"), {} as Request, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("errMsg", () => {
  it("extracts .message from Error, stringifies others", () => {
    expect(errMsg(new Error("m"))).toBe("m");
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg(42)).toBe("42");
  });
});
