import { normalizeRepoUrl } from "../tools/sandbox/repo-url.js";
import { isCanonicalGitScopeHost, isCanonicalGitScopeRepo } from "./repos.js";
import type { GitScopeAccess, VerifiedGitScope } from "./token.js";

/** Hard cap on the request target (path and query), in characters. */
export const GIT_GATEWAY_MAX_TARGET_LENGTH = 1024;

export type GitGatewayOp = "fetch" | "push";

export interface GitGatewayRequest {
  /** Canonical host: the part of `repo` before the first "/". */
  readonly host: string;
  /** Canonical `host/path`; equal to a list entry's `repo` when both name the same repository. */
  readonly repo: string;
  readonly op: GitGatewayOp;
}

export const GIT_GATEWAY_REFUSALS = [
  "method-not-allowed",
  "invalid-target",
  "target-too-long",
  "control-character",
  "backslash",
  "encoded-slash",
  "encoded-dot",
  "encoded-character",
  "invalid-character",
  "empty-segment",
  "dot-segment",
  "not-a-git-address",
  "missing-service",
  "unknown-service",
  "unexpected-query",
  "too-few-segments",
  "invalid-host",
  "invalid-git-suffix",
  "unsupported-path-form",
] as const;
export type GitGatewayRefusal = (typeof GIT_GATEWAY_REFUSALS)[number];

export type GitGatewayParse =
  | { readonly ok: true; readonly request: GitGatewayRequest }
  | { readonly ok: false; readonly reason: GitGatewayRefusal };

/** Gateway host name → the host used in list entries, e.g. `{ bb: "bitbucket.example.net" }`. */
export type GitGatewayHostMap = Readonly<Record<string, string>>;

const SERVICE_OPS: Readonly<Record<string, GitGatewayOp>> = {
  "git-upload-pack": "fetch",
  "git-receive-pack": "push",
};
const SERVICE_QUERY_PREFIX = "service=";
const SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function serviceOp(name: string | undefined): GitGatewayOp | undefined {
  return name !== undefined && Object.prototype.hasOwnProperty.call(SERVICE_OPS, name) ? SERVICE_OPS[name] : undefined;
}

/**
 * Read a request to the gateway. Only git's four smart-HTTP addresses are
 * understood, in the gateway's own address scheme:
 *
 *   GET  /<host>/<path…>[.git]/info/refs?service=git-upload-pack    fetch
 *   POST /<host>/<path…>[.git]/git-upload-pack                      fetch
 *   GET  /<host>/<path…>[.git]/info/refs?service=git-receive-pack   push
 *   POST /<host>/<path…>[.git]/git-receive-pack                     push
 *
 * `<path…>` is two or more segments, optionally after Bitbucket Server's
 * `scm/`. Host and path are case-insensitive; `info/refs`, the service names
 * and `.git` are not. Everything else is refused with one reason.
 *
 * `repo` is produced by normalizeRepoUrl, the function that produces list
 * entries. A request is accepted only when that function did nothing beyond
 * lower-casing, removing `.git`, removing a leading `scm/` and removing a
 * leading `ssh.`/`www.` from the host; the forms it would shorten further
 * (`projects/P/repos/R`, `…/tree/…` and the like) are web pages, not git
 * addresses, and are refused.
 *
 * `hostMap` renames the host segment before anything else (keys are matched
 * against the lower-cased segment). A host that is not a key is used as it is.
 *
 * Pass the request target exactly as it arrived (Node: `req.url`), not a
 * decoded or rewritten copy. Build the upstream address from the returned
 * `host` and `repo`, not from the request path: the returned values are what
 * the list was checked against.
 */
