/**
 * Keeps agent_awakening_state in sync with agent.config.awakening.
 *
 * Called on every agent config write. The state row is scheduler-owned data
 * derived from config, so it must be created the moment awakening is switched
 * on and parked the moment it is switched off — otherwise the tick either
 * never sees the agent, or keeps waking one that was disabled.
 *
 * First-enable seeding matters more than it looks:
 *
 *   watermarkAt starts at NOW, not at zero. A new awakened agent must not
 *   wake up and immediately ingest the channel's entire history — it would
 *   blow the event cap, produce a useless artifact, and quite possibly reply
 *   to a months-old thread.
 *
 *   nextDueAt is spread by a deterministic per-agent jitter, so enabling
 *   awakening across a fleet does not line every agent up on the same tick.
 */

import { prisma } from "../db.js";
import { resolveAwakeningConfig } from "./config.js";
import { deterministicJitter } from "./cursor.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-lifecycle");

export async function syncAwakeningState(
  agentId: string,
  orgId: string,
  agentConfig: unknown,
): Promise<void> {
  const config = resolveAwakeningConfig(agentConfig);
  const existing = await prisma.agentAwakeningState.findUnique({ where: { agentId } });

  if (!config.enabled) {
    if (existing?.enabled) {
      await prisma.agentAwakeningState.update({
        where: { agentId },
        data: { enabled: false, lastError: null },
      });
      log.info(`[awakening] disabled agent=${agentId}`);
    }
    return;
  }

  const now = Date.now();
  if (!existing) {
    await prisma.agentAwakeningState.create({
      data: {
        agentId,
        orgId,
        enabled: true,
        // Spread the first beat across the period so a bulk enable does not stampede.
        nextDueAt: new Date(now + deterministicJitter(agentId, config.periodMs)),
        watermarkAt: new Date(now),
      },
    });
    log.info(`[awakening] enabled agent=${agentId} period=${config.periodMs}ms`);
    return;
  }

  if (!existing.enabled) {
    // Re-enabling after a pause: reset the watermark to now rather than
    // replaying everything that happened while the agent was off.
    await prisma.agentAwakeningState.update({
      where: { agentId },
      data: {
        enabled: true,
        orgId,
        watermarkAt: new Date(now),
        nextDueAt: new Date(now + deterministicJitter(agentId, config.periodMs)),
        consecutiveFailures: 0,
        consecutiveSkips: 0,
        lastError: null,
      },
    });
    log.info(`[awakening] re-enabled agent=${agentId}`);
  }
}
