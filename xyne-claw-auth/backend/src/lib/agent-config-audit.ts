/**
 * Audit agent `config.tools` changes at the data-access choke point.
 *
 * Why here and not in the route: a "ghost" mutation hunt (2026-06-17) found
 * agent.config.tools changing with no trail. Route-level audit can't see writes
 * from seed/bootstrap/workers/one-off scripts. agentRepository.update is the
 * single funnel every config write passes through, so the diff+log lives here.
 *
 * We log ONLY when the tools selection actually changes (subagents/direct/
 * custom arrays), so the high-frequency writes that don't touch tools (memory
 * status, spacesAppId, scope flips, prompt denorm) don't spam the audit table.
 *
 * Imports prisma directly (not lib/audit.ts → repositories/index) to avoid an
 * import cycle: agentRepository → this → repositories/index → agentRepository.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getAuditActor } from "./audit-context.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-config-audit");

type ToolsConfig = { subagents?: string[]; direct?: string[]; custom?: string[] };

function readTools(config: unknown): ToolsConfig {
  const tools = (config as { tools?: ToolsConfig } | null | undefined)?.tools;
  return {
    subagents: Array.isArray(tools?.subagents) ? tools!.subagents : [],
    direct: Array.isArray(tools?.direct) ? tools!.direct : [],
    custom: Array.isArray(tools?.custom) ? tools!.custom : [],
  };
}

function diff(before: string[] = [], after: string[] = []): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((x) => !b.has(x)),
    removed: before.filter((x) => !a.has(x)),
  };
}

/**
 * Compare the tools selection before/after a config write and, if it changed,
 * write an AGENT_CONFIG_UPDATED audit row. Never throws — auditing must not
 * break the write it observes.
 *
 * @param data the update payload — we only act when it actually sets `config`.
 */
export async function auditAgentConfigChange(
  agentId: string,
  beforeConfig: unknown,
  data: Prisma.AgentUpdateInput,
): Promise<void> {
  try {
    // Only a `config` write can change tools. Anything else is irrelevant.
    if (!("config" in data) || data.config === undefined) return;

    const before = readTools(beforeConfig);
    const after = readTools(data.config as unknown);

    const d = {
      subagents: diff(before.subagents, after.subagents),
      direct: diff(before.direct, after.direct),
      custom: diff(before.custom, after.custom),
    };

    const changed =
      d.subagents.added.length || d.subagents.removed.length ||
      d.direct.added.length || d.direct.removed.length ||
      d.custom.added.length || d.custom.removed.length;
    if (!changed) return;

    const actorUserId = getAuditActor();
    const counts = (k: "subagents" | "direct" | "custom") => `${k} +${d[k].added.length}/-${d[k].removed.length}`;
    const description =
      `tools changed (${counts("subagents")}, ${counts("direct")}, ${counts("custom")})` +
      (actorUserId ? "" : " [no actor — non-HTTP/system write]");

    await prisma.agentAuditLog.create({
      data: {
        actorUserId: actorUserId ?? null,
        eventType: "AGENT_CONFIG_UPDATED",
        targetId: agentId,
        description,
        metadata: {
          diff: d,
          beforeCounts: {
            subagents: before.subagents?.length ?? 0,
            direct: before.direct?.length ?? 0,
            custom: before.custom?.length ?? 0,
          },
          afterCounts: {
            subagents: after.subagents?.length ?? 0,
            direct: after.direct?.length ?? 0,
            custom: after.custom?.length ?? 0,
          },
        } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    log.error("[agent-config-audit] failed to write audit:", err);
  }
}
