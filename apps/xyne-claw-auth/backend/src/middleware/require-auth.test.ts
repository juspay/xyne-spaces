import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

vi.mock("../logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

function extractAppUseMounts(source: string): string[] {
  const mounts: string[] = [];
  let searchFrom = 0;

  while (true) {
    const appUseIndex = source.indexOf("app.use", searchFrom);
    if (appUseIndex === -1) {
      break;
    }

    const openParenIndex = source.indexOf("(", appUseIndex);
    if (openParenIndex === -1) {
      break;
    }

    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    let foundCloseParen = false;

    for (let index = openParenIndex; index < source.length; index += 1) {
      const char = source[index];
      const nextChar = source[index + 1];
      const previousChar = source[index - 1];

      if (inLineComment) {
        if (char === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (char === "*" && nextChar === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (inSingleQuote) {
        if (char === "'" && previousChar !== "\\") {
          inSingleQuote = false;
        }
        continue;
      }

      if (inDoubleQuote) {
        if (char === "\"" && previousChar !== "\\") {
          inDoubleQuote = false;
        }
        continue;
      }

      if (inTemplate) {
        if (char === "`" && previousChar !== "\\") {
          inTemplate = false;
        }
        continue;
      }

      if (char === "/" && nextChar === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "'") {
        inSingleQuote = true;
        continue;
      }

      if (char === "\"") {
        inDoubleQuote = true;
        continue;
      }

      if (char === "`") {
        inTemplate = true;
        continue;
      }

      if (char === "(") {
        depth += 1;
        continue;
      }

      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          mounts.push(source.slice(appUseIndex, index + 1));
          searchFrom = index + 1;
          foundCloseParen = true;
          break;
        }
      }
    }

    if (!foundCloseParen) {
      searchFrom = openParenIndex + 1;
    }
  }

  return mounts;
}

function findRequireAuthMountsMissingBarrier(mounts: string[]): string[] {
  return mounts.filter((mount) =>
    mount.includes("requireAuth")
    && !mount.includes("requireNoAccessToken")
    && !mount.includes("runRouter")
  );
}

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

describe("requireNoAccessToken barrier", () => {
  beforeEach(() => {
    state.rawToken = "";
    state.verifyCalls = 0;
    state.config.cliTokensEnabled = true;
  });

  it("rejects requests authenticated via a CLI/service access token", async () => {
    const { requireAuth, requireNoAccessToken } = await import("./require-auth.js");
    const req = {
      headers: {
        authorization: "Bearer xyne_cli_real",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const authNext: NextFunction = vi.fn();

    await requireAuth(req, res, authNext);
    expect(authNext).toHaveBeenCalledOnce();
    expect(state.rawToken).toBe("xyne_cli_real");

    const barrierNext: NextFunction = vi.fn();
    requireNoAccessToken(req, res, barrierNext);

    expect(barrierNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "ACCESS_TOKEN_NOT_ALLOWED",
        // Actionable: names both supported paths so an integrator whose token
        // stopped working knows what to do instead of guessing.
        error: expect.stringContaining("/run"),
      }),
    );
  });

  it("allows requests that are not access-token authenticated", async () => {
    const { requireNoAccessToken } = await import("./require-auth.js");
    const req = {
      headers: {
        "x-s2s-key": "s2s-secret",
        "x-user-id": "service-account",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    requireNoAccessToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("main.ts requireAuth mount policy", () => {
  it("keeps requireNoAccessToken on every requireAuth mount except runRouter", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(resolve(testDir, "../main.ts"), "utf8");
    const mounts = extractAppUseMounts(mainSource);

    expect(mounts.length).toBeGreaterThan(0);

    const guardedMount = mounts.find((mount) =>
      mount.includes("requireAuth")
      && mount.includes("requireNoAccessToken")
      && !mount.includes("runRouter")
    );
    expect(guardedMount).toBeDefined();

    if (guardedMount === undefined) {
      throw new Error("Expected at least one non-runRouter requireAuth mount with requireNoAccessToken");
    }

    const mutatedMount = guardedMount.replace("requireNoAccessToken, ", "");
    const mutatedMounts = mounts.map((mount) =>
      mount === guardedMount ? mutatedMount : mount
    );
    expect(findRequireAuthMountsMissingBarrier(mutatedMounts)).toEqual([mutatedMount]);

    const violations = findRequireAuthMountsMissingBarrier(mounts);
    expect(
      violations,
      `Every app.use(...) mount with requireAuth must also include requireNoAccessToken, except runRouter.\n\nOffending mounts:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});

describe("requireResultToken — scheduled-jobs /result per-run gate", () => {
  // The scheduled-jobs /result route extracts the run's sessionId from the
  // request BODY (the pod posts it there), unlike run.ts which reads a path
  // param. Mirror that exact extractor so the test guards the real wiring.
  const scheduledExtractor = (req: Request): string | undefined =>
    (req.body as { sessionId?: string })?.sessionId;

  // The helper above returns before res/next mutate; run through a thin wrapper
  // that actually calls the middleware and reads final state.
  async function run(opts: { token?: string; body?: unknown }): Promise<{
    statusCode: number;
    error: string | undefined;
    nextCalled: boolean;
  }> {
    const { requireResultToken } = await import("./require-auth.js");
    const req = {
      headers: opts.token ? { "x-session-token": opts.token } : {},
      body: opts.body ?? {},
    } as unknown as Request;
    let statusCode = 0;
    let error: string | undefined;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: { error?: string }) {
        error = payload?.error;
        return this;
      },
    } as unknown as Response;
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };
    requireResultToken(scheduledExtractor)(req, res, next);
    return { statusCode, error, nextCalled };
  }

  async function mint(sessionId: string): Promise<string> {
    const { mintSessionToken } = await import("../lib/session-tokens.js");
    return mintSessionToken({
      sessionId,
      userId: "user-1",
      agentSlug: "xyne-spaces-architect",
      ttlSeconds: 3600,
    });
  }

  it("calls next() when the token's sid matches the body sessionId", async () => {
    const token = await mint("sess-abc");
    const out = await run({ token, body: { sessionId: "sess-abc" } });
    expect(out.nextCalled).toBe(true);
    expect(out.statusCode).toBe(0);
  });

  it("rejects (401) when the token is for a different session", async () => {
    const token = await mint("sess-abc");
    const out = await run({ token, body: { sessionId: "sess-OTHER" } });
    expect(out.nextCalled).toBe(false);
    expect(out.statusCode).toBe(401);
    expect(out.error).toContain("sid-mismatch");
  });

  it("rejects (401) when no x-session-token header is present (S2S key alone)", async () => {
    const out = await run({ body: { sessionId: "sess-abc" } });
    expect(out.nextCalled).toBe(false);
    expect(out.statusCode).toBe(401);
    expect(out.error).toContain("malformed");
  });

  it("rejects (401) when the token signature is tampered", async () => {
    const token = await mint("sess-abc");
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    const out = await run({ token: tampered, body: { sessionId: "sess-abc" } });
    expect(out.nextCalled).toBe(false);
    expect(out.statusCode).toBe(401);
    expect(out.error).toContain("bad-signature");
  });
});
