import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from "jose";

process.env["ENCRYPTION_KEY"] = "00".repeat(32);
const state = vi.hoisted(() => ({ keys: {} as Record<string, string> }));
vi.mock("../config.js", () => ({ CONFIG: { get spacesDelegationPublicKeys() { return state.keys; } } }));

let priv: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  priv = pair.privateKey;
  state.keys = { "spaces-1": await exportSPKI(pair.publicKey) };
});

const body = Buffer.from(JSON.stringify({ eventType: "APP_MENTION", payload: { userId: "alice", workspaceId: "ws1" } }));
const bh = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function eventToken(o: { typ?: string; pid?: string; bh?: string; sub?: string; noJti?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const j = new SignJWT({ ws: "ws1", pid: o.pid ?? "p1", bh: o.bh ?? bh(body), prp: "event:APP_MENTION" })
    .setProtectedHeader({ alg: "ES256", kid: "spaces-1", typ: o.typ ?? "claw-event+jwt" })
    .setIssuer("xyne-spaces").setAudience("xyne-claw-auth").setSubject(o.sub ?? "alice")
    .setIssuedAt(now).setExpirationTime(now + 300);
  if (!o.noJti) j.setJti("jti-1");
  return j.sign(priv);
}

describe("verifySpacesEvent", () => {
  it("accepts a token for this principal over this exact body", async () => {
    const { verifySpacesEvent } = await import("./spaces-delegation.js");
    const r = await verifySpacesEvent(await eventToken(), "p1", body);
    expect(r).toMatchObject({ spacesUserId: "alice", workspaceId: "ws1", principalId: "p1", jti: "jti-1" });
  });
  it.each([
    ["for another principal", { pid: "p2" }, "wrong-principal"],
    ["over a different body", { bh: "00" }, "body-mismatch"],
    ["of a different type (a plain delegation token)", { typ: "JWT" }, "invalid"],
    ["without jti", { noJti: true }, "invalid"],
  ])("rejects a token %s", async (_n, o, reason) => {
    const { verifySpacesEvent } = await import("./spaces-delegation.js");
    expect(await verifySpacesEvent(await eventToken(o), "p1", body)).toBe(reason);
  });
  it("rejects when the body was changed after signing", async () => {
    const { verifySpacesEvent } = await import("./spaces-delegation.js");
    const tampered = Buffer.from(body.toString().replace("alice", "mallory"));
    expect(await verifySpacesEvent(await eventToken(), "p1", tampered)).toBe("body-mismatch");
  });
});

describe("verifySpacesDelegation", () => {
  it("refuses an event token as a delegation (it authenticates one delivery, not a user)", async () => {
    const { verifySpacesDelegation } = await import("./spaces-delegation.js");
    expect(await verifySpacesDelegation(await eventToken())).toBe("invalid");
    const asDelegation = await verifySpacesDelegation(await eventToken({ typ: "JWT" }));
    expect(typeof asDelegation).toBe("object");
  });
});
