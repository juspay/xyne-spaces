// Writes git-scope-vectors.json: test vectors for the git scope token format.
//
//   node packages/xyne-claw-shared/src/git-scope/__tests__/make-vectors.mjs
//
// This file uses node:crypto only and imports nothing from the package, so the
// vectors state the format independently of the library they test. Every
// expected result below is written by hand, not computed.
//
// THE KEYS IN THE JSON FILE ARE TEST KEYS. They are published in this
// repository, protect nothing, and must never be configured in any service.
// Keys already in the JSON file are kept, so running this again re-signs the
// tokens (ECDSA signatures are random) without changing a key or a result.

import { createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("./git-scope-vectors.json", import.meta.url));
const TYP = "xyne-git-scope+jwt";
const MAX_TOKEN_LENGTH = 16384;
const CLOCK_SKEW_SECONDS = 60;
const NOW = 1790000000;

// ── keys ─────────────────────────────────────────────────────────────────────

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).keys : {};
function keyPair(name, type, options) {
  if (previous[name]) return previous[name];
  const { publicKey, privateKey } = generateKeyPairSync(type, options);
  return {
    use: "TEST ONLY. Not a secret. Never configure this key anywhere.",
    kind: name,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
const keys = {
  "p256-a": keyPair("p256-a", "ec", { namedCurve: "prime256v1" }),
  "p256-b": keyPair("p256-b", "ec", { namedCurve: "prime256v1" }),
  p384: keyPair("p384", "ec", { namedCurve: "secp384r1" }),
  "rsa-2048": keyPair("rsa-2048", "rsa", { modulusLength: 2048 }),
};
const priv = (name) => createPrivateKey(keys[name].privateKeyPem);

// ── token building ───────────────────────────────────────────────────────────

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64url");
const es256 = (input, key = "p256-a") => sign("sha256", Buffer.from(input), { key: priv(key), dsaEncoding: "ieee-p1363" });
const es256Der = (input, key = "p256-a") => sign("sha256", Buffer.from(input), { key: priv(key), dsaEncoding: "der" });

/** header and payload may be objects (compact JSON) or strings (used as the exact bytes). */
function token(header, payload, signer = es256) {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${signer(input).toString("base64url")}`;
}

const HEADER = { alg: "ES256", typ: TYP, kid: "signer-1" };
const BASE = {
  v: 1,
  claim: "sbx-7f3a9c",
  ns: "sandboxes",
  tpl: "agent-workspace-template",
  profile: "example-profile",
  iat: NOW - 10,
  exp: NOW + 3600,
  repos: [
    { repo: "bitbucket.example.net/proj/service", access: "rw" },
    { repo: "github.com/example-org/app", access: "rw" },
  ],
};
const EXPECTED = { claim: "sbx-7f3a9c", namespace: "sandboxes", template: "agent-workspace-template" };
const KEYS = { "signer-1": "p256-a" };

const verification = [];
/** keys: kid -> key name above ("name" = its public PEM, "name/private" = its private PEM). */
function vector(name, about, tokenText, result, overrides = {}) {
  verification.push({ name, about, token: tokenText, keys: KEYS, now: NOW, expected: EXPECTED, ...overrides, result });
}
const ok = (payload) => ({ ok: true, payload });
const no = (reason) => ({ ok: false, reason });
const without = (object, member) => Object.fromEntries(Object.entries(object).filter(([key]) => key !== member));

// ── accepted ─────────────────────────────────────────────────────────────────

const valid = token(HEADER, BASE);
vector("valid-rw", "Two repositories, fetch and push.", valid, ok(BASE));

const mixed = {
  ...BASE,
  repos: [
    { repo: "bitbucket.example.net/~jdoe/tools", access: "r" },
    { repo: "github.com/example-org/app", access: "rw" },
  ],
};
vector("valid-fetch-only-entry", "One entry is fetch only.", token(HEADER, mixed), ok(mixed));

const empty = { ...BASE, profile: "browser", repos: [] };
vector("valid-no-repos", "A profile without repositories: a valid list that allows nothing.", token(HEADER, empty), ok(empty));

vector("valid-template-not-checked", "The verifier gives no template, so tpl is not compared.", valid, ok(BASE), {
  expected: { claim: EXPECTED.claim, namespace: EXPECTED.namespace },
});

const reordered = JSON.stringify({ repos: BASE.repos, exp: BASE.exp, iat: BASE.iat, profile: BASE.profile, tpl: BASE.tpl, ns: BASE.ns, claim: BASE.claim, v: 1 }, null, 2);
vector(
  "valid-member-order-and-whitespace",
  "Member order and JSON whitespace are free, in the header and in the payload.",
  token(`{ "kid": "signer-1",\n  "typ": "${TYP}", "alg": "ES256" }`, reordered),
  ok(BASE),
);

vector("valid-last-second", "now = exp - 1.", valid, ok(BASE), { now: BASE.exp - 1 });

const skewed = { ...BASE, iat: NOW + CLOCK_SKEW_SECONDS };
vector("valid-iat-at-skew-limit", "iat is exactly 60 seconds ahead of the verifier's clock.", token(HEADER, skewed), ok(skewed));

vector(
  "valid-second-key",
  "Signed with a second key under its own kid; the verifier holds both (key rotation).",
  token({ ...HEADER, kid: "signer-2" }, BASE, (input) => es256(input, "p256-b")),
  ok(BASE),
  { keys: { "signer-1": "p256-a", "signer-2": "p256-b" } },
);

// ── malformed ────────────────────────────────────────────────────────────────

const [validHeader, validPayload, validSignature] = valid.split(".");
vector("malformed-empty", "The empty string.", "", no("malformed"));
vector("malformed-two-parts", "No signature part.", `${validHeader}.${validPayload}`, no("malformed"));
vector("malformed-four-parts", "A fourth part.", `${valid}.AAAA`, no("malformed"));
vector("malformed-empty-signature", "ES256 header with an empty signature part.", `${validHeader}.${validPayload}.`, no("malformed"));
vector("malformed-trailing-newline", "A valid token followed by a line feed.", `${valid}\n`, no("malformed"));
vector("malformed-padding", "A valid token whose signature has '=' padding.", `${valid}==`, no("malformed"));
// 64 bytes fill 85 characters and 2 bits of the 86th; its other 4 bits must be zero.
const lastValue = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(validSignature.at(-1));
const sameBytesOtherSpelling = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[lastValue + 1];
vector(
  "malformed-non-canonical-base64",
  "The signature's last character changed to one that decodes to the same 64 bytes (non-zero unused bits).",
  `${validHeader}.${validPayload}.${validSignature.slice(0, -1)}${sameBytesOtherSpelling}`,
  no("malformed"),
);
vector("malformed-header-not-json", "The header is not JSON.", token("not json", BASE), no("malformed"));
vector("malformed-header-not-an-object", "The header is a JSON array.", token('["ES256"]', BASE), no("malformed"));
vector("malformed-no-kid", "The header has no kid.", token({ alg: "ES256", typ: TYP }, BASE), no("malformed"));
vector(
  "malformed-embedded-jwk",
  "The header carries its own public key (jwk) and the token is signed with it. No header member other than alg, typ, kid is allowed.",
  token({ ...HEADER, jwk: createPublicKey(keys["p256-b"].publicKeyPem).export({ format: "jwk" }) }, BASE, (input) => es256(input, "p256-b")),
  no("malformed"),
);
vector("malformed-crit", "The header has a crit member.", token({ ...HEADER, crit: ["exp"] }, BASE), no("malformed"));

// ── too-large ────────────────────────────────────────────────────────────────

/** A correctly signed token of exactly `length` characters. */
function tokenOfLength(length) {
  const b64Length = (bytes) => Math.floor(bytes / 3) * 4 + (bytes % 3 === 0 ? 0 : (bytes % 3) + 1);
  const repos = (count) =>
    Array.from({ length: count }, (_, i) => ({ repo: `git.example.com/team-${String(i).padStart(3, "0")}/service-${String(i).padStart(3, "0")}`, access: "rw" }));
  for (let count = 150; count < 400; count++) {
    for (let kidPad = 0; kidPad < 3; kidPad++) {
      for (let profilePad = 1; profilePad <= 60; profilePad++) {
        const header = { ...HEADER, kid: `signer-1${"x".repeat(kidPad)}` };
        const payload = { ...BASE, profile: "p".repeat(profilePad), repos: repos(count) };
        const total = b64Length(Buffer.byteLength(JSON.stringify(header))) + 1 + b64Length(Buffer.byteLength(JSON.stringify(payload))) + 1 + 86;
        if (total === length) return { header, payload, token: token(header, payload) };
      }
    }
  }
  throw new Error(`no token of length ${length}`);
}
// The largest accepted size (exactly the limit) is checked in token.test.ts; a vector for it would be 35 kB of JSON.
const overLimit = tokenOfLength(MAX_TOKEN_LENGTH + 1);
vector("too-large-by-one", `A correctly signed token of ${MAX_TOKEN_LENGTH + 1} characters, one more than the limit.`, overLimit.token, no("too-large"), {
  keys: { [overLimit.header.kid]: "p256-a" },
});

// ── wrong-alg ────────────────────────────────────────────────────────────────

const unsigned = `${b64({ ...HEADER, alg: "none" })}.${validPayload}.`;
vector("wrong-alg-none", 'alg "none" with an empty signature.', unsigned, no("wrong-alg"));
vector(
  "wrong-alg-hs256-public-key-as-secret",
  "alg HS256, with the HMAC keyed by the verifier's public key PEM.",
  token({ ...HEADER, alg: "HS256" }, BASE, (input) => createHmac("sha256", keys["p256-a"].publicKeyPem).update(input).digest()),
  no("wrong-alg"),
);
vector(
  "wrong-alg-rs256",
  "alg RS256, signed with an RSA key whose public key the verifier holds under the kid.",
  token({ ...HEADER, alg: "RS256" }, BASE, (input) => sign("sha256", Buffer.from(input), priv("rsa-2048"))),
  no("wrong-alg"),
  { keys: { "signer-1": "rsa-2048" } },
);
vector(
  "wrong-alg-es384",
  "alg ES384, signed with a P-384 key whose public key the verifier holds under the kid.",
  token({ ...HEADER, alg: "ES384" }, BASE, (input) => sign("sha384", Buffer.from(input), { key: priv("p384"), dsaEncoding: "ieee-p1363" })),
  no("wrong-alg"),
  { keys: { "signer-1": "p384" } },
);
vector("wrong-alg-lower-case", 'alg "es256": the name is case-sensitive.', token({ ...HEADER, alg: "es256" }, BASE), no("wrong-alg"));

// ── wrong-type ───────────────────────────────────────────────────────────────

vector("wrong-type-jwt", 'typ "JWT".', token({ ...HEADER, typ: "JWT" }, BASE), no("wrong-type"));
vector("wrong-type-other-token", "A correctly signed token of another type from the same signer.", token({ ...HEADER, typ: "xyne-service+jwt" }, BASE), no("wrong-type"));
vector("wrong-type-missing", "The header has no typ.", token({ alg: "ES256", kid: "signer-1" }, BASE), no("wrong-type"));
vector("wrong-type-case", "typ in another letter case.", token({ ...HEADER, typ: "Xyne-Git-Scope+JWT" }, BASE), no("wrong-type"));

// ── unknown-key ──────────────────────────────────────────────────────────────

vector("unknown-key-kid-not-held", "The verifier holds the right key, under another kid.", valid, no("unknown-key"), { keys: { "signer-9": "p256-a" } });
vector("unknown-key-no-keys", "The verifier holds no keys.", valid, no("unknown-key"), { keys: {} });
vector(
  "unknown-key-rsa-key-held",
  "ES256 header, RSA signature, and the verifier holds that RSA public key under the kid.",
  token(HEADER, BASE, (input) => sign("sha256", Buffer.from(input), priv("rsa-2048"))),
  no("unknown-key"),
  { keys: { "signer-1": "rsa-2048" } },
);
vector(
  "unknown-key-p384-key-held",
  "ES256 header, signed with a P-384 key that the verifier holds under the kid.",
  token(HEADER, BASE, (input) => sign("sha256", Buffer.from(input), { key: priv("p384"), dsaEncoding: "ieee-p1363" })),
  no("unknown-key"),
  { keys: { "signer-1": "p384" } },
);
vector("unknown-key-private-key-held", "The verifier was given the signer's PRIVATE key PEM. A verifier accepts public key PEMs only.", valid, no("unknown-key"), {
  keys: { "signer-1": "p256-a/private" },
});
vector("unknown-key-kid-not-a-string", "kid is a number.", token({ ...HEADER, kid: 1 }, BASE), no("unknown-key"));

// ── bad-signature ────────────────────────────────────────────────────────────

vector("bad-signature-other-key", "Signed with a different P-256 key under the signer's kid.", token(HEADER, BASE, (input) => es256(input, "p256-b")), no("bad-signature"));
const fetchOnly = { ...BASE, repos: [{ repo: "github.com/example-org/app", access: "r" }] };
const [, , fetchOnlySignature] = token(HEADER, fetchOnly).split(".");
vector(
  "bad-signature-payload-replaced",
  'A token signed with access "r" whose payload was replaced by the same list with "rw".',
  `${validHeader}.${b64({ ...fetchOnly, repos: [{ repo: "github.com/example-org/app", access: "rw" }] })}.${fetchOnlySignature}`,
  no("bad-signature"),
);
vector(
  "bad-signature-der-encoded",
  "A correct signature in ASN.1/DER form instead of the 64 bytes r || s. The usual mistake when a library's default output is used.",
  token(HEADER, BASE, (input) => es256Der(input)),
  no("bad-signature"),
);
vector("bad-signature-all-zero", "r = 0 and s = 0.", token(HEADER, BASE, () => Buffer.alloc(64)), no("bad-signature"));
vector(
  "bad-signature-hmac-under-es256",
  "ES256 header, but the signature is an HMAC-SHA256 keyed by the public key PEM.",
  token(HEADER, BASE, (input) => createHmac("sha256", keys["p256-a"].publicKeyPem).update(input).digest()),
  no("bad-signature"),
);
vector(
  "bad-signature-rsa-under-es256",
  "ES256 header, RSA signature; the verifier holds the P-256 key.",
  token(HEADER, BASE, (input) => sign("sha256", Buffer.from(input), priv("rsa-2048"))),
  no("bad-signature"),
);

// ── unsupported-version ──────────────────────────────────────────────────────

vector("unsupported-version-2", "v is 2.", token(HEADER, { ...BASE, v: 2 }), no("unsupported-version"));
vector("unsupported-version-missing", "No v.", token(HEADER, without(BASE, "v")), no("unsupported-version"));
vector("unsupported-version-string", 'v is the string "1".', token(HEADER, { ...BASE, v: "1" }), no("unsupported-version"));

// ── invalid-payload (all correctly signed) ───────────────────────────────────

const invalid = (name, about, payload) => vector(`invalid-payload-${name}`, about, token(HEADER, payload), no("invalid-payload"));
const withRepos = (...repos) => ({ ...BASE, repos });
invalid("not-an-object", "The payload is a JSON array.", "[]");
invalid("not-json", "The payload is not JSON.", "v=1");
invalid("missing-member", "No tpl.", without(BASE, "tpl"));
invalid("extra-member", "A member this version does not define.", { ...BASE, branches: ["main"] });
invalid("empty-claim", "claim is empty.", { ...BASE, claim: "" });
invalid("claim-not-a-string", "claim is a number.", { ...BASE, claim: 7 });
invalid("exp-string", "exp is a string.", { ...BASE, exp: String(BASE.exp) });
invalid("exp-not-after-iat", "exp equals iat.", { ...BASE, exp: BASE.iat });
invalid("fractional-iat", "iat is not a whole number.", { ...BASE, iat: BASE.iat + 0.5 });
invalid("negative-iat", "iat is negative.", { ...BASE, iat: -1 });
invalid("repos-not-an-array", "repos is an object.", { ...BASE, repos: { "github.com/example-org/app": "rw" } });
invalid("repo-entry-is-a-string", "A repos entry is a string.", withRepos("github.com/example-org/app"));
invalid("repo-entry-extra-member", "A repos entry has a third member.", withRepos({ repo: "github.com/example-org/app", access: "rw", branch: "main" }));
invalid("repo-entry-no-access", "A repos entry has no access.", withRepos({ repo: "github.com/example-org/app" }));
invalid("access-unknown", 'access is "w".', withRepos({ repo: "github.com/example-org/app", access: "w" }));
invalid("access-upper-case", 'access is "RW".', withRepos({ repo: "github.com/example-org/app", access: "RW" }));
invalid("repo-is-an-address", "repo is a clone address, not host/path.", withRepos({ repo: "https://github.com/example-org/app.git", access: "rw" }));
invalid("repo-upper-case", "repo is not lower-case.", withRepos({ repo: "github.com/Example-Org/app", access: "rw" }));
invalid("repo-git-suffix", "repo keeps .git.", withRepos({ repo: "github.com/example-org/app.git", access: "rw" }));
invalid("repo-scm-prefix", "repo keeps Bitbucket's scm/.", withRepos({ repo: "bitbucket.example.net/scm/proj/service", access: "rw" }));
invalid("repo-ssh-host", "repo keeps the ssh. host prefix.", withRepos({ repo: "ssh.bitbucket.example.net/proj/service", access: "rw" }));
invalid("repo-port", "repo keeps a port.", withRepos({ repo: "bitbucket.example.net:7999/proj/service", access: "rw" }));
invalid("repo-one-segment", "repo has one path segment.", withRepos({ repo: "github.com/example-org", access: "rw" }));
invalid("repo-dot-segment", "repo has a .. segment.", withRepos({ repo: "github.com/example-org/../app", access: "rw" }));
invalid("repo-trailing-slash", "repo ends with a slash.", withRepos({ repo: "github.com/example-org/app/", access: "rw" }));
invalid("repo-wildcard", "repo is a pattern.", withRepos({ repo: "github.com/example-org/*", access: "rw" }));
invalid("repo-twice", "The same repo twice, with different access.", withRepos({ repo: "github.com/example-org/app", access: "r" }, { repo: "github.com/example-org/app", access: "rw" }));

// ── not made for this claim ──────────────────────────────────────────────────

vector("not-for-this-claim", "A valid list, carried by another claim in the same namespace.", valid, no("not-for-this-claim"), { expected: { ...EXPECTED, claim: "sbx-000000" } });
vector("wrong-namespace", "A valid list, carried by a claim of the same name in another namespace.", valid, no("wrong-namespace"), { expected: { ...EXPECTED, namespace: "other" } });
vector("wrong-template", "A valid list, carried by a claim that uses another template.", valid, no("wrong-template"), { expected: { ...EXPECTED, template: "other-template" } });

// ── expired ──────────────────────────────────────────────────────────────────

vector("expired-at-exp", "now = exp.", valid, no("expired"), { now: BASE.exp });
vector("expired-a-day-later", "now = exp + 86400.", valid, no("expired"), { now: BASE.exp + 86400 });
vector("expired-issued-in-the-future", "iat is 61 seconds ahead of the verifier's clock.", token(HEADER, { ...BASE, iat: NOW + CLOCK_SKEW_SECONDS + 1 }), no("expired"));

// ── addresses: what one profile address becomes as a list entry ──────────────

const sameRepo = (repo, ...addresses) => addresses.map((address) => ({ address, repo }));
const notAnEntry = (...addresses) => addresses.map((address) => ({ address, repo: null }));
const addresses = [
  ...sameRepo(
    "github.com/example-org/app",
    "ssh://git@github.com/example-org/app.git",
    "git@github.com:example-org/app.git",
    "git@github.com:example-org/app",
    "https://github.com/example-org/app",
    "https://github.com/example-org/app.git",
    "https://github.com/Example-Org/App.git",
    "HTTPS://GITHUB.COM/EXAMPLE-ORG/APP",
    "https://github.com/example-org/app/",
    "https://www.github.com/example-org/app",
    "https://user@github.com/example-org/app.git",
    "git+ssh://git@github.com/example-org/app.git",
    "https://github.com/example-org/app/tree/main/src",
    "github.com/example-org/app",
    "  https://github.com/example-org/app.git\n",
  ),
  ...sameRepo(
    "bitbucket.example.net/proj/service",
    "ssh://git@ssh.bitbucket.example.net/proj/service.git",
    "ssh://git@ssh.bitbucket.example.net:7999/proj/service.git",
    "ssh://git@ssh.bitbucket.example.net:7999/PROJ/service.git",
    "git@ssh.bitbucket.example.net:proj/service.git",
    "https://bitbucket.example.net/scm/proj/service.git",
    "https://bitbucket.example.net/scm/PROJ/service",
    "https://bitbucket.example.net/projects/PROJ/repos/service/browse",
    "https://bitbucket.example.net/projects/PROJ/repos/service",
  ),
  ...sameRepo(
    "bitbucket.example.net/~jdoe/tools",
    "ssh://git@ssh.bitbucket.example.net:7999/~jdoe/tools.git",
    "https://bitbucket.example.net/scm/~jdoe/tools.git",
    "https://bitbucket.example.net/scm/~JDOE/tools.git",
    "https://bitbucket.example.net/projects/~JDOE/repos/tools/browse",
  ),
  ...sameRepo("gitlab.example.com/group/subgroup/project", "https://gitlab.example.com/group/subgroup/project.git", "git@gitlab.example.com:group/subgroup/project.git"),
  ...notAnEntry(
    "app",
    "https://github.com/example-org",
    "file:///srv/git/app.git",
    "https://github.com/example-org/app with space",
    "https://github.com/example-org/app%20name",
    "https://github.com/example-org/../other/app",
    "https://user:p@ss@github.com/example-org/app.git",
    "https://[2001:db8::1]/example-org/app.git",
    "https://github.com./example-org/app.git",
    "https://github.com/example-org/app.git.git",
  ),
];

// ── profiles ─────────────────────────────────────────────────────────────────

const profiles = [
  {
    name: "main-and-aux",
    about: "repoUrl plus auxRepos, sorted.",
    config: {
      repoUrl: "ssh://git@ssh.bitbucket.example.net/proj/service.git",
      auxRepos: [
        { name: "tools", url: "ssh://git@ssh.bitbucket.example.net/~jdoe/tools.git", defaultBranch: "main", workDir: "/workspace/tools" },
        { name: "app", url: "git@github.com:example-org/app.git", defaultBranch: "main", workDir: "/workspace/app" },
      ],
    },
    repos: ["bitbucket.example.net/proj/service", "bitbucket.example.net/~jdoe/tools", "github.com/example-org/app"],
  },
  {
    name: "same-repo-twice",
    about: "An aux repo that is the main repo in another spelling is listed once.",
    config: {
      repoUrl: "https://github.com/example-org/app",
      auxRepos: [{ name: "again", url: "git@github.com:Example-Org/App.git", defaultBranch: "main", workDir: "/workspace/again" }],
    },
    repos: ["github.com/example-org/app"],
  },
  { name: "no-repo", about: "A profile without repoUrl and auxRepos.", config: {}, repos: [] },
  { name: "empty-main", about: "An empty repoUrl means no main repository, as an absent one does.", config: { repoUrl: "" }, repos: [] },
  {
    name: "empty-aux",
    about: "An aux entry with an empty address is a repository that cannot be listed: the whole profile fails.",
    config: { repoUrl: "https://github.com/example-org/app", auxRepos: [{ name: "blank", url: "", defaultBranch: "main", workDir: "/workspace/blank" }] },
    repos: null,
  },
  {
    name: "aux-only",
    about: "No main repository, one aux repository.",
    config: { auxRepos: [{ name: "app", url: "https://github.com/example-org/app.git", defaultBranch: "main", workDir: "/workspace/app" }] },
    repos: ["github.com/example-org/app"],
  },
  { name: "bad-main", about: "repoUrl is not a repository address: the whole profile fails.", config: { repoUrl: "https://github.com/example-org" }, repos: null },
  {
    name: "bad-aux",
    about: "One aux address is not a repository address: the whole profile fails, the good ones are not returned.",
    config: {
      repoUrl: "https://github.com/example-org/app",
      auxRepos: [{ name: "broken", url: "not an address", defaultBranch: "main", workDir: "/workspace/broken" }],
    },
    repos: null,
  },
];

// ── requests: the gateway's reading of method + path-and-query ───────────────

const UP = "?service=git-upload-pack";
const RP = "?service=git-receive-pack";
const accepted = (method, target, host, repo, op, hostMap) => ({ method, target, ...(hostMap ? { hostMap } : {}), result: { ok: true, host, repo, op } });
const refused = (method, target, reason, hostMap) => ({ method, target, ...(hostMap ? { hostMap } : {}), result: { ok: false, reason } });
const GH = ["github.com", "github.com/example-org/app"];
const BB = ["bitbucket.example.net", "bitbucket.example.net/proj/service"];
const requests = [
  // the four addresses
  accepted("GET", `/github.com/example-org/app.git/info/refs${UP}`, ...GH, "fetch"),
  accepted("POST", "/github.com/example-org/app.git/git-upload-pack", ...GH, "fetch"),
  accepted("GET", `/github.com/example-org/app.git/info/refs${RP}`, ...GH, "push"),
  accepted("POST", "/github.com/example-org/app.git/git-receive-pack", ...GH, "push"),
  // without .git, other letter case
  accepted("GET", `/github.com/example-org/app/info/refs${UP}`, ...GH, "fetch"),
  accepted("POST", "/github.com/example-org/app/git-receive-pack", ...GH, "push"),
  accepted("GET", `/GitHub.com/Example-Org/App.git/info/refs${UP}`, ...GH, "fetch"),
  accepted("GET", `/www.github.com/example-org/app.git/info/refs${UP}`, ...GH, "fetch"),
  // Bitbucket Server
  accepted("GET", `/bitbucket.example.net/scm/proj/service.git/info/refs${UP}`, ...BB, "fetch"),
  accepted("POST", "/bitbucket.example.net/scm/PROJ/service.git/git-receive-pack", ...BB, "push"),
  accepted("GET", `/bitbucket.example.net/proj/service.git/info/refs${UP}`, ...BB, "fetch"),
  accepted("GET", `/ssh.bitbucket.example.net/scm/proj/service.git/info/refs${UP}`, ...BB, "fetch"),
  accepted("GET", `/bitbucket.example.net/scm/~jdoe/tools.git/info/refs${UP}`, "bitbucket.example.net", "bitbucket.example.net/~jdoe/tools", "fetch"),
  accepted("POST", "/bitbucket.example.net/scm/~JDOE/tools.git/git-upload-pack", "bitbucket.example.net", "bitbucket.example.net/~jdoe/tools", "fetch"),
  // nested groups
  accepted("GET", `/gitlab.example.com/group/subgroup/project.git/info/refs${UP}`, "gitlab.example.com", "gitlab.example.com/group/subgroup/project", "fetch"),
  // "scm" and "src" are ordinary names except where the address normaliser gives them a meaning
  accepted("GET", `/github.com/example-org/scm.git/info/refs${UP}`, "github.com", "github.com/example-org/scm", "fetch"),
  accepted("POST", "/gitlab.example.com/group/scm/project.git/git-upload-pack", "gitlab.example.com", "gitlab.example.com/group/scm/project", "fetch"),
  accepted("GET", `/github.com/example-org/src.git/info/refs${UP}`, "github.com", "github.com/example-org/src", "fetch"),
  // a repository whose own name is a git endpoint name
  accepted("GET", `/github.com/example-org/info/refs/info/refs${UP}`, "github.com", "github.com/example-org/info/refs", "fetch"),
  accepted("POST", "/github.com/example-org/git-upload-pack/git-receive-pack", "github.com", "github.com/example-org/git-upload-pack", "push"),
  // host map
  accepted("GET", `/bb/scm/proj/service.git/info/refs${UP}`, ...BB, "fetch", { bb: "bitbucket.example.net" }),
  accepted("GET", `/BB/scm/proj/service.git/info/refs${UP}`, ...BB, "fetch", { bb: "ssh.bitbucket.example.net" }),
  accepted("GET", `/github.com/example-org/app.git/info/refs${UP}`, ...GH, "fetch", { bb: "bitbucket.example.net" }),
  refused("GET", `/bb/scm/proj/service.git/info/refs${UP}`, "invalid-host", { bb: "https://bitbucket.example.net" }),
  refused("GET", `/bb/scm/proj/service.git/info/refs${UP}`, "invalid-host", { bb: "bitbucket.example.net:7999" }),

  // any other method
  refused("HEAD", `/github.com/example-org/app.git/info/refs${UP}`, "method-not-allowed"),
  refused("PUT", "/github.com/example-org/app.git/git-receive-pack", "method-not-allowed"),
  refused("DELETE", "/github.com/example-org/app.git", "method-not-allowed"),
  refused("OPTIONS", "/github.com/example-org/app.git/git-upload-pack", "method-not-allowed"),
  refused("PROPFIND", "/github.com/example-org/app.git/", "method-not-allowed"),
  refused("get", `/github.com/example-org/app.git/info/refs${UP}`, "method-not-allowed"),
  refused("POST", `/github.com/example-org/app.git/info/refs${UP}`, "method-not-allowed"),
  refused("GET", "/github.com/example-org/app.git/git-upload-pack", "method-not-allowed"),
  refused("GET", "/github.com/example-org/app.git/git-receive-pack", "method-not-allowed"),
  // any other path
  refused("GET", "/", "empty-segment"),
  refused("GET", "/github.com/example-org/app.git", "not-a-git-address"),
  refused("GET", "/github.com/example-org/app.git/HEAD", "not-a-git-address"),
  refused("GET", "/github.com/example-org/app.git/objects/info/packs", "not-a-git-address"),
  refused("GET", "/github.com/example-org/app.git/info/lfs/objects/batch", "not-a-git-address"),
  refused("POST", "/github.com/example-org/app.git/info/lfs/objects/batch", "not-a-git-address"),
  refused("POST", "/github.com/example-org/app.git/git-upload-archive", "not-a-git-address"),
  refused("GET", `/github.com/example-org/app.git/INFO/REFS${UP}`, "not-a-git-address"),
  refused("POST", "/github.com/example-org/app.git/GIT-UPLOAD-PACK", "not-a-git-address"),
  refused("POST", "/github.com/example-org/app.git/constructor", "not-a-git-address"),
  refused("POST", "/github.com/example-org/app.git/__proto__", "not-a-git-address"),
  refused("POST", "/github.com/example-org/app.git/toString", "not-a-git-address"),
  refused("GET", `/github.com/example-org/app.git/info/refs/extra${UP}`, "not-a-git-address"),
  refused("GET", `github.com/example-org/app.git/info/refs${UP}`, "invalid-target"),
  refused("GET", `http://gateway/github.com/example-org/app.git/info/refs${UP}`, "invalid-target"),
  refused("GET", "", "invalid-target"),
  // the query
  refused("GET", "/github.com/example-org/app.git/info/refs", "missing-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-archive", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=GIT-UPLOAD-PACK", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=constructor", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=__proto__", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=toString", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack%00", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git%2Dupload%2Dpack", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack;x=1", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack?service=git-receive-pack", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack#x", "unknown-service"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack&x=1", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?x=1&service=git-upload-pack", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack&service=git-receive-pack", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack&service=git-upload-pack", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack&", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?&service=git-upload-pack", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?SERVICE=git-upload-pack", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service[]=git-upload-pack", "unexpected-query"),
  refused("GET", "/github.com/example-org/app.git/info/refs?%73ervice=git-upload-pack", "unexpected-query"),
  refused("POST", "/github.com/example-org/app.git/git-upload-pack?service=git-upload-pack", "unexpected-query"),
  refused("POST", "/github.com/example-org/app.git/git-receive-pack?x=1", "unexpected-query"),
  refused("POST", "/github.com/example-org/app.git/git-upload-pack?", "unexpected-query"),
  // encoded slashes and dots, other encodings
  refused("GET", `/github.com/example-org%2fapp.git/info/refs${UP}`, "encoded-slash"),
  refused("GET", `/github.com/example-org%2Fapp.git/info/refs${UP}`, "encoded-slash"),
  refused("GET", `/github.com/example-org/app.git%2Finfo/refs${UP}`, "encoded-slash"),
  refused("GET", `/github.com/example-org/%2e%2e/other/app.git/info/refs${UP}`, "encoded-dot"),
  refused("GET", `/github.com/example-org/.%2E/other/app.git/info/refs${UP}`, "encoded-dot"),
  refused("GET", `/github.com/example-org/app%2egit/info/refs${UP}`, "encoded-dot"),
  refused("GET", `/github.com/example-org/%252e%252e/app.git/info/refs${UP}`, "encoded-character"),
  refused("GET", `/github.com/example-org/app%00.git/info/refs${UP}`, "encoded-character"),
  refused("GET", `/github.com/example-org/a%70p.git/info/refs${UP}`, "encoded-character"),
  refused("GET", `/github.com/example-org/app%5c..%5cother.git/info/refs${UP}`, "encoded-character"),
  refused("GET", `/github.com/example-org/app%.git/info/refs${UP}`, "encoded-character"),
  // dot segments
  refused("GET", `/github.com/example-org/../other-org/app.git/info/refs${UP}`, "dot-segment"),
  refused("GET", `/github.com/example-org/./app.git/info/refs${UP}`, "dot-segment"),
  refused("GET", `/github.com/example-org/app.git/../../other/app.git/info/refs${UP}`, "dot-segment"),
  refused("GET", `/../github.com/example-org/app.git/info/refs${UP}`, "dot-segment"),
  refused("POST", "/github.com/example-org/app.git/../app.git/git-receive-pack", "dot-segment"),
  refused("GET", `/github.com/example-org/..git/info/refs${UP}`, "unsupported-path-form"),
  // empty segments and trailing slashes
  refused("GET", `//github.com/example-org/app.git/info/refs${UP}`, "empty-segment"),
  refused("GET", `/github.com//example-org/app.git/info/refs${UP}`, "empty-segment"),
  refused("GET", `/github.com/example-org//app.git/info/refs${UP}`, "empty-segment"),
  refused("GET", `/github.com/example-org/app.git//info/refs${UP}`, "empty-segment"),
  refused("GET", `/github.com/example-org/app.git/info//refs${UP}`, "empty-segment"),
  refused("GET", `/github.com/example-org/app.git/info/refs/${UP}`, "empty-segment"),
  refused("POST", "/github.com/example-org/app.git/git-upload-pack/", "empty-segment"),
  refused("POST", "/github.com/example-org/app.git//git-receive-pack", "empty-segment"),
  // backslashes and control characters
  refused("GET", `/github.com/example-org\\app.git/info/refs${UP}`, "backslash"),
  refused("GET", `/github.com/example-org/..\\other\\app.git/info/refs${UP}`, "backslash"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack\\", "backslash"),
  refused("GET", `/github.com/example-org/app\u0000.git/info/refs${UP}`, "control-character"),
  refused("GET", `/github.com/example-org/app.git\r\n/info/refs${UP}`, "control-character"),
  refused("GET", `/github.com/example-org/app\t.git/info/refs${UP}`, "control-character"),
  refused("GET", `/github.com/example-org/app\u007f.git/info/refs${UP}`, "control-character"),
  refused("GET", "/github.com/example-org/app.git/info/refs?service=git-upload-pack\n", "control-character"),
  // other characters
  refused("GET", `/github.com/example-org/app name.git/info/refs${UP}`, "invalid-character"),
  refused("GET", `/git@github.com/example-org/app.git/info/refs${UP}`, "invalid-character"),
  refused("GET", `/github.com:443/example-org/app.git/info/refs${UP}`, "invalid-character"),
  refused("GET", `/github.com/example-org/app.git;x=1/info/refs${UP}`, "invalid-character"),
  refused("GET", `/github.com/example-org/app.git#/info/refs${UP}`, "invalid-character"),
  refused("GET", `/github.com/example-org/*/info/refs${UP}`, "invalid-character"),
  refused("GET", `/github.com/example-org/appé.git/info/refs${UP}`, "invalid-character"),
  refused("GET", `/github.com/example-org/．．/app.git/info/refs${UP}`, "invalid-character"),
  // too long
  refused("GET", `/github.com/example-org/${"a".repeat(1024)}.git/info/refs${UP}`, "target-too-long"),
  // fewer than two path segments after the host
  refused("GET", `/info/refs${UP}`, "too-few-segments"),
  refused("POST", "/git-upload-pack", "too-few-segments"),
  refused("GET", `/github.com/info/refs${UP}`, "too-few-segments"),
  refused("GET", `/github.com/app.git/info/refs${UP}`, "too-few-segments"),
  refused("POST", "/github.com/example-org/git-receive-pack", "too-few-segments"),
  refused("GET", `/bitbucket.example.net/scm/service.git/info/refs${UP}`, "too-few-segments"),
  // the host
  refused("GET", `/github.com./example-org/app.git/info/refs${UP}`, "invalid-host"),
  refused("GET", `/-github.com/example-org/app.git/info/refs${UP}`, "invalid-host"),
  refused("GET", `/git_hub.com/example-org/app.git/info/refs${UP}`, "invalid-host"),
  refused("GET", `/~jdoe/example-org/app.git/info/refs${UP}`, "invalid-host"),
  refused("GET", `/ssh.ssh.github.com/example-org/app.git/info/refs${UP}`, "invalid-host"),
  // .git in any other letter case, or more than once
  refused("GET", `/github.com/example-org/app.GIT/info/refs${UP}`, "invalid-git-suffix"),
  refused("GET", `/github.com/example-org/app.Git/info/refs${UP}`, "invalid-git-suffix"),
  refused("POST", "/github.com/example-org/app.gIT/git-receive-pack", "invalid-git-suffix"),
  refused("GET", `/github.com/example-org/.git/info/refs${UP}`, "invalid-git-suffix"),
  refused("GET", `/github.com/example-org/app/.git/info/refs${UP}`, "invalid-git-suffix"),
  refused("GET", `/github.com/example-org/app.git.git/info/refs${UP}`, "unsupported-path-form"),
  // web-page forms the address normaliser would shorten to another repository's name
  refused("GET", `/bitbucket.example.net/projects/PROJ/repos/service/info/refs${UP}`, "unsupported-path-form"),
  refused("GET", `/bitbucket.example.net/projects/PROJ/repos/service.git/info/refs${UP}`, "unsupported-path-form"),
  refused("GET", `/github.com/example-org/app/tree/main.git/info/refs${UP}`, "unsupported-path-form"),
  refused("GET", `/github.com/example-org/app/blob/main/info/refs${UP}`, "unsupported-path-form"),
  refused("GET", `/gitlab.example.com/group/subgroup/src/other.git/info/refs${UP}`, "unsupported-path-form"),
  refused("GET", `/gitlab.example.com/group/subgroup/-/other.git/info/refs${UP}`, "unsupported-path-form"),
  refused("POST", "/gitlab.example.com/group/subgroup/pulls/git-receive-pack", "unsupported-path-form"),
  refused("GET", `/bitbucket.example.net/scm/scm/proj/service.git/info/refs${UP}`, "unsupported-path-form"),
];

// ── decisions ────────────────────────────────────────────────────────────────

const LIST = [
  { repo: "bitbucket.example.net/~jdoe/tools", access: "r" },
  { repo: "github.com/example-org/app", access: "rw" },
];
const decision = (repo, op, result) => ({ repos: LIST, request: { host: repo.split("/")[0], repo, op }, result });
const decisions = [
  decision("github.com/example-org/app", "fetch", { allowed: true, access: "rw" }),
  decision("github.com/example-org/app", "push", { allowed: true, access: "rw" }),
  decision("bitbucket.example.net/~jdoe/tools", "fetch", { allowed: true, access: "r" }),
  decision("bitbucket.example.net/~jdoe/tools", "push", { allowed: false, reason: "fetch-only" }),
  decision("github.com/example-org/other", "fetch", { allowed: false, reason: "repo-not-on-list" }),
  decision("github.com/example-org/other", "push", { allowed: false, reason: "repo-not-on-list" }),
  decision("github.com/example-org/app2", "fetch", { allowed: false, reason: "repo-not-on-list" }),
  decision("github.com/example-org/ap", "fetch", { allowed: false, reason: "repo-not-on-list" }),
  decision("github.com/example-org/app/sub", "fetch", { allowed: false, reason: "repo-not-on-list" }),
  decision("github.com/example-org", "fetch", { allowed: false, reason: "repo-not-on-list" }),
  decision("gitlab.example.com/example-org/app", "fetch", { allowed: false, reason: "repo-not-on-list" }),
];

// ── write ────────────────────────────────────────────────────────────────────

const file = {
  WARNING:
    "TEST VECTORS. The key pairs under `keys` were generated only for these vectors, are published in this repository, and are not secrets. Never configure them in any service. Written by make-vectors.mjs; edit that file, not this one.",
  format: { typ: TYP, alg: "ES256", version: 1, maxTokenLength: MAX_TOKEN_LENGTH, clockSkewSeconds: CLOCK_SKEW_SECONDS },
  howToRead: {
    keys: "Named key pairs. A vector's `keys` maps kid to a name here: `name` is that pair's public key PEM, `name/private` its private key PEM.",
    verification: "verifyGitScope(token, { keys, now, expected }) must give `result`: the payload, or exactly that reason.",
    addresses: "`repo` is the list entry for a profile whose only address is `address`; null means the address is refused (the profile cannot get a list).",
    profiles: "`repos` is the profile's list (sorted, no repeats); null means building it fails.",
    requests: "parseGitGatewayRequest(method, target, hostMap) must give `result`.",
    decisions: "decideGitRequest on a verified list with these `repos` must give `result`.",
  },
  keys,
  verification,
  addresses,
  profiles,
  requests,
  decisions,
};
writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
console.log(
  `wrote ${OUT}: ${verification.length} verification, ${addresses.length} addresses, ${profiles.length} profiles, ${requests.length} requests, ${decisions.length} decisions`,
);
