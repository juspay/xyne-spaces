import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { TextDecoder } from "node:util";
import { GitScopeError, isCanonicalGitScopeRepo } from "./repos.js";

export const GIT_SCOPE_TYP = "xyne-git-scope+jwt";
export const GIT_SCOPE_ALG = "ES256";
export const GIT_SCOPE_VERSION = 1;
/** Hard cap on the whole token, in characters (a token is ASCII, so also bytes). */
export const GIT_SCOPE_MAX_TOKEN_LENGTH = 16 * 1024;
/** How far in the future `iat` may be before the token is refused. `exp` gets no allowance. */
export const GIT_SCOPE_CLOCK_SKEW_SECONDS = 60;

const MAX_NAME_LENGTH = 253;
const MAX_KID_LENGTH = 256;
const SIGNATURE_BYTES = 64;

export type GitScopeAccess = "rw" | "r";

export interface GitScopeRepo {
  /** Canonical `host/path`, see isCanonicalGitScopeRepo. */
  readonly repo: string;
  /** "rw" = fetch and push, "r" = fetch only. */
  readonly access: GitScopeAccess;
}

export interface GitScopePayload {
  readonly v: 1;
  /** SandboxClaim name. */
  readonly claim: string;
  /** SandboxClaim namespace. */
  readonly ns: string;
  /** Template the claim uses. */
  readonly tpl: string;
  /** Profile key the list was built from. */
  readonly profile: string;
  /** Unix seconds. */
  readonly iat: number;
  /** Unix seconds: the claim's end time. */
  readonly exp: number;
  readonly repos: readonly GitScopeRepo[];
}

declare const verifiedGitScope: unique symbol;
/** A payload that came out of verifyGitScope. Only this type is accepted by decideGitRequest. */
export type VerifiedGitScope = GitScopePayload & { readonly [verifiedGitScope]: true };

export const GIT_SCOPE_REJECTIONS = [
  "malformed",
  "too-large",
  "wrong-alg",
  "wrong-type",
  "unknown-key",
  "bad-signature",
  "unsupported-version",
  "invalid-payload",
  "not-for-this-claim",
  "wrong-namespace",
  "wrong-template",
  "expired",
] as const;
export type GitScopeRejection = (typeof GIT_SCOPE_REJECTIONS)[number];

/** kid → public key PEM ("-----BEGIN PUBLIC KEY-----", P-256). */
export type GitScopeKeys = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

/** What the caller found in the cluster for the sandbox that is asking. */
export interface GitScopeExpected {
  readonly claim: string;
  readonly namespace: string;
  /** Checked against `tpl` when given. */
  readonly template?: string | undefined;
}

export interface VerifyGitScopeOptions {
  readonly keys: GitScopeKeys;
  readonly expected: GitScopeExpected;
  /** Unix seconds; the current time when omitted. */
  readonly now?: number | undefined;
}

/** `detail` says which rule an "invalid-payload" broke. It is for logs; it never repeats a value from the token. */
export type GitScopeVerification =
  | { readonly ok: true; readonly scope: VerifiedGitScope }
  | { readonly ok: false; readonly reason: GitScopeRejection; readonly detail?: string };

const PAYLOAD_KEYS = ["v", "claim", "ns", "tpl", "profile", "iat", "exp", "repos"] as const;
const NAME_KEYS = ["claim", "ns", "tpl", "profile"] as const;
const HEADER_KEYS = ["alg", "typ", "kid"] as const;
const REPO_KEYS = ["repo", "access"] as const;

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const b64url = (text: string): string => Buffer.from(text, "utf8").toString("base64url");

function isP256(key: KeyObject): boolean {
  return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NAME_LENGTH && !CONTROL_RE.test(value);
}

