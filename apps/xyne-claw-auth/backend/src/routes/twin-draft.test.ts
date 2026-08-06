import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { pinTwinDraftSpacesAppId } from "./twin-draft.js";

vi.mock("../lib/twin-delivery.js", () => ({ executeTwinApprovalDelivery: vi.fn() }));
vi.mock("../services/twinResponseFeedback.js", () => ({ recordTwinApprovalOutcome: vi.fn() }));
vi.mock("../middleware/verify-spaces-signature.js", () => ({ verifySpacesSignatureEnforced: vi.fn() }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));

function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe("pinTwinDraftSpacesAppId", () => {
  it("pins the draft spacesAppId into req.params for HMAC lookup", () => {
    const req = {
      body: { draft: { spacesAppId: " app_123 " } },
      params: {},
    } as unknown as Request;
    const res = makeRes();
    const next: NextFunction = vi.fn();

    pinTwinDraftSpacesAppId(req, res, next);

    expect((req.params as Record<string, string>).spacesAppId).toBe("app_123");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects drafts that cannot identify the signing Spaces app", () => {
    const req = { body: { draft: {} }, params: {} } as unknown as Request;
    const res = makeRes();
    const next: NextFunction = vi.fn();

    pinTwinDraftSpacesAppId(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "draft.spacesAppId is required" });
    expect(next).not.toHaveBeenCalled();
  });
});
