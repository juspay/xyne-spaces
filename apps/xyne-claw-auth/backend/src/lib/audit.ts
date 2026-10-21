import type { AgentAuditEvent } from "@prisma/client";
import { prisma } from "../db.js";
// The repository file, not the barrel: agentRepository's config audit calls this, and the barrel imports agentRepository.
import { auditLogRepository } from "../repositories/auditLogRepository.js";
import { queueGovernanceEvent } from "./governance-audit.js";

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

const orgByActor = new Map<string, { orgId: string; until: number }>();
let platformOrgId: string | undefined;

// The actor's org, else the target agent's, else the platform org (the seed's first org): every mirrored row needs one.
async function resolveOrgId(entry: AuditLogEntry): Promise<string | undefined> {
  if (entry.orgId) return entry.orgId;
  if (entry.actorUserId) {
    const hit = orgByActor.get(entry.actorUserId);
    if (hit && hit.until > Date.now()) return hit.orgId;
    const user = await prisma.user.findUnique({ where: { id: entry.actorUserId }, select: { orgId: true } });
    if (user?.orgId) {
      if (orgByActor.size > 10_000) orgByActor.clear();
      orgByActor.set(entry.actorUserId, { orgId: user.orgId, until: Date.now() + 300_000 });
      return user.orgId;
    }
  }
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
    queueGovernanceEvent({
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
