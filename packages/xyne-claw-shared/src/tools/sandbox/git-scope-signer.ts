/**
 * Runtime side of the git scope: ask the signer for the signed list of
 * repositories one SandboxClaim may use, and check the answer before it goes on
 * the claim. The runtime has no public key, so it cannot check the signature;
 * it checks that the token is well-formed and was made for this claim. The
 * git-gateway does the real verification (verifyGitScope).
 *
 *   POST <GIT_SCOPE_SIGNER_URL>/v1/git-scope
 *   request   { "profile": string, "claimName": string, "namespace": string,
 *               "template": string, "endTime": integer unix seconds }
 *   response  200 { "token": string }      anything else is a refusal
 */
import type { GitScopeClaim } from "@xyne/kata-sdk";
import { GIT_SCOPE_ALG, GIT_SCOPE_MAX_TOKEN_LENGTH, GIT_SCOPE_TYP, GIT_SCOPE_VERSION } from "../../git-scope/token.js";
import { isCanonicalGitScopeRepo } from "../../git-scope/repos.js";

export const GIT_SCOPE_SIGNER_URL_KEY = "GIT_SCOPE_SIGNER_URL";
export const GIT_SCOPE_SIGNER_PATH = "/v1/git-scope";
const SIGNER_TIMEOUT_MS = 10_000;

export interface GitScopeSignRequest {
  profile: string;
  claimName: string;
  namespace: string;
  template: string;
  /** Unix seconds; equals the claim's shutdownTime. */
  endTime: number;
}

export interface GitScopeSignResponse {
  token: string;
}

/** Sandbox creation for a profile stops with this; the message always names the signer. */
export class GitScopeSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitScopeSignerError";
  }
}

const PAYLOAD_KEYS = ["v", "claim", "ns", "tpl", "profile", "iat", "exp", "repos"];
const HEADER_KEYS = ["alg", "typ", "kid"];
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function decodeSegment(segment: string | undefined): Buffer | null {
  if (segment === undefined || !B64URL_RE.test(segment)) return null;
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}

function decodeJson(segment: string | undefined): Record<string, unknown> | null {
  const bytes = decodeSegment(segment);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Check a token from the signer without its key: the shape of the format in
 * ../../git-scope/index.ts, and that it names exactly this request. Returns the
 * problem, or null when the token is acceptable. Never repeats a token value.
 */
export function checkGitScopeToken(token: unknown, expected: GitScopeSignRequest): string | null {
  if (typeof token !== "string" || token.length === 0) return "no token";
  if (token.length > GIT_SCOPE_MAX_TOKEN_LENGTH) return `token is longer than ${GIT_SCOPE_MAX_TOKEN_LENGTH} characters`;
  const parts = token.split(".");
  if (parts.length !== 3) return "token is not three base64url parts";
  const header = decodeJson(parts[0]);
  if (!header || !hasExactlyKeys(header, HEADER_KEYS)) return "token header is malformed";
  if (header["alg"] !== GIT_SCOPE_ALG || header["typ"] !== GIT_SCOPE_TYP) return "token is not a git scope (alg/typ)";
  if (typeof header["kid"] !== "string" || header["kid"].length === 0) return "token header has no kid";
  const signature = decodeSegment(parts[2]);
  if (!signature || signature.length !== 64) return "token signature is not 64 bytes";
  const payload = decodeJson(parts[1]);
  if (!payload || !hasExactlyKeys(payload, PAYLOAD_KEYS)) return "token payload is malformed";
  if (payload["v"] !== GIT_SCOPE_VERSION) return "token payload has an unsupported version";
  if (payload["claim"] !== expected.claimName) return "token is for another claim";
  if (payload["ns"] !== expected.namespace) return "token is for another namespace";
  if (payload["tpl"] !== expected.template) return "token is for another template";
  if (payload["profile"] !== expected.profile) return "token is for another profile";
  if (payload["exp"] !== expected.endTime) return "token end time is not the claim's end time";
  const iat = payload["iat"];
  if (typeof iat !== "number" || !Number.isSafeInteger(iat) || iat < 0 || iat >= expected.endTime) return "token iat is invalid";
  const repos = payload["repos"];
  if (!Array.isArray(repos)) return "token repos is not an array";
  const seen = new Set<string>();
  for (const entry of repos as unknown[]) {
    if (!isRecord(entry) || !hasExactlyKeys(entry, ["repo", "access"])) return "token repos entry is malformed";
    if (!isCanonicalGitScopeRepo(entry["repo"])) return "token repos entry is not a canonical repository";
    if (entry["access"] !== "rw" && entry["access"] !== "r") return "token repos entry has an unknown access";
    if (seen.has(entry["repo"])) return "token lists a repository twice";
    seen.add(entry["repo"]);
  }
  return null;
}

export interface RequestGitScopeOptions {
  /** Base address of the signer (runtime config GIT_SCOPE_SIGNER_URL). */
  signerUrl: string | undefined;
  request: GitScopeSignRequest;
  /**
   * Headers that prove the runtime is the caller.
   * TODO(git-scope auth): the signer (encryption service) has no service name
   * or verifier yet, and the runtime's service proof is fixed to the claw-auth
   * audience and carries the run's session token, so it is not sent here.
   * Wire a signer-audience proof through this hook once the signer exists.
   */
  authHeaders?: (method: string, url: string) => Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Ask the signer for one claim's list and check it. Throws GitScopeSignerError on any failure. */
export async function requestGitScope(options: RequestGitScopeOptions): Promise<string> {
  const { request } = options;
  const fail = (why: string) =>
    new GitScopeSignerError(
      `The git-scope signer (${GIT_SCOPE_SIGNER_URL_KEY}) ${why}; the sandbox for profile "${request.profile}" was not created.`,
    );
  const base = options.signerUrl?.trim().replace(/\/+$/, "");
  if (!base) throw fail("is not configured");
  const url = `${base}${GIT_SCOPE_SIGNER_PATH}`;
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.authHeaders?.("POST", url) ?? {}) },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(options.timeoutMs ?? SIGNER_TIMEOUT_MS),
    });
  } catch (err) {
    // The error name only: a raw network message (ECONNREFUSED, ...) would be
    // read as a dead sandbox by the setup fallback and hide this failure.
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw fail(`could not be reached (${timedOut ? "timed out" : "network error"})`);
  }
  if (!response.ok) throw fail(`refused the request (HTTP ${response.status})`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw fail("returned a response that is not JSON");
  }
  const token = isRecord(body) ? body["token"] : undefined;
  const problem = checkGitScopeToken(token, request);
  if (problem) throw fail(`returned an unusable list: ${problem}`);
  return token as string;
}

/** The kata-sdk createSession hook that requests the list for `profile`. */
export function gitScopeForProfile(
  profile: string,
  config: Record<string, string>,
  extra: Omit<RequestGitScopeOptions, "signerUrl" | "request"> = {},
): (claim: GitScopeClaim) => Promise<string> {
  return (claim) =>
    requestGitScope({
      ...extra,
      signerUrl: config[GIT_SCOPE_SIGNER_URL_KEY],
      request: {
        profile,
        claimName: claim.claimName,
        namespace: claim.namespace,
        template: claim.template,
        endTime: Math.floor(claim.endTime.getTime() / 1000),
      },
    });
}
