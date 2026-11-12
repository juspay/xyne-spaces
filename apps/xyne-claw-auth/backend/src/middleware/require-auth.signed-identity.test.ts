import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { generateKeyPairSync, randomUUID, sign as signRaw } from "node:crypto";

const runtimeKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A runtime service assertion for GET /claw/api/v1/test (what call() sends). */
function runtimeAssertion(key = runtimeKeys.privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "ES256", typ: "xyne-service+jwt", kid: "runtime-1" })}.${b64({ iss: "xyne-claw", aud: "xyne-claw-auth", iat: now, exp: now + 60, jti: randomUUID(), htm: "GET", htu: "/claw/api/v1/test" })}`;
  return `${input}.${signRaw("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

process.env["ENCRYPTION_KEY"] = "00".repeat(32);

const state = vi.hoisted(() => ({
  clawUserId: undefined as string | undefined,
  config: {
    cliTokensEnabled: false,
    clawServicePrivateKey: "",
    clawServiceKeyId: "claw-1",
    clawRuntimePublicKeys: {} as Record<string, string>,
    spacesInternalUrl: "http://spaces.local",
    encryptionKey: Buffer.from("00".repeat(32), "hex"),
    sessionSigningKey: Buffer.from("11".repeat(32), "hex"),
    legacySessionSigningKey: Buffer.from("22".repeat(32), "hex"),
    spacesDelegationPublicKeys: {} as Record<string, string>,
  },
}));

vi.mock("../config.js", () => ({ CONFIG: state.config }));
const seenJti = vi.hoisted(() => new Set<string>());
vi.mock("../redis.js", () => ({
  redisService: { getConnection: () => ({ set: async (k: string) => (seenJti.has(k) ? null : (seenJti.add(k), "OK")) }) },
}));
vi.mock("../lib/cli-tokens.js", () => ({ verify: vi.fn(async () => null) }));
vi.mock("../lib/users-jit.js", () => ({
  ensureUserExists: vi.fn(async () => undefined),
  resolveClawUserIdForSpacesIdentity: vi.fn(async () => state.clawUserId),
}));
vi.mock("../db.js", () => ({
  prisma: { user: { findUnique: vi.fn() }, orgMember: { findUnique: vi.fn() } },
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  state.config.spacesDelegationPublicKeys = { "spaces-1": await exportSPKI(pair.publicKey) };
  state.config.clawRuntimePublicKeys = { "runtime-1": runtimeKeys.publicKey.export({ type: "spki", format: "pem" }).toString() };
  otherPrivateKey = (await generateKeyPair("ES256")).privateKey;
});

async function delegation(opts: {
  sub?: string;
  ws?: string;
  kid?: string;
  key?: CryptoKey;
  aud?: string;
  iss?: string;
  lifetimeSeconds?: number;
  expiredSecondsAgo?: number;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = opts.expiredSecondsAgo ? now - opts.expiredSecondsAgo - (opts.lifetimeSeconds ?? 300) : now;
  const jwt = new SignJWT({ ...(opts.ws ? { ws: opts.ws } : {}), prp: "test" })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "spaces-1" })
    .setIssuer(opts.iss ?? "xyne-spaces")
    .setAudience(opts.aud ?? "xyne-claw-auth")
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.lifetimeSeconds ?? 300))
    .setJti("jti-1");
  if (opts.sub !== "") jwt.setSubject(opts.sub ?? "spaces-user-1");
  return jwt.sign(opts.key ?? privateKey);
}

function call(headers: Record<string, string>) {
  const req = { method: "GET", originalUrl: "/claw/api/v1/test", headers: { ...headers } } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req, res, next };
}