function isKid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KID_LENGTH;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Strict base64url: the alphabet only, no padding, and no other spelling of the same bytes. */
function decodeSegment(segment: string | undefined): Buffer | null {
  if (segment === undefined || !B64URL_RE.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}

function parseJsonObject(bytes: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(utf8.decode(bytes));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

type PayloadCheck = { ok: true; payload: GitScopePayload } | { ok: false; problem: string };

/** One schema for both directions: what signGitScope refuses to sign is what verifyGitScope refuses to accept. */
function checkPayload(value: unknown): PayloadCheck {
  const bad = (problem: string): PayloadCheck => ({ ok: false, problem });
  if (!isRecord(value)) return bad("payload is not an object");
  if (value["v"] !== GIT_SCOPE_VERSION) return bad(`v is not ${GIT_SCOPE_VERSION}`);
  if (!hasExactlyKeys(value, PAYLOAD_KEYS)) return bad(`payload must have exactly the members ${PAYLOAD_KEYS.join(", ")}`);
  for (const key of NAME_KEYS) {
    if (!isName(value[key])) return bad(`${key} must be a string of 1 to ${MAX_NAME_LENGTH} characters without control characters`);
  }
  const { iat, exp, repos } = value;
  if (!isTimestamp(iat)) return bad("iat must be a whole number of unix seconds");
  if (!isTimestamp(exp)) return bad("exp must be a whole number of unix seconds");
  if (exp <= iat) return bad("exp must be later than iat");
  if (!Array.isArray(repos)) return bad("repos must be an array");

  const entries: GitScopeRepo[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < repos.length; i++) {
    const entry: unknown = repos[i];
    if (!isRecord(entry) || !hasExactlyKeys(entry, REPO_KEYS)) return bad(`repos[${i}] must have exactly the members repo, access`);
    const { repo, access } = entry;
    if (!isCanonicalGitScopeRepo(repo)) return bad(`repos[${i}].repo is not a canonical host/path`);
    if (access !== "rw" && access !== "r") return bad(`repos[${i}].access must be "rw" or "r"`);
    if (seen.has(repo)) return bad(`repos[${i}].repo is listed twice`);
    seen.add(repo);
    entries.push({ repo, access });
  }

  return {
    ok: true,
    payload: {
      v: GIT_SCOPE_VERSION,
      claim: value["claim"] as string,
      ns: value["ns"] as string,
      tpl: value["tpl"] as string,
      profile: value["profile"] as string,
      iat,
      exp,
      repos: entries,
    },
  };
}

/**
 * Sign a list for one SandboxClaim. Throws GitScopeError when the payload does
 * not fit the format, the key is not a P-256 private key, or the result would
 * exceed GIT_SCOPE_MAX_TOKEN_LENGTH.
 */
export function signGitScope(payload: GitScopePayload, privateKeyPem: string, kid: string): string {
  const checked = checkPayload(payload);
  if (!checked.ok) throw new GitScopeError(`git scope payload is invalid: ${checked.problem}`);
  if (!isKid(kid)) throw new GitScopeError(`git scope kid must be a string of 1 to ${MAX_KID_LENGTH} characters`);

  let key: KeyObject;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new GitScopeError("git scope signing key could not be parsed");
  }
  if (!isP256(key)) throw new GitScopeError("git scope signing key must be an EC P-256 private key");

  const header = { alg: GIT_SCOPE_ALG, typ: GIT_SCOPE_TYP, kid };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(checked.payload))}`;
  const signature = sign("sha256", Buffer.from(input, "ascii"), { key, dsaEncoding: "ieee-p1363" });
  const token = `${input}.${signature.toString("base64url")}`;
  if (token.length > GIT_SCOPE_MAX_TOKEN_LENGTH) {
    throw new GitScopeError(`git scope token would be ${token.length} characters; the limit is ${GIT_SCOPE_MAX_TOKEN_LENGTH}`);
  }
  return token;
}

const publicKeyCache = new Map<string, KeyObject | null>();

/** Only a P-256 public key in a "PUBLIC KEY" PEM. A private key PEM is refused: a verifier must not hold one. */
function p256PublicKey(pem: string): KeyObject | null {
  const cached = publicKeyCache.get(pem);
  if (cached !== undefined) return cached;
  let key: KeyObject | null = null;
  if (/^\s*-----BEGIN PUBLIC KEY-----/.test(pem)) {
    try {
      const parsed = createPublicKey(pem);
      if (parsed.type === "public" && isP256(parsed)) key = parsed;
    } catch {
      key = null;
    }
  }
  if (publicKeyCache.size >= 64) publicKeyCache.clear();
  publicKeyCache.set(pem, key);
  return key;
}

function lookupKey(keys: GitScopeKeys, kid: string): KeyObject | null {
  let pem: unknown;
  if (keys instanceof Map) {
    pem = (keys as ReadonlyMap<string, unknown>).get(kid);
  } else if (isRecord(keys) && Object.prototype.hasOwnProperty.call(keys, kid)) {
    pem = keys[kid];
  }
  return typeof pem === "string" ? p256PublicKey(pem) : null;
}

function freezeScope(payload: GitScopePayload): VerifiedGitScope {
  const repos = Object.freeze(payload.repos.map((entry) => Object.freeze({ ...entry })));
  return Object.freeze({ ...payload, repos }) as VerifiedGitScope;
}

/**
 * Verify a list and that it was made for the claim the caller found in the
 * cluster. Returns the payload or exactly one reason; a bad token never throws.
 * A TypeError is thrown only for a caller mistake (no claim or namespace to
 * check against, a `now` that is not a number), so that a mistake cannot turn a
 * check off.
 *
 * Order: size, shape, header (alg, typ), key, signature, then the payload
 * (version, schema, claim, namespace, template, time). Nothing from the payload
 * is acted on before the signature is known to be good.
 */
export function verifyGitScope(token: unknown, options: VerifyGitScopeOptions): GitScopeVerification {
  const { keys, expected } = options;
  if (!isRecord(expected) || !isName(expected.claim) || !isName(expected.namespace)) {
    throw new TypeError("verifyGitScope: expected.claim and expected.namespace are required");
  }
  if (expected.template !== undefined && typeof expected.template !== "string") {
    throw new TypeError("verifyGitScope: expected.template must be a string when given");
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof now !== "number" || !Number.isFinite(now)) {
    throw new TypeError("verifyGitScope: now must be a number of unix seconds");
  }
  const reject = (reason: GitScopeRejection, detail?: string): GitScopeVerification =>
    detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };

  if (typeof token !== "string") return reject("malformed");
  if (token.length > GIT_SCOPE_MAX_TOKEN_LENGTH) return reject("too-large");
  const parts = token.split(".");
  if (parts.length !== 3) return reject("malformed");
  const [headerPart, payloadPart, signaturePart] = parts;

  const headerBytes = decodeSegment(headerPart);
  const header = headerBytes ? parseJsonObject(headerBytes) : null;
  if (!header) return reject("malformed");
  if (header["alg"] !== GIT_SCOPE_ALG) return reject("wrong-alg");
  if (header["typ"] !== GIT_SCOPE_TYP) return reject("wrong-type");
  if (!hasExactlyKeys(header, HEADER_KEYS)) return reject("malformed");

  const payloadBytes = decodeSegment(payloadPart);
  const signature = decodeSegment(signaturePart);
  if (!payloadBytes || !signature) return reject("malformed");

  const kid = header["kid"];
  const key = isKid(kid) ? lookupKey(keys, kid) : null;
  if (!key) return reject("unknown-key");

  let signed = false;
  if (signature.length === SIGNATURE_BYTES) {
    try {
      signed = verify("sha256", Buffer.from(`${headerPart}.${payloadPart}`, "ascii"), { key, dsaEncoding: "ieee-p1363" }, signature);
    } catch {
      signed = false;
    }
  }
  if (!signed) return reject("bad-signature");

  const payload = parseJsonObject(payloadBytes);
  if (!payload) return reject("invalid-payload", "payload is not a JSON object");
  if (payload["v"] !== GIT_SCOPE_VERSION) return reject("unsupported-version");
  const checked = checkPayload(payload);
  if (!checked.ok) return reject("invalid-payload", checked.problem);
  const scope = checked.payload;

  if (scope.claim !== expected.claim) return reject("not-for-this-claim");
  if (scope.ns !== expected.namespace) return reject("wrong-namespace");
  if (expected.template !== undefined && scope.tpl !== expected.template) return reject("wrong-template");
  if (now >= scope.exp || scope.iat > now + GIT_SCOPE_CLOCK_SKEW_SECONDS) return reject("expired");

  return { ok: true, scope: freezeScope(scope) };
}
