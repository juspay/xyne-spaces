/**
 * Shared request resolution for the Slack surface's agent-scoped endpoints.
 *
 * Every /agents/:slug/* route answers the same three questions before doing any
 * work: who is calling, which agent are they naming, and may they touch it.
 * Resolving that here keeps the handlers to routing + their own work, and —
 * more importantly — keeps the enumeration guard below in ONE place.
 */
import type { Request } from "express";
import { getOrgId, getRequesterId, isClawAdmin, isOrgAdmin } from "../../../middleware/agent-acl.js";
import { findOrgAgentBySlug } from "../store.js";
import { objectPayload } from "./shared.js";

export interface ResolvedSlackAgent {
  userId: string;
  agent: { id: string; slug: string; name: string; orgId: string };
}

export type SlackAgentResolution =
  | ({ ok: true } & ResolvedSlackAgent)
  | { ok: false; status: number; error: string };

export async function resolveSlackAgentRequest(req: Request): Promise<SlackAgentResolution> {
  const userId = getRequesterId(req);
  const sessionOrgId = getOrgId(req);
  if (!userId || !sessionOrgId) {
    return { ok: false, status: 401, error: "Authenticated organization session required" };
  }

  // orgId rides the body on POST and the query string on DELETE; either way it
  // falls back to the session's org.
  const body = objectPayload(req.body);
  const fromBody = typeof body?.["orgId"] === "string" ? body["orgId"].trim() : "";
  const fromQuery = typeof req.query["orgId"] === "string" ? req.query["orgId"].trim() : "";
  const requestedOrgId = fromBody || fromQuery || sessionOrgId;

  const slug = typeof req.params["slug"] === "string" ? req.params["slug"] : "";
  const agent = await findOrgAgentBySlug(slug, requestedOrgId);

  // SECURITY: both the missing-agent and the not-authorised branch answer 404
  // with the SAME message. A 403 here would confirm that an agent exists in an
  // org the caller cannot see, letting anyone enumerate another org's agents by
  // guessing slugs. Do not "correct" this to 403.
  if (!agent) return { ok: false, status: 404, error: "Agent not found" };

  const platformAdmin = await isClawAdmin(userId);
  if (!platformAdmin && (sessionOrgId !== agent.orgId || !(await isOrgAdmin(userId, agent.orgId)))) {
    return { ok: false, status: 404, error: "Agent not found" };
  }

  return { ok: true, userId, agent };
}