describe("requireAuth: Spaces delegation token", () => {
  beforeEach(() => {
    state.clawUserId = "claw-canonical-1";
  });

  it("takes the user from the token and ignores a caller-chosen x-user-id", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const { req, res, next } = call({
      "x-spaces-delegation": await delegation({ ws: "ws-1" }),
      "x-s2s-key": "s2s-secret",
      "x-user-id": "victim",
      "x-spaces-user-id": "victim",
    });
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.headers["x-user-id"]).toBe("claw-canonical-1");
    expect(req.headers["x-spaces-user-id"]).toBe("spaces-user-1");
    expect(req.headers["x-spaces-workspace-id"]).toBe("ws-1");
  });

  it.each([
    ["signed with an unknown key", async () => delegation({ key: otherPrivateKey })],
    ["unknown kid", async () => delegation({ kid: "nope" })],
    ["wrong audience", async () => delegation({ aud: "someone-else" })],
    ["wrong issuer", async () => delegation({ iss: "someone-else" })],
    ["expired", async () => delegation({ expiredSecondsAgo: 120 })],
    ["lifetime over 10 minutes", async () => delegation({ lifetimeSeconds: 3600 })],
    ["no subject", async () => delegation({ sub: "" })],
    ["garbage", async () => "not-a-jwt"],
  ])("rejects a token %s with 401, even alongside a valid S2S key", async (_name, make) => {
    const { requireAuth } = await import("./require-auth.js");
    const { req, res, next } = call({
      "x-spaces-delegation": await make(),
      "x-s2s-key": "s2s-secret",
      "x-user-id": "victim",
    });
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("requireAuth: run token", () => {
  it("takes the user from the run token (with the runtime's assertion) and sets req.session", async () => {
    const { mintSessionToken } = await import("../lib/session-tokens.js");
    const { requireAuth } = await import("./require-auth.js");
    const token = mintSessionToken({ sessionId: "sess-1", userId: "claw-user-9", agentSlug: "a", ttlSeconds: 600 });
    const { req, res, next } = call({ "x-session-token": token, "x-service-assertion": runtimeAssertion(), "x-user-id": "victim" });
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.headers["x-user-id"]).toBe("claw-user-9");
    expect(req.session).toMatchObject({ userId: "claw-user-9", sessionId: "sess-1", agentSlug: "a" });
  });

  it("rejects a run token without a runtime assertion (not a general bearer), even with an old shared key", async () => {
    const { mintSessionToken } = await import("../lib/session-tokens.js");
    const { requireAuth } = await import("./require-auth.js");
    const token = mintSessionToken({ sessionId: "sess-1", userId: "claw-user-9", ttlSeconds: 600 });
    for (const headers of [{ "x-session-token": token }, { "x-session-token": token, "x-s2s-key": "s2s-secret" }]) {
      const { req, res, next } = call(headers);
      await requireAuth(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  it("rejects a run token with an assertion signed by any other key", async () => {
    const { mintSessionToken } = await import("../lib/session-tokens.js");
    const { requireAuth } = await import("./require-auth.js");
    const token = mintSessionToken({ sessionId: "sess-1", userId: "claw-user-9", ttlSeconds: 600 });
    const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const { req, res, next } = call({ "x-session-token": token, "x-service-assertion": runtimeAssertion(stranger.privateKey) });
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a tampered run token with 401", async () => {
    const { mintSessionToken } = await import("../lib/session-tokens.js");
    const { requireAuth } = await import("./require-auth.js");
    const token = mintSessionToken({ sessionId: "sess-1", userId: "claw-user-9", ttlSeconds: 600 });
    const [payload] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), uid: "victim" })).toString("base64url")}.${token.split(".")[1]}`;
    const { req, res, next } = call({ "x-session-token": forged, "x-service-assertion": runtimeAssertion() });
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("requireAuth: no shared key — a service names no user", () => {
  beforeEach(() => {
    state.clawUserId = "claw-canonical-1";
  });

  it("a runtime assertion alone authenticates the service and names no user", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const { req, res, next } = call({
      "x-service-assertion": runtimeAssertion(),
      "x-user-id": "victim",
      "x-spaces-user-id": "victim",
      "x-spaces-workspace-id": "ws-victim",
    });
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.headers["x-user-id"]).toBeUndefined();
    expect(req.headers["x-spaces-user-id"]).toBeUndefined();
    expect(req.headers["x-spaces-workspace-id"]).toBeUndefined();
  });

  it("the old shared key header means nothing: 401", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const { req, res, next } = call({ "x-s2s-key": "s2s-secret", "x-user-id": "ws-member-1" });
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("a replayed assertion is refused", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const a = runtimeAssertion();
    const first = call({ "x-service-assertion": a });
    await requireAuth(first.req, first.res, first.next);
    expect(first.next).toHaveBeenCalledOnce();
    const again = call({ "x-service-assertion": a });
    await requireAuth(again.req, again.res, again.next);
    expect(again.next).not.toHaveBeenCalled();
  });

  it("no assertion and no token: 401", async () => {
    const { requireAuth } = await import("./require-auth.js");
    const { req, res, next } = call({ "x-user-id": "victim" });
    await requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
