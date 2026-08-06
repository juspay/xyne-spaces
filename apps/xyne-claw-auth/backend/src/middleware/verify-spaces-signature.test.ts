import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

process.env["SPACES_WEBHOOK_VERIFY_MODE"] = "warn";
process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  signingSecret: "cipher:iv:tag",
  decryptedSecret: "spaces-signing-secret",
  agent: { id: "agent-1", signingSecret: "cipher:iv:tag" as string | null } as { id: string; signingSecret: string | null } | null,
}));

vi.mock("../config.js", () => ({
  CONFIG: { encryptionKey: Buffer.from("00".repeat(32), "hex") },
}));

vi.mock("../crypto.js", () => ({
  decrypt: vi.fn(() => state.decryptedSecret),
}));

vi.mock("../db.js", () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(async () => state.agent),
      findMany: vi.fn(async () => state.agent ? [state.agent] : []),
    },
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

function makeReq(rawBody: Buffer, signature?: string): Request {
  return {
    params: { spacesAppId: "spaces-app-1" },
    headers: signature ? { "x-xyne-signature": signature } : {},
    rawBody,
  } as unknown as Request;
}

describe("verifySpacesSignatureEnforced", () => {
  beforeEach(() => {
    state.agent = { id: "agent-1", signingSecret: state.signingSecret };
  });

  it("rejects a missing signature even when the legacy verifier is in warn mode", async () => {
    const { verifySpacesSignatureEnforced } = await import("./verify-spaces-signature.js");
    const req = makeReq(Buffer.from('{"action":"approve"}'));
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await verifySpacesSignatureEnforced(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "missing X-Xyne-Signature" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a forged signature", async () => {
    const { verifySpacesSignatureEnforced } = await import("./verify-spaces-signature.js");
    const req = makeReq(Buffer.from('{"action":"approve"}'), "00".repeat(32));
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await verifySpacesSignatureEnforced(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "invalid signature" });
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid Spaces HMAC over the raw approval body", async () => {
    const { verifySpacesSignatureEnforced } = await import("./verify-spaces-signature.js");
    const raw = Buffer.from('{"action":"approve","actorUserId":"user-1"}');
    const signature = createHmac("sha256", state.decryptedSecret).update(raw).digest("hex");
    const req = makeReq(raw, signature);
    const res = makeRes();
    const next: NextFunction = vi.fn();

    await verifySpacesSignatureEnforced(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
