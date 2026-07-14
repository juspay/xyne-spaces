import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);
process.env["CLI_TOKENS_ENABLED"] = "true";

const state = vi.hoisted(() => ({
  rawToken: "",
  verifyCalls: 0,
  config: {
    cliTokensEnabled: true,
    xyneClawS2sKey: "s2s-secret",
    spacesInternalUrl: "http://spaces.local",
    encryptionKey: Buffer.from("00".repeat(32), "hex"),
  },
}));

vi.mock("../config.js", () => ({
  CONFIG: state.config,
}));

vi.mock("../lib/cli-tokens.js", () => ({
  verify: vi.fn(async (raw: string | undefined) => {
    state.verifyCalls += 1;
    state.rawToken = raw ?? "";
    if (raw === "xyne_cli_real") {
      return { userId: "token-owner", orgId: "org-token", scopes: ["agents:read"] };
    }
    return null;
  }),
}));

vi.mock("../lib/users-jit.js", () => ({
  ensureUserExists: vi.fn(async () => undefined),
}));

vi.mock("../db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    orgMember: { findUnique: vi.fn() },
  },
}));

describe("requireAuth CLI bearer branch", () => {
  beforeEach(() => {
    state.rawToken = "";
    state.verifyCalls = 0;
    state.config.cliTokensEnabled = true;
  });

  it("overwrites a forged x-user-id with the CLI token owner", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const req = {
      headers: {
        authorization: "Bearer xyne_cli_real",
        "x-user-id": "forged-user",
        "x-org-id": "forged-org",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(state.rawToken).toBe("xyne_cli_real");
    expect(req.headers["x-user-id"]).toBe("token-owner");
    expect(req.headers["x-org-id"]).toBe("org-token");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("ignores CLI bearer tokens when CLI_TOKENS_ENABLED is off", async () => {
    state.config.cliTokensEnabled = false;
    const { requireAuth } = await import("./require-auth.js");
    const req = {
      headers: {
        authorization: "Bearer xyne_cli_real",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(state.verifyCalls).toBe(0);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects CLI bearer tokens on strict S2S endpoints", async () => {
    const { requireStrictS2S } = await import("./require-auth.js");
    const req = {
      headers: {
        authorization: "Bearer xyne_cli_real",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    requireStrictS2S(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
