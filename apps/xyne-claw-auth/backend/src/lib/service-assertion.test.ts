import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";

const pem = (k: KeyObject, type: "pkcs8" | "spki") => k.export({ type, format: "pem" } as never).toString();
const claw = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const runtime = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const spaces = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const m = vi.hoisted(() => ({ seen: new Set<string>(), redisDown: false }));
vi.mock("../config.js", () => ({
  CONFIG: {
    clawServicePrivateKey: "", clawServiceKeyId: "claw-1",
    spacesDelegationPublicKeys: {} as Record<string, string>,
    clawRuntimePublicKeys: {} as Record<string, string>,
  },
}));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (k: string) => {
        if (m.redisDown) throw new Error("down");
        if (m.seen.has(k)) return null;
        m.seen.add(k);
        return "OK";
      },
    }),
  },
}));

import { CONFIG } from "../config.js";
import { authenticateCaller, requireService, serviceAuthHeaders, signServiceAssertion, verifyServiceAssertion } from "./service-assertion.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function forge(key: ReturnType<typeof generateKeyPairSync>["privateKey"], claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: "ES256", typ: "xyne-service+jwt", kid: "runtime-1", ...header };
  const p = { iss: "xyne-claw", aud: "xyne-claw-auth", iat: now, exp: now + 60, jti: randomUUID(), htm: "POST", htu: "/claw/api/v1/internal/sessions/s1", ...claims };
  const input = `${b64(h)}.${b64(p)}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
const opts = { allow: ["xyne-claw"] as const, method: "POST", path: "/claw/api/v1/internal/sessions/s1" };

beforeEach(() => {
  m.seen.clear(); m.redisDown = false;
  Object.assign(CONFIG, {
    clawServicePrivateKey: pem(claw.privateKey, "pkcs8"),
    clawRuntimePublicKeys: { "runtime-1": pem(runtime.publicKey, "spki") },
    spacesDelegationPublicKeys: { "spaces-1": pem(spaces.publicKey, "spki") },
  });
});

describe("service assertions", () => {
  it("accepts the runtime's signed, request-bound assertion", () => {
    expect(verifyServiceAssertion(forge(runtime.privateKey, {}), opts)).toMatchObject({ iss: "xyne-claw" });
  });

  it("refuses a key that isn't that issuer's (no cross-signing, no stranger keys)", () => {
    expect(verifyServiceAssertion(forge(stranger.privateKey, {}), opts)).toBe("bad-signature");
    // Spaces' key claiming to be the runtime
    expect(verifyServiceAssertion(forge(spaces.privateKey, {}, { kid: "spaces-1" }), opts)).toBe("unknown-key");
  });

  it("refuses issuers the route doesn't allow, other audiences, types and requests", () => {
    expect(verifyServiceAssertion(forge(spaces.privateKey, { iss: "xyne-spaces" }, { kid: "spaces-1" }), opts)).toBe("issuer-not-allowed");
    expect(verifyServiceAssertion(forge(runtime.privateKey, { aud: "xyne-spaces" }), opts)).toBe("wrong-audience");
    expect(verifyServiceAssertion(forge(runtime.privateKey, {}, { typ: "JWT" }), opts)).toBe("wrong-type");
    expect(verifyServiceAssertion(forge(runtime.privateKey, {}, { alg: "HS256" }), opts)).toBe("wrong-type");
    expect(verifyServiceAssertion(forge(runtime.privateKey, { htu: "/claw/api/v1/internal/sessions/other" }), opts)).toBe("not-bound-to-request");
    expect(verifyServiceAssertion(forge(runtime.privateKey, { htm: "GET" }), opts)).toBe("not-bound-to-request");
  });

  it("refuses expired and long-lived assertions", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyServiceAssertion(forge(runtime.privateKey, { iat: now - 600, exp: now - 500 }), opts)).toBe("expired");
    expect(verifyServiceAssertion(forge(runtime.privateKey, { iat: now, exp: now + 3600 }), opts)).toBe("lifetime-too-long");
  });

  it("claw-auth's own assertion verifies for self-calls; the path ignores the query", () => {
    const h = serviceAuthHeaders("xyne-claw-auth", "post", "http://claw-auth.internal:3003/claw/api/v1/flow/action?x=1");
    expect(verifyServiceAssertion(h["x-service-assertion"], { allow: ["xyne-claw-auth"], method: "POST", path: "/claw/api/v1/flow/action" })).toMatchObject({ iss: "xyne-claw-auth" });
    expect(signServiceAssertion("xyne-spaces", "GET", "/x").split(".")).toHaveLength(3);
  });

  it("each assertion is accepted once; Redis down fails closed", async () => {
    const token = forge(runtime.privateKey, {});
    const req = () => ({ method: "POST", originalUrl: opts.path, headers: { "x-service-assertion": token } }) as never;
    expect(await authenticateCaller(req(), ["xyne-claw"])).toBe("xyne-claw");
    expect(await authenticateCaller(req(), ["xyne-claw"])).toBe("rejected");
    m.redisDown = true;
    const fresh = forge(runtime.privateKey, {});
    expect(await authenticateCaller({ method: "POST", originalUrl: opts.path, headers: { "x-service-assertion": fresh } } as never, ["xyne-claw"])).toBe("unavailable");
  });

  it("a request is verified once even when two gates check it", async () => {
    const r = { method: "POST", originalUrl: opts.path, headers: { "x-service-assertion": forge(runtime.privateKey, {}) } } as never;
    expect(await authenticateCaller(r, ["xyne-claw"])).toBe("xyne-claw");
    expect(await authenticateCaller(r, ["xyne-claw", "xyne-claw-auth"])).toBe("xyne-claw");
    expect(await authenticateCaller(r, ["xyne-spaces"])).toBe("rejected");
  });

  it("requireService: 401 without an assertion (an old shared key is just ignored)", async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await requireService("xyne-claw")({ method: "POST", originalUrl: opts.path, headers: { "x-s2s-key": "anything" } } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
