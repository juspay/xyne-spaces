/**
 * The artifact-app tools' one way into claw-auth: its user-facing
 * `/artifact-apps` routes, called AS the run's user.
 *
 * S2S key + `x-user-id` is the contract `requireAuth` honours for internal
 * callers acting on someone's behalf, so these calls go through exactly the ACL
 * the dashboard does — no parallel permission logic to drift:
 *  - read: the owner gets HEAD; anyone else in the workspace gets the
 *    published pin, and only if the app is published;
 *  - write (update, publish): owner only.
 *
 * `x-user-id` comes from run meta, which claw-auth stamps at dispatch — the
 * model never supplies it, so it cannot read or edit as someone else.
 */

import type { ToolExecutionContext } from "../types.js";
import type { ReactArtifactPayload } from "./tools.js";

const APP_API_TIMEOUT_MS = 15_000;

/** What `GET /artifact-apps/:id` returns, narrowed to what the tools use. */
export interface AgentAppDetail {
  id: string;
  title: string;
  visibility: "PRIVATE" | "WORKSPACE";
  isOwner: boolean;
  headVersionId: string | null;
  publishedVersionId: string | null;
  ownerName?: string | null;
  versions: Array<{ id: string; versionNumber: number }>;
}

export interface AgentApp {
  detail: AgentAppDetail;
  payload: ReactArtifactPayload;
  /** The version the payload is — HEAD for the owner, the pin for anyone else. */
  versionNumber: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Ids are cuids (legacy) or uuids (minted by create-app). Rejecting anything
 *  else keeps a hallucinated id out of the URL path. */
const APP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function parseAppId(raw: unknown): string | null {
  const id = typeof raw === "string" ? raw.trim() : "";
  return APP_ID_RE.test(id) ? id : null;
}

function baseUrl(context?: ToolExecutionContext): string {
  const authUrl = context?.config?.["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003";
  return `${authUrl}/claw/api/v1/artifact-apps`;
}

function headersFor(context: ToolExecutionContext | undefined, userId: string): Record<string, string> {
  const s2sKey = context?.config?.["XYNE_CLAW_S2S_KEY"] ?? "";
  return {
    ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
    "x-user-id": userId,
  };
}

function runUserId(context?: ToolExecutionContext): string | null {
  const id = context?.meta?.["userId"]?.trim();
  return id ? id : null;
}

async function call(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; res: Response } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(APP_API_TIMEOUT_MS) });
    return { ok: true, res };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `could not reach the app service (${message})` };
  }
}

/** One wording for "you may not see this", whether the app is missing, archived
 *  or someone else's unpublished draft — the route already conflates them. */
function notFound(appId: string): string {
  return `no app "${appId}" that you can access. Ask the user to attach the app, or check the id.`;
}

/** `GET /:id` — metadata plus the version list (every version for the owner,
 *  only the pin for anyone else). */
async function loadDetail(
  base: string,
  headers: Record<string, string>,
  appId: string,
): Promise<Result<AgentAppDetail>> {
  const meta = await call(base, { headers });
  if (!meta.ok) return meta;
  if (meta.res.status === 404 || meta.res.status === 403) return { ok: false, error: notFound(appId) };
  if (!meta.res.ok) return { ok: false, error: `could not load the app (HTTP ${meta.res.status}).` };

  try {
    const body = (await meta.res.json()) as {
      app?: Omit<AgentAppDetail, "versions">;
      versions?: AgentAppDetail["versions"];
    };
    if (!body.app) return { ok: false, error: "the app came back unreadable." };
    return { ok: true, value: { ...body.app, versions: body.versions ?? [] } };
  } catch {
    return { ok: false, error: "the app came back unreadable." };
  }
}

/** Read an app's metadata and the payload this user is entitled to. */
export async function loadAppForUser(
  appId: string,
  context?: ToolExecutionContext,
): Promise<Result<AgentApp>> {
  const userId = runUserId(context);
  if (!userId) return { ok: false, error: "this run has no user, so it cannot open apps." };

  const headers = headersFor(context, userId);
  const base = `${baseUrl(context)}/${encodeURIComponent(appId)}`;

  const meta = await loadDetail(base, headers, appId);
  if (!meta.ok) return meta;
  const detail = meta.value;

  // Let the route pick the version: head for the owner, the pin for everyone
  // else. Asking for a specific one would only be honoured for the owner anyway.
  const data = await call(`${base}/payload`, { headers });
  if (!data.ok) return data;
  if (data.res.status === 404 || data.res.status === 403) return { ok: false, error: notFound(appId) };
  if (!data.res.ok) return { ok: false, error: `could not load the app (HTTP ${data.res.status}).` };

  let payload: ReactArtifactPayload;
  try {
    payload = (await data.res.json()) as ReactArtifactPayload;
  } catch {
    return { ok: false, error: "the app came back unreadable." };
  }
  if (!payload || !Array.isArray(payload.files)) {
    return { ok: false, error: "the app has no readable files." };
  }

  const servedId = detail.isOwner
    ? (detail.headVersionId ?? detail.publishedVersionId)
    : detail.publishedVersionId;
  const served = detail.versions.find((v) => v.id === servedId) ?? detail.versions[0];

  return { ok: true, value: { detail, payload, versionNumber: served?.versionNumber ?? 0 } };
}

/** Publish the owner's current HEAD to the workspace. */
export async function publishAppHead(
  appId: string,
  context?: ToolExecutionContext,
): Promise<Result<{ title: string; versionNumber: number }>> {
  const userId = runUserId(context);
  if (!userId) return { ok: false, error: "this run has no user, so it cannot publish apps." };

  const headers = headersFor(context, userId);
  const base = `${baseUrl(context)}/${encodeURIComponent(appId)}`;

  const meta = await loadDetail(base, headers, appId);
  if (!meta.ok) return meta;
  const detail = meta.value;

  if (!detail.isOwner) {
    return { ok: false, error: `"${detail.title}" belongs to someone else — only its owner can publish it.` };
  }

  // Head is what the owner is looking at; apps from before head tracking fall
  // back to their newest version (the list arrives newest first).
  const target = detail.versions.find((v) => v.id === detail.headVersionId) ?? detail.versions[0];
  if (!target) return { ok: false, error: `"${detail.title}" has no versions to publish.` };

  const res = await call(`${base}/publish`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ versionId: target.id }),
  });
  if (!res.ok) return res;
  if (res.res.status === 403) {
    return { ok: false, error: `"${detail.title}" belongs to someone else — only its owner can publish it.` };
  }
  if (res.res.status === 404) return { ok: false, error: notFound(appId) };
  if (!res.res.ok) return { ok: false, error: `could not publish the app (HTTP ${res.res.status}).` };

  return { ok: true, value: { title: detail.title, versionNumber: target.versionNumber } };
}
