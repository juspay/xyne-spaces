import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature, isKnownVerifier, knownVerifierSources } from "./verify.js";

const SECRET = "s3cr3t-signing-key";

function sign(body: Buffer, prefix = "sha256="): string {
  return prefix + createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("verifySignature — github-hmac-sha256", () => {
  it("accepts a correct GitHub-style signature over the raw bytes", () => {
    const raw = Buffer.from(JSON.stringify({ action: "created", number: 123 }));
    const res = verifySignature("github-hmac-sha256", {
      rawBody: raw,
      headers: { "x-hub-signature-256": sign(raw) },
      signingSecret: SECRET,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const signed = Buffer.from(JSON.stringify({ action: "created", number: 123 }));
    const tampered = Buffer.from(JSON.stringify({ action: "created", number: 999 }));
    const res = verifySignature("github-hmac-sha256", {
      rawBody: tampered,
      headers: { "x-hub-signature-256": sign(signed) },
      signingSecret: SECRET,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects when the signature header is absent", () => {
    const raw = Buffer.from("{}");
    const res = verifySignature("github-hmac-sha256", { rawBody: raw, headers: {}, signingSecret: SECRET });
    expect(res.ok).toBe(false);
  });

  it("rejects an empty body", () => {
    const res = verifySignature("github-hmac-sha256", {
      rawBody: Buffer.alloc(0),
      headers: { "x-hub-signature-256": sign(Buffer.alloc(0)) },
      signingSecret: SECRET,
    });
    expect(res.ok).toBe(false);
  });
});

describe("verifySignature — hmac-sha256 (bare hex, custom header)", () => {
  it("accepts a bare-hex signature in a custom header", () => {
    const raw = Buffer.from("payload");
    const res = verifySignature("hmac-sha256", {
      rawBody: raw,
      headers: { "x-my-sig": sign(raw, "") },
      signingSecret: SECRET,
      signatureHeader: "x-my-sig",
    });
    expect(res.ok).toBe(true);
  });
});

describe("verifySignature — header-token", () => {
  it("accepts a matching token and rejects a wrong one", () => {
    const ok = verifySignature("header-token", {
      rawBody: undefined,
      headers: { "x-webhook-token": SECRET },
      signingSecret: SECRET,
    });
    expect(ok.ok).toBe(true);
    const bad = verifySignature("header-token", {
      rawBody: undefined,
      headers: { "x-webhook-token": "wrong" },
      signingSecret: SECRET,
    });
    expect(bad.ok).toBe(false);
  });
});

describe("verifySignature — unknown source fails closed", () => {
  it("denies an unregistered verifier instead of accepting", () => {
    const res = verifySignature("totally-made-up", {
      rawBody: Buffer.from("x"),
      headers: {},
      signingSecret: SECRET,
    });
    expect(res.ok).toBe(false);
  });
  it("isKnownVerifier / knownVerifierSources reflect the registry", () => {
    expect(isKnownVerifier("github-hmac-sha256")).toBe(true);
    expect(isKnownVerifier("totally-made-up")).toBe(false);
    expect(knownVerifierSources()).toContain("header-token");
  });
});
