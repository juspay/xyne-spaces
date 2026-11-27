import { describe, expect, it } from "vitest";
import { createHmac, createPublicKey, generateKeyPairSync, sign, verify, webcrypto, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  GIT_SCOPE_CLOCK_SKEW_SECONDS,
  GIT_SCOPE_MAX_TOKEN_LENGTH,
  GIT_SCOPE_REJECTIONS,
  GIT_SCOPE_TYP,
  GitScopeError,
  signGitScope,
  verifyGitScope,
  type GitScopePayload,
  type GitScopeRejection,
  type GitScopeVerification,
  type VerifyGitScopeOptions,
} from "./index.js";

// Set GIT_SCOPE_TEST_REPORT=1 to print how many altered tokens each attack test tried.
const report = (line: string): void => {
  if (process.env["GIT_SCOPE_TEST_REPORT"]) console.log(line);
};

const pem = (key: KeyObject, type: "pkcs8" | "spki"): string => key.export({ type, format: "pem" }).toString();
const p256 = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signer = p256();
const stranger = p256();
const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });

const PRIVATE = pem(signer.privateKey, "pkcs8");
const PUBLIC = pem(signer.publicKey, "spki");
const KID = "signer-1";
const NOW = 1_790_000_000;

const PAYLOAD: GitScopePayload = {
  v: 1,
  claim: "sbx-7f3a9c",
  ns: "sandboxes",
  tpl: "agent-workspace-template",
  profile: "example-profile",
  iat: NOW - 10,
  exp: NOW + 3600,
  repos: [
    { repo: "bitbucket.example.net/proj/service", access: "rw" },
    { repo: "github.com/example-org/app", access: "r" },
  ],
};
const OPTIONS: VerifyGitScopeOptions = {
  keys: { [KID]: PUBLIC },
  now: NOW,
  expected: { claim: "sbx-7f3a9c", namespace: "sandboxes", template: "agent-workspace-template" },
};

const b64 = (value: unknown): string => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64url");
const es256 = (key: KeyObject) => (input: string): Buffer => sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
const HEADER = { alg: "ES256", typ: GIT_SCOPE_TYP, kid: KID };

