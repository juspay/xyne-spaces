import { createHmac } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../crypto.js";

const mocks = vi.hoisted(() => ({
  key: Buffer.from("11".repeat(32), "hex"),
  agent: null as { id: string; signingSecret: string | null } | null,
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: mocks.key } }));
vi.mock("../db.js", () => ({
  prisma: {
    agent: {
      findFirst: vi.fn(async () => mocks.agent),
      findMany: vi.fn(async () => mocks.agent ? [{ ...mocks.agent, orgId: "org-1" }] : []),
    },
  },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: mocks.warn, error: mocks.error }),
}));

import { verifySpacesSignature } from "./verify-spaces-signature.js";

function storedSecret(plaintext: string): string {
  const encrypted = encrypt(plaintext, mocks.key);
  return `${encrypted.ciphertext}:${encrypted.iv}:${encrypted.authTag}`;
}

function request(rawBody: Buffer, signature?: string, event?: string): Request {
  return {
    params: { spacesAppId: "app-1" },
    headers: {
      ...(signature ? { "x-xyne-signature": signature } : {}),
      ...(event ? { "x-xyne-event": event } : {}),
    },
    rawBody,
  } as unknown as Request;
}

function response(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn();
  const res = { status, json } as unknown as Response;
  status.mockReturnValue(res);
  return { res, status, json };
}

describe("verifySpacesSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agent = { id: "agent-1", signingSecret: storedSecret("signing-secret") };
  });

  it.each([
    ["missing stored secret", null, "no_stored_secret"],
    ["malformed stored secret", "not-a-gcm-bundle", "malformed_secret_blob"],
    ["undecryptable stored secret", "YQ==:Yg==:Yw==", "decrypt_failed"],
  ])("fails closed for %s", async (_name, signingSecret, reason) => {
    mocks.agent = { id: "agent-1", signingSecret };
    const { res, status } = response();
    const next = vi.fn() as NextFunction;

    await verifySpacesSignature(request(Buffer.from("{}")), res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining(`reason=${reason}`));
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("rejected"));
  });

  it("fails closed when the signature header is absent", async () => {
    const { res, status } = response();
    const next = vi.fn() as NextFunction;

    await verifySpacesSignature(request(Buffer.from("{}")), res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("reason=no_signature_header"));
  });

  it("fails closed for an invalid signature", async () => {
    const { res, status } = response();
    const next = vi.fn() as NextFunction;

    await verifySpacesSignature(request(Buffer.from("{}"), "00".repeat(32)), res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("reason=mismatch"));
  });

  it("calls next only for a valid signature", async () => {
    const rawBody = Buffer.from('{"eventType":"APP_MENTIONED"}');
    const signature = createHmac("sha256", "signing-secret").update(rawBody).digest("hex");
    const { res, status } = response();
    const next = vi.fn() as NextFunction;

    await verifySpacesSignature(request(rawBody, signature), res, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
