/**
 * SECURITY REGRESSION TEST — review_room design-share org gate must not trust
 * a client-supplied `x-user-id` header on the PUBLIC design-share endpoints.
 *
 * Wiring under test (exact copy of http/routes.ts:120):
 *   app.use(`${BASE}/public/design-shares`, optionalAuth, publicDesignSharesRouter);
 *
 * The attack this test pins down: `optionalAuth` never rejects. With no cookie
 * session it PRESERVES a client-supplied `x-user-id` (and even attaches that
 * user's org context). `authorizePublicShare` then gates review_room shares on
 * `isOrgMember(getRequesterId(req), share.orgId)` — a pure DB lookup — so an
 * unauthenticated caller holding only the share token can pass the org gate by
 * sending `x-user-id: <any org member id>`.
 *
 * These tests assert the SECURE behavior:
 *   - an unauthenticated caller with a spoofed member header must be refused
 *   - anonymous `design`-kind shares must keep working (no identity required)
 *
 * On the vulnerable code the first test FAILS (the spoof returns 200 + content).
 * After the fix in require-auth.ts optionalAuth (delete unverified x-user-id),
 * all tests pass.
 */
import { beforeEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

const state = vi.hoisted(() => ({
  // user-1 is an org-1 member; user-2 is NOT. The attacker knows user-1's id.
  orgMembers: [["user-1", "org-1"]] as Array<[string, string]>,
  shares: new Map<string, Record<string, unknown>>(), // tokenHash -> share
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    encryptionKey: Buffer.alloc(32, 9),
    spacesAppUrl: "https://app.spaces.xyne.juspay.net/claw",
    spacesInternalUrl: "http://spaces.internal.test",
    xyneClawS2sKey: "test-s2s-key",
    cliTokensEnabled: false,
  },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../lib/users-jit.js", () => ({ ensureUserExists: vi.fn(async () => undefined) }));
vi.mock("../lib/session-tokens.js", () => ({ checkResultCallbackToken: vi.fn() }));
vi.mock("../lib/cli-tokens.js", () => ({ verify: vi.fn(async () => null) }));
vi.mock("../repositories/index.js", () => ({
  userRoleRepository: { findByUserAndRole: vi.fn(async () => null) },
  agentShareRepository: {},
  agentRepository: {},
}));
vi.mock("../db.js", () => ({
  prisma: {
    // Used by require-auth attachOrgContext when a (spoofed) pinned user is resolved.
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "user-1" ? { orgId: "org-1" } : undefined),
    },
    orgMember: {
      findUnique: vi.fn(async ({ where }: { where: { userId_orgId: { userId: string; orgId: string } } }) =>
        where.userId_orgId.userId === "user-1" && where.userId_orgId.orgId === "org-1"
          ? { role: "MEMBER" }
          : null),
    },
    designArtifactShare: {
      findUnique: vi.fn(async (args: { where: { tokenHash: string }; include?: unknown }) => {
        const share = state.shares.get(args.where.tokenHash);
        if (!share) return null;
        return args.include
          ? { ...share, attachment: { size: 1024, url: "designs/review.html", originalFilename: "review.html" } }
          : share;
      }),
      update: vi.fn(async () => null),
    },
  },
}));
vi.mock("./organizations.js", () => ({
  isOrgMember: async (userId: string, orgId: string) =>
    state.orgMembers.some(([u, o]) => u === userId && o === orgId),
}));
vi.mock("../services/storageService.js", () => ({
  gcsService: {
    createReadStream: () => Readable.from(["<html>CONFIDENTIAL REVIEW ROOM DESIGN</html>"]),
  },
}));
vi.mock("../middleware/rate-limiters.js", () => ({
  publicShareLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

async function startApp(): Promise<{ server: Server; port: number }> {
  const { optionalAuth } = await import("../middleware/require-auth.js");
  const { publicDesignSharesRouter } = await import("./design-shares.js");
  const app = express();
  // EXACT wiring of http/routes.ts:120
  app.use("/claw/api/v1/public/design-shares", optionalAuth, publicDesignSharesRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, port: address.port };
}

function seedShare(kind: "design" | "review_room"): { rawToken: string } {
  const rawToken = randomBytes(32).toString("base64url"); // matches TOKEN_RE {40,80}
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  state.shares.set(tokenHash, {
    id: `share-${kind}`,
    kind,
    orgId: "org-1",
    ownerUserId: "user-1",
    title: kind === "review_room" ? "Q4 board review" : "Checkout page",
    tokenHash,
    revokedAt: null,
    expiresAt: null,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { rawToken };
}

describe("public design-shares: review_room org gate vs spoofed x-user-id (optionalAuth)", () => {
  let port: number;
  let server: Server;

  beforeAll(async () => {
    ({ server, port } = await startApp());
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(() => {
    state.shares.clear();
    vi.clearAllMocks();
  });

  it("REFUSES an unauthenticated caller who spoofs an org member's x-user-id (metadata)", async () => {
    const { rawToken } = seedShare("review_room");
    const res = await fetch(`http://127.0.0.1:${port}/claw/api/v1/public/design-shares/metadata`, {
      headers: { "x-design-share-token": rawToken, "x-user-id": "user-1" }, // no cookies, no token auth
    });
    const body = (await res.json()) as Record<string, unknown>;
    // SECURE: identity was never verified → auth_required. VULNERABLE: 200 + metadata.
    expect(
      `status=${res.status} body=${JSON.stringify(body)}`,
      "spoofed x-user-id must not satisfy the review_room org gate",
    ).toMatch(/^status=401/);
  });

  it("REFUSES the same spoof on /content (the actual design HTML)", async () => {
    const { rawToken } = seedShare("review_room");
    const res = await fetch(`http://127.0.0.1:${port}/claw/api/v1/public/design-shares/content`, {
      headers: { "x-design-share-token": rawToken, "x-user-id": "user-1" },
    });
    const text = await res.text();
    expect(
      `status=${res.status} body=${text.slice(0, 80)}`,
      "spoofed x-user-id must not unlock review_room content",
    ).toMatch(/^status=(401|404)/);
    expect(text).not.toContain("CONFIDENTIAL REVIEW ROOM DESIGN");
  });

  it("still refuses a non-member spoof AND a headerless anonymous caller on review_room", async () => {
    const { rawToken } = seedShare("review_room");
    const nonMember = await fetch(`http://127.0.0.1:${port}/claw/api/v1/public/design-shares/metadata`, {
      headers: { "x-design-share-token": rawToken, "x-user-id": "user-2" }, // real user, NOT an org member
    });
    // Pre-fix: spoofed non-member identity → 404 (masked not_found).
    // Post-fix: any unauthenticated caller → 401 auth_required. Both are refusals.
    expect([401, 404]).toContain(nonMember.status);
    const headerless = await fetch(`http://127.0.0.1:${port}/claw/api/v1/public/design-shares/metadata`, {
      headers: { "x-design-share-token": rawToken },
    });
    expect(headerless.status).toBe(401);
  });

  it("does NOT break anonymous viewing of design-kind shares (no identity required)", async () => {
    const { rawToken } = seedShare("design");
    const meta = await fetch(`http://127.0.0.1:${port}/claw/api/v1/public/design-shares/metadata`, {
      headers: { "x-design-share-token": rawToken },
    });
    expect(meta.status).toBe(200);
    const content = await fetch(`http://127.0.0.1:${port}/claw/api/v1/public/design-shares/content`, {
      headers: { "x-design-share-token": rawToken },
    });
    expect(content.status).toBe(200);
  });
});