/** A token built by hand: any header, any payload, any signature. Strings are used as the exact bytes. */
function forge(header: unknown = HEADER, payload: unknown = PAYLOAD, signWith: (input: string) => Buffer = es256(signer.privateKey)): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${signWith(input).toString("base64url")}`;
}

const reasonOf = (result: GitScopeVerification): GitScopeRejection | "ok" => (result.ok ? "ok" : result.reason);
const check = (token: unknown, options: Partial<VerifyGitScopeOptions> = {}) => reasonOf(verifyGitScope(token, { ...OPTIONS, ...options }));

describe("signGitScope and verifyGitScope", () => {
  it("returns the signed payload to the claim it was made for", () => {
    const result = verifyGitScope(signGitScope(PAYLOAD, PRIVATE, KID), OPTIONS);
    expect(result).toEqual({ ok: true, scope: PAYLOAD });
  });

  it("writes the header and payload the format describes", () => {
    const [header, payload, signature] = signGitScope(PAYLOAD, PRIVATE, KID).split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString("utf8"))).toEqual({ alg: "ES256", typ: "xyne-git-scope+jwt", kid: KID });
    expect(Buffer.from(payload ?? "", "base64url").toString("utf8")).toBe(JSON.stringify(PAYLOAD));
    expect(Buffer.from(signature ?? "", "base64url")).toHaveLength(64);
  });

  it("returns a payload that cannot be changed afterwards", () => {
    const result = verifyGitScope(signGitScope(PAYLOAD, PRIVATE, KID), OPTIONS);
    if (!result.ok) throw new Error(result.reason);
    expect(Object.isFrozen(result.scope)).toBe(true);
    expect(Object.isFrozen(result.scope.repos)).toBe(true);
    expect(Object.isFrozen(result.scope.repos[0])).toBe(true);
  });

  it("does not compare the template when the caller gives none", () => {
    const token = signGitScope(PAYLOAD, PRIVATE, KID);
    expect(check(token, { expected: { claim: "sbx-7f3a9c", namespace: "sandboxes" } })).toBe("ok");
    expect(check(token, { expected: { claim: "sbx-7f3a9c", namespace: "sandboxes", template: undefined } })).toBe("ok");
    expect(check(token, { expected: { claim: "sbx-7f3a9c", namespace: "sandboxes", template: "" } })).toBe("wrong-template");
  });

  it("accepts the key set as a Map, and a list without repositories", () => {
    const empty = { ...PAYLOAD, repos: [] };
    const result = verifyGitScope(signGitScope(empty, PRIVATE, KID), { ...OPTIONS, keys: new Map([[KID, PUBLIC]]) });
    expect(result).toEqual({ ok: true, scope: empty });
  });

  it("uses the current time when no time is given", () => {
    const now = Math.floor(Date.now() / 1000);
    const { now: _fixed, ...withoutNow } = OPTIONS;
    expect(reasonOf(verifyGitScope(signGitScope({ ...PAYLOAD, iat: now, exp: now + 600 }, PRIVATE, KID), withoutNow))).toBe("ok");
    expect(reasonOf(verifyGitScope(signGitScope({ ...PAYLOAD, iat: now - 600, exp: now - 1 }, PRIVATE, KID), withoutNow))).toBe("expired");
  });

  it("reads member order and JSON whitespace freely", () => {
    const { v, claim, ns, tpl, profile, iat, exp, repos } = PAYLOAD;
    const token = forge(`{"kid":"${KID}", "typ":"${GIT_SCOPE_TYP}",\n "alg":"ES256"}`, JSON.stringify({ repos, exp, iat, profile, tpl, ns, claim, v }, null, 2));
    expect(verifyGitScope(token, OPTIONS)).toEqual({ ok: true, scope: PAYLOAD });
  });

  describe("signing refuses", () => {
    const bad: [string, unknown][] = [
      ["a payload that is not an object", "payload"],
      ["another version", { ...PAYLOAD, v: 2 }],
      ["a missing member", (({ tpl: _tpl, ...rest }) => rest)(PAYLOAD)],
      ["an extra member", { ...PAYLOAD, branches: ["main"] }],
      ["an empty claim", { ...PAYLOAD, claim: "" }],
      ["a namespace with a control character", { ...PAYLOAD, ns: "sand\nboxes" }],
      ["a name longer than 253 characters", { ...PAYLOAD, profile: "p".repeat(254) }],
      ["exp before iat", { ...PAYLOAD, exp: PAYLOAD.iat - 1 }],
      ["exp equal to iat", { ...PAYLOAD, exp: PAYLOAD.iat }],
      ["a fractional time", { ...PAYLOAD, iat: PAYLOAD.iat + 0.5 }],
      ["a time in milliseconds beyond the safe range", { ...PAYLOAD, exp: Number.MAX_SAFE_INTEGER + 2 }],
      ["repos that is not an array", { ...PAYLOAD, repos: {} }],
      ["an unknown access", { ...PAYLOAD, repos: [{ repo: "github.com/example-org/app", access: "w" }] }],
      ["an entry with an extra member", { ...PAYLOAD, repos: [{ repo: "github.com/example-org/app", access: "rw", branch: "main" }] }],
      ["a clone address as repo", { ...PAYLOAD, repos: [{ repo: "https://github.com/example-org/app.git", access: "rw" }] }],
      ["a repo that is not lower-case", { ...PAYLOAD, repos: [{ repo: "github.com/Example-Org/app", access: "rw" }] }],
      ["a repo with .git", { ...PAYLOAD, repos: [{ repo: "github.com/example-org/app.git", access: "rw" }] }],
      ["a repo with a wildcard", { ...PAYLOAD, repos: [{ repo: "github.com/example-org/*", access: "rw" }] }],
      [
        "the same repo twice",
        { ...PAYLOAD, repos: [{ repo: "github.com/example-org/app", access: "r" }, { repo: "github.com/example-org/app", access: "rw" }] },
      ],
    ];
    it.each(bad)("%s", (_name, payload) => {
      expect(() => signGitScope(payload as GitScopePayload, PRIVATE, KID)).toThrow(GitScopeError);
    });

    it("a key that is not a P-256 private key", () => {
      expect(() => signGitScope(PAYLOAD, pem(rsa.privateKey, "pkcs8"), KID)).toThrow(/P-256/);
      expect(() => signGitScope(PAYLOAD, pem(p384.privateKey, "pkcs8"), KID)).toThrow(/P-256/);
      expect(() => signGitScope(PAYLOAD, PUBLIC, KID)).toThrow(GitScopeError);
      expect(() => signGitScope(PAYLOAD, "not a key", KID)).toThrow(/could not be parsed/);
    });

    it("an unusable kid", () => {
      expect(() => signGitScope(PAYLOAD, PRIVATE, "")).toThrow(GitScopeError);
      expect(() => signGitScope(PAYLOAD, PRIVATE, "k".repeat(257))).toThrow(GitScopeError);
      expect(() => signGitScope(PAYLOAD, PRIVATE, 1 as unknown as string)).toThrow(GitScopeError);
    });

    it("a list that would not fit in the size limit", () => {
      const repos = Array.from({ length: 400 }, (_, i) => ({ repo: `git.example.com/team-${i}/service-${i}`, access: "rw" as const }));
      expect(() => signGitScope({ ...PAYLOAD, repos }, PRIVATE, KID)).toThrow(/limit is 16384/);
    });

    it("and what it does sign always verifies (same schema both ways)", () => {
      const result = verifyGitScope(signGitScope({ ...PAYLOAD, repos: [{ repo: "bitbucket.example.net/~jdoe/tools", access: "r" }] }, PRIVATE, KID), OPTIONS);
      expect(result.ok).toBe(true);
    });
  });

  describe("a caller mistake throws instead of switching a check off", () => {
    const token = signGitScope(PAYLOAD, PRIVATE, KID);
    const mistakes: [string, unknown][] = [
      ["no claim", { ...OPTIONS, expected: { namespace: "sandboxes" } }],
      ["an empty claim", { ...OPTIONS, expected: { claim: "", namespace: "sandboxes" } }],
      ["no namespace", { ...OPTIONS, expected: { claim: "sbx-7f3a9c" } }],
      ["no expected at all", { keys: OPTIONS.keys, now: NOW }],
      ["a template that is not a string", { ...OPTIONS, expected: { claim: "sbx-7f3a9c", namespace: "sandboxes", template: null } }],
      ["a time that is not a number", { ...OPTIONS, now: Number.NaN }],
      ["a time given as a string", { ...OPTIONS, now: String(NOW) }],
    ];
    it.each(mistakes)("%s", (_name, options) => {
      expect(() => verifyGitScope(token, options as VerifyGitScopeOptions)).toThrow(TypeError);
    });
  });
});

describe("every reason a token is refused", () => {
  const valid = signGitScope(PAYLOAD, PRIVATE, KID);
  const [validHeader = "", validPayload = "", validSignature = ""] = valid.split(".");
  const seen = new Set<GitScopeRejection | "ok">();
  const expectReason = (reason: GitScopeRejection, token: unknown, options: Partial<VerifyGitScopeOptions> = {}): void => {
    const got = check(token, options);
    seen.add(got);
    expect(got).toBe(reason);
  };

  it("malformed", () => {
    for (const token of [undefined, null, 7, {}, ["a.b.c"], Buffer.from(valid)]) expectReason("malformed", token);
    for (const token of ["", ".", "..", "a.b", `${validHeader}.${validPayload}`, `${valid}.AAAA`, `${validHeader}.${validPayload}.`, `.${validPayload}.${validSignature}`, `${validHeader}..${validSignature}`]) {
      expectReason("malformed", token);
    }
    // not strict base64url
    for (const token of [` ${valid}`, `${valid} `, `${valid}\n`, `${valid}=`, `${valid}==`, valid.replace(".", ". "), `${validHeader}.${validPayload}.${validSignature.replace(/[-_]|.$/, "+")}`]) {
      expectReason("malformed", token);
    }
    // a second spelling of the same 64 signature bytes: the last character's unused bits are not zero
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const respelled = `${validSignature.slice(0, -1)}${alphabet[alphabet.indexOf(validSignature.slice(-1)) + 1]}`;
    expect(Buffer.from(respelled, "base64url").equals(Buffer.from(validSignature, "base64url"))).toBe(true);
    expectReason("malformed", `${validHeader}.${validPayload}.${respelled}`);
    // the header is not a JSON object with exactly alg, typ, kid
    for (const header of ["not json", "[]", '"ES256"', "null", "﻿" + JSON.stringify(HEADER), { alg: "ES256", typ: GIT_SCOPE_TYP }, { ...HEADER, crit: ["exp"] }, { ...HEADER, jwk: signer.publicKey.export({ format: "jwk" }) }, { ...HEADER, x5u: "https://example.com/key" }]) {
      expectReason("malformed", forge(header));
    }
    // header bytes that are not UTF-8, also where a lenient reader would still find JSON (inside a string)
    expectReason("malformed", `${Buffer.from([0x7b, 0xff, 0x7d]).toString("base64url")}.${validPayload}.${validSignature}`);
    const headerBytes = Buffer.from(JSON.stringify({ ...HEADER, kid: "signer-1?" }), "utf8");
    headerBytes[headerBytes.indexOf("?")] = 0xff;
    const input = `${headerBytes.toString("base64url")}.${validPayload}`;
    expectReason("malformed", `${input}.${es256(signer.privateKey)(input).toString("base64url")}`);
  });

  it("too-large", () => {
    expectReason("too-large", "a".repeat(GIT_SCOPE_MAX_TOKEN_LENGTH + 1));
    expectReason("too-large", `${valid}${".".repeat(GIT_SCOPE_MAX_TOKEN_LENGTH)}`);
  });

  it("wrong-alg", () => {
    for (const alg of ["none", "None", "HS256", "RS256", "PS256", "ES384", "ES256K", "EdDSA", "es256", "ES256 ", "", null, 256, ["ES256"]]) {
      expectReason("wrong-alg", forge({ ...HEADER, alg }));
    }
    expectReason("wrong-alg", forge({ typ: GIT_SCOPE_TYP, kid: KID }));
  });

  it("wrong-type", () => {
    for (const typ of ["JWT", "jwt", "xyne-service+jwt", "Xyne-Git-Scope+JWT", "xyne-git-scope", "application/xyne-git-scope+jwt", "", null, 1]) {
      expectReason("wrong-type", forge({ ...HEADER, typ }));
    }
    expectReason("wrong-type", forge({ alg: "ES256", kid: KID }));
  });

  it("unknown-key", () => {
    expectReason("unknown-key", valid, { keys: {} });
    expectReason("unknown-key", valid, { keys: new Map() });
    expectReason("unknown-key", valid, { keys: { "signer-2": PUBLIC } });
    expectReason("unknown-key", valid, { keys: { [KID.toUpperCase()]: PUBLIC } });
    // a key the verifier holds but must not use
    expectReason("unknown-key", valid, { keys: { [KID]: pem(rsa.publicKey, "spki") } });
    expectReason("unknown-key", valid, { keys: { [KID]: pem(p384.publicKey, "spki") } });
    expectReason("unknown-key", valid, { keys: { [KID]: PRIVATE } });
    expectReason("unknown-key", valid, { keys: { [KID]: "not a key" } });
    expectReason("unknown-key", valid, { keys: { [KID]: "" } });
    expectReason("unknown-key", valid, { keys: { [KID]: signer.publicKey as unknown as string } });
    // a kid that is not a usable string, or that names something every object has
    for (const kid of ["", 1, null, ["signer-1"], "k".repeat(257), "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expectReason("unknown-key", forge({ ...HEADER, kid }));
    }
    // only the key set's own entries count: not what it inherits, not what was added to every object
    expectReason("unknown-key", valid, { keys: Object.create({ [KID]: PUBLIC }) as Record<string, string> });
    const everyObject = Object.prototype as unknown as Record<string, unknown>;
    try {
      everyObject["planted-kid"] = pem(stranger.publicKey, "spki");
      expectReason("unknown-key", forge({ ...HEADER, kid: "planted-kid" }, PAYLOAD, es256(stranger.privateKey)));
    } finally {
      delete everyObject["planted-kid"];
    }
  });

  it("bad-signature", () => {
    expectReason("bad-signature", forge(HEADER, PAYLOAD, es256(stranger.privateKey)));
    expectReason("bad-signature", valid, { keys: { [KID]: pem(stranger.publicKey, "spki") } });
    expectReason("bad-signature", `${validHeader}.${b64({ ...PAYLOAD, claim: "sbx-000000" })}.${validSignature}`);
    expectReason("bad-signature", `${b64({ kid: KID, alg: "ES256", typ: GIT_SCOPE_TYP })}.${validPayload}.${validSignature}`);
    // the right key and message, in ASN.1/DER instead of r || s
    expectReason("bad-signature", forge(HEADER, PAYLOAD, (input) => sign("sha256", Buffer.from(input), { key: signer.privateKey, dsaEncoding: "der" })));
    for (const length of [1, 32, 63, 65, 96, 128]) expectReason("bad-signature", forge(HEADER, PAYLOAD, () => Buffer.alloc(length, 1)));
    expectReason("bad-signature", forge(HEADER, PAYLOAD, () => Buffer.alloc(64)));
    expectReason("bad-signature", forge(HEADER, PAYLOAD, () => Buffer.alloc(64, 0xff)));
  });

  it("unsupported-version", () => {
    const { v: _v, ...withoutVersion } = PAYLOAD;
    for (const payload of [{ ...PAYLOAD, v: 2 }, { ...PAYLOAD, v: 0 }, { ...PAYLOAD, v: "1" }, { ...PAYLOAD, v: 1.5 }, { ...PAYLOAD, v: null }, { ...PAYLOAD, v: [1] }, withoutVersion, {}]) {
      expectReason("unsupported-version", forge(HEADER, payload));
    }
  });

  it("invalid-payload", () => {
    const { tpl: _tpl, ...withoutTemplate } = PAYLOAD;
    const repos = (...entries: unknown[]) => ({ ...PAYLOAD, repos: entries });
    const payloads: unknown[] = [
      "[]",
      "v=1",
      '"text"',
      "null",
      "﻿" + JSON.stringify(PAYLOAD),
      JSON.stringify(PAYLOAD).replace("{", '{"__proto__":{"repos":[]},'),
      withoutTemplate,
      { ...PAYLOAD, branches: ["main"] },
      { ...PAYLOAD, jti: "1" },
      { ...PAYLOAD, claim: "" },
      { ...PAYLOAD, claim: 7 },
      { ...PAYLOAD, ns: null },
      { ...PAYLOAD, tpl: ["agent-workspace-template"] },
      { ...PAYLOAD, profile: "p".repeat(254) },
      { ...PAYLOAD, claim: "sbx\u0000" },
      { ...PAYLOAD, iat: String(PAYLOAD.iat) },
      { ...PAYLOAD, exp: String(PAYLOAD.exp) },
      { ...PAYLOAD, exp: PAYLOAD.iat },
      { ...PAYLOAD, exp: PAYLOAD.iat - 1 },
      { ...PAYLOAD, iat: PAYLOAD.iat + 0.5 },
      { ...PAYLOAD, iat: -1 },
      { ...PAYLOAD, exp: null },
      { ...PAYLOAD, repos: null },
      { ...PAYLOAD, repos: {} },
      { ...PAYLOAD, repos: "github.com/example-org/app" },
      repos("github.com/example-org/app"),
      repos(null),
      repos(["github.com/example-org/app", "rw"]),
      repos({ repo: "github.com/example-org/app" }),
      repos({ access: "rw" }),
      repos({ repo: "github.com/example-org/app", access: "rw", branch: "main" }),
      repos({ repo: "github.com/example-org/app", access: "w" }),
      repos({ repo: "github.com/example-org/app", access: "RW" }),
      repos({ repo: "github.com/example-org/app", access: "" }),
      repos({ repo: "github.com/example-org/app", access: true }),
      repos({ repo: 7, access: "rw" }),
      repos({ repo: "", access: "rw" }),
      repos({ repo: "https://github.com/example-org/app.git", access: "rw" }),
      repos({ repo: "git@github.com:example-org/app.git", access: "rw" }),
      repos({ repo: "github.com/Example-Org/app", access: "rw" }),
      repos({ repo: "github.com/example-org/app.git", access: "rw" }),
      repos({ repo: "bitbucket.example.net/scm/proj/service", access: "rw" }),
      repos({ repo: "bitbucket.example.net/projects/proj/repos/service", access: "rw" }),
      repos({ repo: "ssh.bitbucket.example.net/proj/service", access: "rw" }),
      repos({ repo: "www.github.com/example-org/app", access: "rw" }),
      repos({ repo: "bitbucket.example.net:7999/proj/service", access: "rw" }),
      repos({ repo: "github.com/example-org", access: "rw" }),
      repos({ repo: "github.com", access: "rw" }),
      repos({ repo: "github.com/example-org/../app", access: "rw" }),
      repos({ repo: "github.com/example-org/./app", access: "rw" }),
      repos({ repo: "github.com/example-org/app/", access: "rw" }),
      repos({ repo: "github.com//example-org/app", access: "rw" }),
      repos({ repo: "/github.com/example-org/app", access: "rw" }),
      repos({ repo: "github.com/example-org/*", access: "rw" }),
      repos({ repo: "github.com/example-org/app?x=1", access: "rw" }),
      repos({ repo: "github.com/example-org/app%2fother", access: "rw" }),
      repos({ repo: "github.com/example-org/app/tree/main", access: "rw" }),
      repos({ repo: `github.com/example-org/${"a".repeat(512)}`, access: "rw" }),
      repos({ repo: "github.com/example-org/app", access: "r" }, { repo: "github.com/example-org/app", access: "rw" }),
    ];
    for (const payload of payloads) {
      const result = verifyGitScope(forge(HEADER, payload), OPTIONS);
      seen.add(reasonOf(result));
      expect(result, JSON.stringify(payload)).toMatchObject({ ok: false, reason: "invalid-payload" });
      expect(result.ok === false && result.detail, JSON.stringify(payload)).toEqual(expect.any(String));
    }
    // correctly signed payload bytes that are not UTF-8, also where a lenient reader would still find JSON (inside a string)
    const signedBytes = (payloadBytes: Buffer): string => {
      const input = `${b64(HEADER)}.${payloadBytes.toString("base64url")}`;
      return `${input}.${es256(signer.privateKey)(input).toString("base64url")}`;
    };
    expectReason("invalid-payload", signedBytes(Buffer.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x31, 0xff, 0x7d])));
    const payloadBytes = Buffer.from(JSON.stringify({ ...PAYLOAD, profile: "example-profile?" }), "utf8");
    payloadBytes[payloadBytes.indexOf("?")] = 0xff;
    expectReason("invalid-payload", signedBytes(payloadBytes));
  });

  it("not-for-this-claim, wrong-namespace, wrong-template", () => {
    const expected = OPTIONS.expected;
    for (const claim of ["sbx-000000", "sbx-7f3a9", "sbx-7f3a9cc", "SBX-7F3A9C", " sbx-7f3a9c"]) expectReason("not-for-this-claim", valid, { expected: { ...expected, claim } });
    for (const namespace of ["default", "sandboxes-2", "Sandboxes"]) expectReason("wrong-namespace", valid, { expected: { ...expected, namespace } });
    for (const template of ["other-template", "agent-workspace-template-2", ""]) expectReason("wrong-template", valid, { expected: { ...expected, template } });
    // the claim is compared before the namespace, the namespace before the template
    expectReason("not-for-this-claim", valid, { expected: { claim: "sbx-000000", namespace: "default", template: "other-template" } });
    expectReason("wrong-namespace", valid, { expected: { claim: "sbx-7f3a9c", namespace: "default", template: "other-template" } });
  });

  it("expired", () => {
    expectReason("expired", valid, { now: PAYLOAD.exp });
    expectReason("expired", valid, { now: PAYLOAD.exp + 1 });
    expectReason("expired", valid, { now: PAYLOAD.exp + 86_400 * 365 });
    expectReason("expired", valid, { now: NOW * 1000 });
    expect(check(valid, { now: PAYLOAD.exp - 1 })).toBe("ok");
    expect(check(valid, { now: PAYLOAD.exp - 0.5 })).toBe("ok");
    // issued in the future, beyond the allowance
    expect(check(valid, { now: PAYLOAD.iat - GIT_SCOPE_CLOCK_SKEW_SECONDS })).toBe("ok");
    expectReason("expired", valid, { now: PAYLOAD.iat - GIT_SCOPE_CLOCK_SKEW_SECONDS - 1 });
  });

  it("covers every reason code", () => {
    expect([...seen].sort()).toEqual([...GIT_SCOPE_REJECTIONS].sort());
  });

  it("checks the signature before it says anything about the payload", () => {
    const forged = es256(stranger.privateKey);
    for (const payload of [{ ...PAYLOAD, v: 2 }, { ...PAYLOAD, claim: "sbx-000000" }, { ...PAYLOAD, exp: 1 }, "[]"]) {
      expect(check(forge(HEADER, payload, forged))).toBe("bad-signature");
    }
  });

  it("accepts a token of exactly the size limit and refuses one character more", () => {
    const b64Length = (bytes: number): number => Math.floor(bytes / 3) * 4 + (bytes % 3 === 0 ? 0 : (bytes % 3) + 1);
    const build = (length: number): { header: typeof HEADER; payload: GitScopePayload } => {
      for (let count = 150; count < 400; count++) {
        const repos = Array.from({ length: count }, (_, i) => ({ repo: `git.example.com/team-${String(i).padStart(3, "0")}/service-${String(i).padStart(3, "0")}`, access: "rw" as const }));
        for (let kidPad = 0; kidPad < 3; kidPad++) {
          for (let profilePad = 1; profilePad <= 60; profilePad++) {
            const header = { ...HEADER, kid: `${KID}${"x".repeat(kidPad)}` };
            const payload = { ...PAYLOAD, profile: "p".repeat(profilePad), repos };
            const total = b64Length(Buffer.byteLength(JSON.stringify(header))) + 1 + b64Length(Buffer.byteLength(JSON.stringify(payload))) + 1 + 86;
            if (total === length) return { header, payload };
          }
        }
      }
      throw new Error(`no token of length ${length}`);
    };

    const atLimit = build(GIT_SCOPE_MAX_TOKEN_LENGTH);
    const token = signGitScope(atLimit.payload, PRIVATE, atLimit.header.kid);
    expect(token).toHaveLength(GIT_SCOPE_MAX_TOKEN_LENGTH);
    expect(verifyGitScope(token, { ...OPTIONS, keys: { [atLimit.header.kid]: PUBLIC } })).toEqual({ ok: true, scope: atLimit.payload });

    const over = build(GIT_SCOPE_MAX_TOKEN_LENGTH + 1);
    const tooLarge = forge(over.header, over.payload);
    expect(tooLarge).toHaveLength(GIT_SCOPE_MAX_TOKEN_LENGTH + 1);
    expect(check(tooLarge, { keys: { [over.header.kid]: PUBLIC } })).toBe("too-large");
    expect(() => signGitScope(over.payload, PRIVATE, over.header.kid)).toThrow(/limit is 16384/);
  });
});

describe("attacks on a signed token", () => {
  const token = signGitScope(PAYLOAD, PRIVATE, KID);

  /** Verify every altered token; return how many were tried and the reasons given. None may be accepted. */
  function attack(alteredTokens: Iterable<string>): { tried: number; accepted: string[]; reasons: Record<string, number> } {
    const reasons: Record<string, number> = {};
    const accepted: string[] = [];
    let tried = 0;
    for (const altered of alteredTokens) {
      if (altered === token) continue;
      tried++;
      const result = verifyGitScope(altered, OPTIONS);
      if (result.ok) accepted.push(altered);
      else reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    }
    return { tried, accepted, reasons };
  }

  it("the untouched token is accepted", () => {
    expect(check(token)).toBe("ok");
  });

  it("no single flipped bit is accepted (every bit of every byte)", { timeout: 120_000 }, () => {
    const bytes = Buffer.from(token, "latin1");
    function* flips(): Generator<string> {
      for (let i = 0; i < bytes.length; i++) {
        for (let bit = 0; bit < 8; bit++) {
          const copy = Buffer.from(bytes);
          copy[i] = (copy[i] ?? 0) ^ (1 << bit);
          yield copy.toString("latin1");
        }
      }
    }
    const { tried, accepted, reasons } = attack(flips());
    report(`[git-scope tamper] token of ${bytes.length} bytes; bit flips tried: ${tried}; accepted: ${accepted.length}; reasons: ${JSON.stringify(reasons)}`);
    expect(tried).toBe(bytes.length * 8);
    expect(accepted).toEqual([]);
  });

  it("no single replaced byte is accepted (every byte by each of the other 255 values)", { timeout: 300_000 }, () => {
    function* replacements(): Generator<string> {
      for (let i = 0; i < token.length; i++) {
        for (let value = 0; value < 256; value++) yield `${token.slice(0, i)}${String.fromCharCode(value)}${token.slice(i + 1)}`;
      }
    }
    const { tried, accepted, reasons } = attack(replacements());
    report(`[git-scope tamper] byte replacements tried: ${tried}; accepted: ${accepted.length}; reasons: ${JSON.stringify(reasons)}`);
    expect(tried).toBe(token.length * 255);
    expect(accepted).toEqual([]);
  });

  it("no truncated, shortened or lengthened token is accepted", { timeout: 120_000 }, () => {
    function* cuts(): Generator<string> {
      for (let length = 0; length < token.length; length++) yield token.slice(0, length); // cut at every length
      for (let start = 1; start <= token.length; start++) yield token.slice(start); // cut from the front
      for (let i = 0; i < token.length; i++) yield `${token.slice(0, i)}${token.slice(i + 1)}`; // one byte removed
      for (let i = 0; i <= token.length; i++) {
        for (const extra of ["A", "_", ".", "=", " ", "\n", "\u0000"]) yield `${token.slice(0, i)}${extra}${token.slice(i)}`; // one byte added
      }
      for (let i = 0; i + 1 < token.length; i++) yield `${token.slice(0, i)}${token[i + 1]}${token[i]}${token.slice(i + 2)}`; // neighbours swapped
    }
    const { tried, accepted, reasons } = attack(cuts());
    report(`[git-scope tamper] truncations, removals, insertions and swaps tried: ${tried}; accepted: ${accepted.length}; reasons: ${JSON.stringify(reasons)}`);
    expect(tried).toBeGreaterThan(token.length * 9);
    expect(accepted).toEqual([]);
  });

  it("parts of two valid tokens cannot be recombined", () => {
    const other = signGitScope({ ...PAYLOAD, repos: [{ repo: "github.com/example-org/secret", access: "rw" }] }, PRIVATE, KID);
    const [h1 = "", p1 = "", s1 = ""] = token.split(".");
    const [h2 = "", p2 = "", s2 = ""] = other.split(".");
    expect(check(`${h1}.${p2}.${s1}`)).toBe("bad-signature");
    expect(check(`${h1}.${p1}.${s2}`)).toBe("bad-signature");
    expect(check(`${h2}.${p1}.${s2}`)).toBe("bad-signature");
    expect(check(`${h1}.${p2}.${s2}`)).toBe("ok");
  });

  it("documented limit: the other valid form of the same signature (s -> n - s) still verifies", () => {
    const [header = "", payload = "", signature = ""] = token.split(".");
    const raw = Buffer.from(signature, "base64url");
    const n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
    const s = BigInt(`0x${raw.subarray(32).toString("hex")}`);
    const twin = Buffer.concat([raw.subarray(0, 32), Buffer.from((n - s).toString(16).padStart(64, "0"), "hex")]);
    expect(twin.equals(raw)).toBe(false);
    expect(check(`${header}.${payload}.${twin.toString("base64url")}`)).toBe("ok");
  });
});

describe("a list signed for claim A in namespace N", () => {
  const token = signGitScope(PAYLOAD, PRIVATE, KID);
  const input = token.split(".").slice(0, 2).join(".");
  const expected = OPTIONS.expected;

  it("is accepted for claim A in namespace N", () => {
    expect(check(token)).toBe("ok");
  });
  it("fails for claim B", () => {
    expect(check(token, { expected: { ...expected, claim: "sbx-b" } })).toBe("not-for-this-claim");
  });
  it("fails for namespace M", () => {
    expect(check(token, { expected: { ...expected, namespace: "m" } })).toBe("wrong-namespace");
  });
  it("fails for another template", () => {
    expect(check(token, { expected: { ...expected, template: "privileged-template" } })).toBe("wrong-template");
  });
  it("fails at and after exp", () => {
    expect(check(token, { now: PAYLOAD.exp - 1 })).toBe("ok");
    expect(check(token, { now: PAYLOAD.exp })).toBe("expired");
    expect(check(token, { now: PAYLOAD.exp + 1 })).toBe("expired");
  });
  it("fails when the verifier holds the key under a different kid", () => {
    expect(check(token, { keys: { "signer-2": PUBLIC } })).toBe("unknown-key");
  });
  it("fails when the kid names a different key", () => {
    expect(check(token, { keys: { [KID]: pem(stranger.publicKey, "spki") } })).toBe("bad-signature");
    expect(check(forge({ ...HEADER, kid: "signer-2" }), { keys: { [KID]: PUBLIC, "signer-2": pem(stranger.publicKey, "spki") } })).toBe("bad-signature");
  });
  it("fails with an RSA key, whichever way it is tried", () => {
    const rsaPublic = pem(rsa.publicKey, "spki");
    const rsaSign = (text: string): Buffer => sign("sha256", Buffer.from(text), rsa.privateKey);
    // RS256 token, verifier holds the RSA key
    expect(check(forge({ ...HEADER, alg: "RS256" }, PAYLOAD, rsaSign), { keys: { [KID]: rsaPublic } })).toBe("wrong-alg");
    // RSA signature under an ES256 header, verifier holds the RSA key
    expect(check(forge(HEADER, PAYLOAD, rsaSign), { keys: { [KID]: rsaPublic } })).toBe("unknown-key");
    // RSA signature under an ES256 header, verifier holds the right P-256 key
    expect(check(forge(HEADER, PAYLOAD, rsaSign))).toBe("bad-signature");
    // a good token, but the verifier was given an RSA key for this kid
    expect(check(token, { keys: { [KID]: rsaPublic } })).toBe("unknown-key");
  });
  it('fails with alg "none"', () => {
    for (const alg of ["none", "None", "NONE", "nOnE"]) {
      expect(check(`${b64({ ...HEADER, alg })}.${b64(PAYLOAD)}.`)).toBe("wrong-alg");
      expect(check(`${b64({ ...HEADER, alg })}.${b64(PAYLOAD)}.${token.split(".")[2]}`)).toBe("wrong-alg");
    }
    // an ES256 header with the signature simply removed
    expect(check(`${input}.`)).toBe("malformed");
    expect(check(input)).toBe("malformed");
  });
  it('fails with alg "HS256" keyed by the public key', () => {
    const secrets = [PUBLIC, PUBLIC.trim(), signer.publicKey.export({ type: "spki", format: "der" }), Buffer.from(signer.publicKey.export({ format: "jwk" }).x ?? "", "base64url")];
    for (const secret of secrets) {
      const hmac = (text: string): Buffer => createHmac("sha256", secret).update(text).digest();
      expect(check(forge({ ...HEADER, alg: "HS256" }, PAYLOAD, hmac))).toBe("wrong-alg");
      // the same MAC presented under an ES256 header
      expect(check(forge(HEADER, PAYLOAD, hmac))).toBe("bad-signature");
    }
  });
});

describe("the format is a standard ES256 JWS", () => {
  const token = signGitScope(PAYLOAD, PRIVATE, KID);
  const [header = "", payload = "", signature = ""] = token.split(".");

  it("a signed token verifies with node:crypto alone", () => {
    // With GIT_SCOPE_TEST_REPORT=1 the token and its (throw-away) public key are printed, to check with other tools.
    report(`[git-scope independent] token signed by signGitScope:\n${token}\n[git-scope independent] its public key:\n${PUBLIC}`);
    const ok = verify("sha256", Buffer.from(`${header}.${payload}`), { key: createPublicKey(PUBLIC), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({ alg: "ES256", typ: "xyne-git-scope+jwt", kid: KID });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual(PAYLOAD);
  });

  it("a signed token verifies with WebCrypto alone", async () => {
    const key = await webcrypto.subtle.importKey("spki", signer.publicKey.export({ type: "spki", format: "der" }), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(signature, "base64url"), Buffer.from(`${header}.${payload}`));
    expect(ok).toBe(true);
  });

  it("a token made with WebCrypto alone is accepted", async () => {
    const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const input = `${b64(HEADER)}.${b64(PAYLOAD)}`;
    const made = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, Buffer.from(input)));
    const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey));
    const publicPem = `-----BEGIN PUBLIC KEY-----\n${spki.toString("base64")}\n-----END PUBLIC KEY-----\n`;
    expect(verifyGitScope(`${input}.${made.toString("base64url")}`, { ...OPTIONS, keys: { [KID]: publicPem } })).toEqual({ ok: true, scope: PAYLOAD });
  });
});

interface VerificationVector {
  name: string;
  about: string;
  token: string;
  keys: Record<string, string>;
  now: number;
  expected: { claim: string; namespace: string; template?: string };
  result: { ok: true; payload: GitScopePayload } | { ok: false; reason: GitScopeRejection };
}
interface VectorFile {
  WARNING: string;
  format: { typ: string; alg: string; version: number; maxTokenLength: number; clockSkewSeconds: number };
  keys: Record<string, { use: string; publicKeyPem: string; privateKeyPem: string }>;
  verification: VerificationVector[];
}

describe("test vectors (./__tests__/git-scope-vectors.json)", () => {
  const vectors = JSON.parse(readFileSync(new URL("./__tests__/git-scope-vectors.json", import.meta.url), "utf8")) as VectorFile;
  const keyPem = (reference: string): string => {
    const [name = "", part] = reference.split("/");
    const pair = vectors.keys[name];
    if (!pair) throw new Error(`vector names an unknown key: ${reference}`);
    return part === "private" ? pair.privateKeyPem : pair.publicKeyPem;
  };

  it("say that their keys are test keys", () => {
    expect(vectors.WARNING).toMatch(/TEST VECTORS/);
    for (const pair of Object.values(vectors.keys)) expect(pair.use).toMatch(/TEST ONLY/);
  });

  it("state the constants this code uses", () => {
    expect(vectors.format).toEqual({ typ: GIT_SCOPE_TYP, alg: "ES256", version: 1, maxTokenLength: GIT_SCOPE_MAX_TOKEN_LENGTH, clockSkewSeconds: GIT_SCOPE_CLOCK_SKEW_SECONDS });
  });

  it("have an accepted token and a token for every reason code", () => {
    const results = new Set(vectors.verification.map((vector) => (vector.result.ok ? "ok" : vector.result.reason)));
    expect([...results].sort()).toEqual(["ok", ...GIT_SCOPE_REJECTIONS].sort());
  });

  it.each(vectors.verification.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    const keys = Object.fromEntries(Object.entries(vector.keys).map(([kid, reference]) => [kid, keyPem(reference)]));
    const result = verifyGitScope(vector.token, { keys, now: vector.now, expected: vector.expected });
    if (vector.result.ok) expect(result).toEqual({ ok: true, scope: vector.result.payload });
    else expect(result).toMatchObject({ ok: false, reason: vector.result.reason });
  });

  it("can be re-signed: the library signs with the vectors' key and the result verifies", () => {
    const pair = vectors.keys["p256-a"];
    const first = vectors.verification[0];
    if (!pair || !first || !first.result.ok) throw new Error("vectors changed shape");
    const token = signGitScope(first.result.payload, pair.privateKeyPem, "signer-1");
    expect(verifyGitScope(token, { keys: { "signer-1": pair.publicKeyPem }, now: first.now, expected: first.expected })).toEqual({ ok: true, scope: first.result.payload });
  });
});
