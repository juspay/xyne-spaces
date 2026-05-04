import type { AgentAuditEvent } from "@prisma/client";
import { auditLogRepository } from "../repositories/index.js";

interface AuditLogEntry {
  actorUserId?: string;
  eventType: AgentAuditEvent;
  targetId: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an entry to the AgentAuditLog table.
 * Never throws — errors are logged but not propagated to callers.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await auditLogRepository.create(entry);
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}
