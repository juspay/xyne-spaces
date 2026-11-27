/**
 * Runtime side of the git scope: ask claw-auth (the signer) for the signed list
 * of repositories one SandboxClaim may use, and check the answer before it goes
 * on the claim. The runtime has no public key, so it cannot check the
 * signature; it checks that the token is well-formed and was made for this
 * claim. The git-gateway does the real verification (verifyGitScope).
 *
 * The call is made like the SDLC credential bootstrap (sdlc-credential-bootstrap.ts):
 * the runtime's service proof plus the run's session token. claw-auth decides
 * which profiles the run may have signed from its own records for the session.
 *
 *   POST <claw-auth>/claw/api/v1/sessions/<runSessionId>/git-scope
 *   headers   x-service-assertion (serviceAuth), Authorization: Bearer <sessionToken>
 *   request   { "profile": string, "claimName": string, "namespace": string,
 *               "template": string, "endTime": integer unix seconds }
 *   response  200 { "token": string }      anything else is a refusal
 */
import type { GitScopeClaim } from "@xyne/kata-sdk";
import { GIT_SCOPE_ALG, GIT_SCOPE_MAX_TOKEN_LENGTH, GIT_SCOPE_TYP, GIT_SCOPE_VERSION } from "../../git-scope/token.js";
import { isCanonicalGitScopeRepo } from "../../git-scope/repos.js";

/** The claw-auth route, for one run session. */
export function gitScopeSignerUrl(authUrl: string, runSessionId: string): string {
  return `${authUrl.trim().replace(/\/+$/, "")}/claw/api/v1/sessions/${encodeURIComponent(runSessionId)}/git-scope`;
}
const SIGNER_TIMEOUT_MS = 10_000;
const LOOKS_STALE_RE = /not found|could not connect|HTTP request failed|ECONN|socket hang up/i;

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

/** How the runtime reaches claw-auth; the same pieces the SDLC credential bootstrap uses. */
export interface GitScopeSignerTransport {
  authUrl: string | undefined;
  /** Signs the call as the runtime (never a key). */
  serviceAuth?: ((method: string, url: string) => Record<string, string>) | undefined;
  runSessionId: string | undefined;
  sessionToken: string | undefined;
}

export interface RequestGitScopeOptions {
  transport: GitScopeSignerTransport;
  request: GitScopeSignRequest;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Ask claw-auth for one claim's list and check it. Throws GitScopeSignerError on any failure. */
export async function requestGitScope(options: RequestGitScopeOptions): Promise<string> {
  const { request, transport } = options;
  const fail = (why: string) =>
    new GitScopeSignerError(`The git-scope signer (claw-auth) ${why}; the sandbox for profile "${request.profile}" was not created.`);
  const authUrl = transport.authUrl?.trim();
  if (!authUrl || !transport.serviceAuth || !transport.runSessionId || !transport.sessionToken) {
    throw fail("cannot be asked from this run (no claw-auth URL, service signer or run session token)");
  }
  const url = gitScopeSignerUrl(authUrl, transport.runSessionId);
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...transport.serviceAuth("POST", url),
        Authorization: `Bearer ${transport.sessionToken}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(options.timeoutMs ?? SIGNER_TIMEOUT_MS),
    });
  } catch (err) {
    // The error name only: a raw network message (ECONNREFUSED, ...) would be
    // read as a dead sandbox by the setup fallback and hide this failure.
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw fail(`could not be reached (${timedOut ? "timed out" : "network error"})`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    // claw-auth's refusal says why (unknown or disabled profile, wrong template, ...); it never carries a token.
    // Dropped when it reads like a dead sandbox to the setup fallback (STALE_PATTERNS in tools.ts).
    const text = isRecord(body) && typeof body["error"] === "string" ? body["error"].slice(0, 200) : "";
    const reason = text && !LOOKS_STALE_RE.test(text) ? `: ${text}` : "";
    throw fail(`refused the request (HTTP ${response.status}${reason})`);
  }
  if (body === undefined) throw fail("returned a response that is not JSON");
  const token = isRecord(body) ? body["token"] : undefined;
  const problem = checkGitScopeToken(token, request);
  if (problem) throw fail(`returned an unusable list: ${problem}`);
  return token as string;
}

/** The kata-sdk createSession hook that requests the list for `profile`. */
export function gitScopeForProfile(
  profile: string,
  transport: GitScopeSignerTransport,
  extra: Omit<RequestGitScopeOptions, "transport" | "request"> = {},
): (claim: GitScopeClaim) => Promise<string> {
  return (claim) =>
    requestGitScope({
      ...extra,
      transport,
      request: {
        profile,
        claimName: claim.claimName,
        namespace: claim.namespace,
        template: claim.template,
        endTime: Math.floor(claim.endTime.getTime() / 1000),
      },
    });
}
