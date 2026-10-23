import type { AgentAuditEvent } from "@prisma/client";
import { prisma } from "../db.js";
// The repository file, not the barrel: agentRepository's config audit calls this, and the barrel imports agentRepository.
import { auditLogRepository } from "../repositories/auditLogRepository.js";
import { governance } from "./governance-hooks.js";

import { createLogger } from "../logger.js";
const log = createLogger("audit");

export interface AuditLogEntry {
  actorUserId?: string | undefined;
  orgId?: string | undefined;
  eventType: AgentAuditEvent;
  targetId: string;
  description: string;
  metadata?: Record<string, unknown> | undefined;
}

let platformOrgId: string | undefined;

const orgByActor = new Map<string, { orgId: string | undefined; until: number }>();

/** A user's org, cached for five minutes (a miss for one minute): the gate asks on every approval. */
export async function orgIdForUser(userId: string): Promise<string | undefined> {
  const hit = orgByActor.get(userId);
  if (hit && hit.until > Date.now()) return hit.orgId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  const orgId = user?.orgId || undefined;
  if (orgByActor.size > 10_000) orgByActor.clear();
  orgByActor.set(userId, { orgId, until: Date.now() + (orgId ? 300_000 : 60_000) });
  return orgId;
}

// The actor's org, else the target agent's, else the platform org (the seed's first org): every mirrored row needs one.
async function resolveOrgId(entry: AuditLogEntry): Promise<string | undefined> {
  if (entry.orgId) return entry.orgId;
  const actorOrg = entry.actorUserId ? await orgIdForUser(entry.actorUserId) : undefined;
  if (actorOrg) return actorOrg;
  const agent = await prisma.agent.findUnique({ where: { id: entry.targetId }, select: { orgId: true } });
  if (agent) return agent.orgId;
  platformOrgId ??= (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  return platformOrgId;
}

/**
 * Write an entry to the AgentAuditLog table and mirror it into the governance audit stream.
 * Never throws — errors are logged but not propagated to callers.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const orgId = await resolveOrgId(entry);
    await auditLogRepository.create({ ...entry, orgId });
    if (!orgId) return;
    governance.queueGovernanceEvent({
      orgId,
      eventType: "config_changed",
      actorKind: entry.actorUserId ? "user" : "system",
      actorId: entry.actorUserId ?? null,
      subjectKind: entry.eventType,
      subjectId: entry.targetId,
      reasonText: entry.description,
      decision: "allow",
    });
  } catch (err) {
    log.error("[audit] Failed to write audit log:", err);
  }
}
