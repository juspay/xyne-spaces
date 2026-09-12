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
  clawUserId: undefined as string | undefined,
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
  resolveClawUserIdForSpacesIdentity: vi.fn(async () => state.clawUserId),
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
    // Scope-aware read barrier counts too: it rejects token WRITES outright
    // and token READS without the named scope (see allowReadAccessToken).
    && !mount.includes("allowReadAccessToken(")
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

describe("x-spaces-* header trust boundary", () => {
  beforeEach(() => {
    state.rawToken = "";
    state.verifyCalls = 0;
    state.clawUserId = undefined;
    state.config.cliTokensEnabled = true;
  });

  it("strips forged x-spaces-* headers so a token caller cannot impersonate a Spaces identity", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const req = {
      headers: {
        authorization: "Bearer xyne_cli_real",
        "x-spaces-user-id": "victim-spaces-id",
        "x-spaces-workspace-id": "victim-workspace",
        "x-spaces-org-member-id": "victim-member",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.headers["x-user-id"]).toBe("token-owner");
    expect(req.headers["x-org-id"]).toBe("org-token");
    // The forged trust-bearing headers must NOT survive entry; only verified
    // branches (cookie /me success, or a validated S2S key) may stamp them.
    expect(req.headers["x-spaces-user-id"]).toBeUndefined();
    expect(req.headers["x-spaces-workspace-id"]).toBeUndefined();
    expect(req.headers["x-spaces-org-member-id"]).toBeUndefined();

    // Concretely: the pin/alias helpers must not treat the forged id as verified.
    const { matchesAuthenticatedUserId, getRequesterAliases } = await import("./pin-user-id-param.js");
    expect(matchesAuthenticatedUserId(req, "victim-spaces-id")).toBe(false);
    expect(matchesAuthenticatedUserId(req, "token-owner")).toBe(true);
    expect(getRequesterAliases(req)).toEqual(["token-owner"]);
  });

  it("keeps the verified S2S contract: a valid key may pin x-spaces-* identity", async () => {
    state.clawUserId = "claw-canonical-1";
    const { requireAuth } = await import("./require-auth.js");
    const req = {
      headers: {
        "x-s2s-key": "s2s-secret",
        "x-user-id": "ws-member-1",
        "x-spaces-user-id": "ws-member-1",
        "x-spaces-workspace-id": "ws-1",
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    // Canonical Claw id is stamped in x-user-id; the raw workspace identity is
    // retained on the side headers as the verified alias pair.
    expect(req.headers["x-user-id"]).toBe("claw-canonical-1");
    expect(req.headers["x-spaces-user-id"]).toBe("ws-member-1");
    expect(req.headers["x-spaces-workspace-id"]).toBe("ws-1");

    const { matchesAuthenticatedUserId } = await import("./pin-user-id-param.js");
    expect(matchesAuthenticatedUserId(req, "claw-canonical-1")).toBe(true);
    expect(matchesAuthenticatedUserId(req, "ws-member-1")).toBe(true);
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

describe("allowReadAccessToken scope barrier", () => {
  beforeEach(() => {
    state.rawToken = "";
    state.verifyCalls = 0;
    state.config.cliTokensEnabled = true;
  });

  /** requireAuth with the mock CLI token (scopes: ["agents:read"]), returning
   *  the res whose WeakMap entry the barrier will consult. */
  async function authedTokenRes(method: string): Promise<{ req: Request; res: Response }> {
    const { requireAuth } = await import("./require-auth.js");
    const req = {
      method,
      headers: { authorization: "Bearer xyne_cli_real" },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const authNext: NextFunction = vi.fn();
    await requireAuth(req, res, authNext);
    expect(authNext).toHaveBeenCalledOnce();
    return { req, res };
  }

  it("passes a GET when the token carries the required scope", async () => {
    const { allowReadAccessToken } = await import("./require-auth.js");
    const { req, res } = await authedTokenRes("GET");
    const next: NextFunction = vi.fn();

    allowReadAccessToken("agents:read")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a GET when the token lacks the required scope", async () => {
    const { allowReadAccessToken } = await import("./require-auth.js");
    const { req, res } = await authedTokenRes("GET");
    const next: NextFunction = vi.fn();

    allowReadAccessToken("runs:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "ACCESS_TOKEN_NOT_ALLOWED",
        error: expect.stringContaining("runs:read"),
      }),
    );
  });

  it("rejects token WRITES even when the read scope is present", async () => {
    const { allowReadAccessToken } = await import("./require-auth.js");
    const { req, res } = await authedTokenRes("POST");
    const next: NextFunction = vi.fn();

    allowReadAccessToken("agents:read")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ACCESS_TOKEN_NOT_ALLOWED" }),
    );
  });

  it("passes non-token callers (browser session / S2S) untouched, any method", async () => {
    const { allowReadAccessToken } = await import("./require-auth.js");
    const req = {
      method: "POST",
      headers: { "x-s2s-key": "s2s-secret", "x-user-id": "service-account" },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next: NextFunction = vi.fn();

    allowReadAccessToken("agents:read")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("main.ts requireAuth mount policy", () => {
  it("keeps requireNoAccessToken on every requireAuth mount except runRouter", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(resolve(testDir, "../http/routes.ts"), "utf8");
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