export function parseGitGatewayRequest(method: unknown, pathAndQuery: unknown, hostMap?: GitGatewayHostMap): GitGatewayParse {
  const refuse = (reason: GitGatewayRefusal): GitGatewayParse => ({ ok: false, reason });

  if (method !== "GET" && method !== "POST") return refuse("method-not-allowed");
  if (typeof pathAndQuery !== "string") return refuse("invalid-target");
  if (pathAndQuery.length > GIT_GATEWAY_MAX_TARGET_LENGTH) return refuse("target-too-long");
  if (!pathAndQuery.startsWith("/")) return refuse("invalid-target");
  if (CONTROL_RE.test(pathAndQuery)) return refuse("control-character");
  if (pathAndQuery.includes("\\")) return refuse("backslash");

  const queryStart = pathAndQuery.indexOf("?");
  const path = queryStart < 0 ? pathAndQuery : pathAndQuery.slice(0, queryStart);
  const query = queryStart < 0 ? undefined : pathAndQuery.slice(queryStart + 1);

  if (/%2f/i.test(path)) return refuse("encoded-slash");
  if (/%2e/i.test(path)) return refuse("encoded-dot");
  if (path.includes("%")) return refuse("encoded-character");

  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "")) return refuse("empty-segment");
  if (segments.some((segment) => segment === "." || segment === "..")) return refuse("dot-segment");
  if (segments.some((segment) => !SEGMENT_RE.test(segment))) return refuse("invalid-character");

  const last = segments[segments.length - 1];
  const endsWithInfoRefs = segments.length >= 2 && segments[segments.length - 2] === "info" && last === "refs";
  const rpcOp = serviceOp(last);

  let op: GitGatewayOp;
  let repoSegments: string[];
  if (method === "GET") {
    if (!endsWithInfoRefs) return refuse(rpcOp ? "method-not-allowed" : "not-a-git-address");
    if (query === undefined) return refuse("missing-service");
    if (!query.startsWith(SERVICE_QUERY_PREFIX) || query.includes("&")) return refuse("unexpected-query");
    const advertised = serviceOp(query.slice(SERVICE_QUERY_PREFIX.length));
    if (!advertised) return refuse("unknown-service");
    op = advertised;
    repoSegments = segments.slice(0, -2);
  } else {
    if (!rpcOp) return refuse(endsWithInfoRefs ? "method-not-allowed" : "not-a-git-address");
    if (query !== undefined) return refuse("unexpected-query");
    op = rpcOp;
    repoSegments = segments.slice(0, -1);
  }

  const [hostSegment, ...pathSegments] = repoSegments;
  const lastPathSegment = pathSegments[pathSegments.length - 1];
  if (hostSegment === undefined || lastPathSegment === undefined) return refuse("too-few-segments");

  let host = hostSegment.toLowerCase();
  if (hostMap && Object.prototype.hasOwnProperty.call(hostMap, host)) {
    const mapped: unknown = hostMap[host];
    if (typeof mapped !== "string" || !SEGMENT_RE.test(mapped)) return refuse("invalid-host");
    host = mapped.toLowerCase();
  }
  const hostProbe = normalizeRepoUrl(`${host}/x/y`);
  const canonicalHost = hostProbe?.endsWith("/x/y") ? hostProbe.slice(0, -"/x/y".length) : undefined;
  if (canonicalHost === undefined || !isCanonicalGitScopeHost(canonicalHost)) return refuse("invalid-host");
  // Cannot fail with today's normalizeRepoUrl; it keeps the promise above if that function ever does more to a host.
  if (host !== canonicalHost && host !== `ssh.${canonicalHost}` && host !== `www.${canonicalHost}`) return refuse("invalid-host");

  // Exactly ".git", or no suffix: ".GIT" would be a second spelling of the same repository.
  const hasGitSuffix = lastPathSegment.endsWith(".git");
  if (!hasGitSuffix && /\.git$/i.test(lastPathSegment)) return refuse("invalid-git-suffix");
  if (lastPathSegment === ".git") return refuse("invalid-git-suffix");

  const expectedSegments = pathSegments.map((segment) => segment.toLowerCase());
  if (hasGitSuffix) expectedSegments[expectedSegments.length - 1] = lastPathSegment.slice(0, -".git".length).toLowerCase();
  if (expectedSegments[0] === "scm") expectedSegments.shift();
  if (expectedSegments.length < 2) return refuse("too-few-segments");

  const repo = normalizeRepoUrl(`${host}/${pathSegments.join("/")}`);
  if (repo === null || repo !== `${canonicalHost}/${expectedSegments.join("/")}` || !isCanonicalGitScopeRepo(repo)) {
    return refuse("unsupported-path-form");
  }
  return { ok: true, request: { host: canonicalHost, repo, op } };
}

export type GitRequestRefusal = "repo-not-on-list" | "fetch-only";

export type GitRequestDecision =
  | { readonly allowed: true; readonly access: GitScopeAccess }
  | { readonly allowed: false; readonly reason: GitRequestRefusal };

/**
 * May this sandbox make this request? Fetch needs the repository on the list
 * ("r" or "rw"); push needs it there with "rw".
 *
 * `scope` must be the payload verifyGitScope returned. This function does not
 * look at the clock: verify again (or compare `exp`) before reusing a scope.
 */
export function decideGitRequest(scope: VerifiedGitScope, request: GitGatewayRequest): GitRequestDecision {
  if (request.op !== "fetch" && request.op !== "push") {
    throw new TypeError("decideGitRequest: request.op must be \"fetch\" or \"push\"");
  }
  const entry = scope.repos.find((candidate) => candidate.repo === request.repo);
  if (!entry) return { allowed: false, reason: "repo-not-on-list" };
  if (entry.access === "rw") return { allowed: true, access: "rw" };
  if (entry.access === "r" && request.op === "fetch") return { allowed: true, access: "r" };
  return { allowed: false, reason: "fetch-only" };
}
