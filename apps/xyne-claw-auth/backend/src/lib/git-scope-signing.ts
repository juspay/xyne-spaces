/**
 * claw-auth as the git-scope signer: one signed repo list per sandbox claim
 * (format: xyne-claw-shared/git-scope). The runtime asks once, when it creates a
 * claim for a profile; the git-gateway verifies with this key's public half.
 *
 * Which profiles a run may have signed is the same set the runtime offers it today:
 * built-ins plus the run's workspace's own (loadEffectiveRepoConfigs). The workspace
 * comes from claw-auth's own records for the session token's user, never from the
 * request body.
 *
 * No memory: claw-auth keeps no record of what it signed, so it signs again for
 * any request that passes these rules (the same claim twice, or a claim the
 * runtime never creates). Every list it signs is still one the run could use.
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import {
  GitScopeError,
  gitScopeReposForProfile,
  isSameTemplateFamily,
  signGitScope,
  type RepoConfigMap,
} from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { SANDBOX_REPO_KEY_PATTERN } from "./sandbox-repo-configs.js";
import { getWorkspaceIdForUser } from "./spaces-db.js";


export interface GitScopeSignRequest {
  profile: string;
  claimName: string;
  namespace: string;
  template: string;
  /** Unix seconds: the claim's shutdownTime. */
  endTime: number;
}

const BODY_KEYS = ["profile", "claimName", "namespace", "template", "endTime"] as const;
// Kubernetes object names: DNS-1123 subdomain (claims, templates) and label (namespaces).
const DNS_LABEL = "[a-z0-9](?:[-a-z0-9]*[a-z0-9])?";
const DNS_SUBDOMAIN_RE = new RegExp(`^${DNS_LABEL}(?:\\.${DNS_LABEL})*$`);
const DNS_LABEL_RE = new RegExp(`^${DNS_LABEL}$`);

const isSubdomain = (v: unknown): v is string => typeof v === "string" && v.length <= 253 && DNS_SUBDOMAIN_RE.test(v);
const isLabel = (v: unknown): v is string => typeof v === "string" && v.length <= 63 && DNS_LABEL_RE.test(v);

export type GitScopeParse = { ok: true; request: GitScopeSignRequest } | { ok: false; error: string };

/** Exactly the five members, each strictly typed. `now` in unix seconds. */
export function parseGitScopeRequest(body: unknown, now: number): GitScopeParse {
  const bad = (error: string): GitScopeParse => ({ ok: false, error });
  if (body === null || typeof body !== "object" || Array.isArray(body)) return bad("body must be a JSON object");
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== BODY_KEYS.length || !BODY_KEYS.every((k) => Object.hasOwn(record, k))) {
    return bad(`body must have exactly the members ${BODY_KEYS.join(", ")}`);
  }
  const { profile, claimName, namespace, template, endTime } = record;
  if (typeof profile !== "string" || !SANDBOX_REPO_KEY_PATTERN.test(profile)) return bad("profile is not a profile key");
  if (!isSubdomain(claimName)) return bad("claimName is not a Kubernetes object name");
  if (!isLabel(namespace)) return bad("namespace is not a Kubernetes namespace name");
  if (!isSubdomain(template)) return bad("template is not a Kubernetes object name");
  if (typeof endTime !== "number" || !Number.isSafeInteger(endTime)) return bad("endTime must be whole unix seconds");
  if (endTime <= now) return bad("endTime must be in the future");
  return { ok: true, request: { profile, claimName, namespace, template, endTime } };
}

export interface GitScopeSigningKey {
  privateKeyPem: string;
  kid: string;
}

let keyCache: { pem: string; key: KeyObject | null } | null = null;

/** The configured key when both it and its kid are set and it is an EC P-256 private key; else null. */
export function gitScopeSigningKey(): GitScopeSigningKey | null {
  const pem = CONFIG.clawGitScopePrivateKey ?? "";
  const kid = CONFIG.clawGitScopeKeyId ?? "";
  if (!pem || !kid || kid.length > 256) return null;
  if (!keyCache || keyCache.pem !== pem) {
    let key: KeyObject | null = null;
    try {
      const parsed = createPrivateKey(pem);
      if (parsed.asymmetricKeyType === "ec" && parsed.asymmetricKeyDetails?.namedCurve === "prime256v1") key = parsed;
    } catch {
      key = null;
    }
    keyCache = { pem, key };
  }
  return keyCache.key ? { privateKeyPem: pem, kid } : null;
}

/** What claw-auth's records say about the run. */
export interface GitScopeRunScope {
  workspaceId: string | null;
}

export interface GitScopeSession {
  userId: string;
  agentSlug?: string | undefined;
  spacesAppId?: string | undefined;
}

/**
 * The run's workspace, from the session token's user, looked up the way start-run sets
 * agentConfig.workspaceId, so the signer and the runtime see the same profiles.
 */
export async function resolveGitScopeRunScope(session: GitScopeSession): Promise<GitScopeRunScope> {
  const workspaceId = await getWorkspaceIdForUser(session.userId, "git-scope").catch(() => null);
  return { workspaceId };
}

export type GitScopeDecision =
  | { ok: true; token: string; repoCount: number }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string };

/**
 * Sign or refuse. `configs` must be the run workspace's effective profiles
 * (loadEffectiveRepoConfigs(workspaceId)): built-ins plus that workspace's own,
 * without disabled ones. A key missing there is refused, "sbx-git" included.
 */
export function decideGitScope(input: {
  request: GitScopeSignRequest;
  run: GitScopeRunScope;
  configs: RepoConfigMap;
  key: GitScopeSigningKey;
  now: number;
}): GitScopeDecision {
  const { request, configs, key, now } = input;
  const config = Object.hasOwn(configs, request.profile) ? configs[request.profile] : undefined;
  if (!config) return { ok: false, status: 404, error: `sandbox profile "${request.profile}" is unknown or disabled` };
  if (!isSameTemplateFamily(request.template, config.template)) {
    return { ok: false, status: 400, error: `template is not the template of profile "${request.profile}"` };
  }
  let repos: string[];
  try {
    repos = gitScopeReposForProfile({ ...config, slug: request.profile });
  } catch (err) {
    if (err instanceof GitScopeError) return { ok: false, status: 500, error: err.message };
    throw err;
  }
  const token = signGitScope(
    {
      v: 1,
      claim: request.claimName,
      ns: request.namespace,
      tpl: request.template,
      profile: request.profile,
      iat: now,
      exp: request.endTime,
      // Every repo read-write for now; the gateway decides public vs private.
      repos: repos.map((repo) => ({ repo, access: "rw" as const })),
    },
    key.privateKeyPem,
    key.kid,
  );
  return { ok: true, token, repoCount: repos.length };
}
