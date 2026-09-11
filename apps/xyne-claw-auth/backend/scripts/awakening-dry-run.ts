/**
 * End-to-end dry run of the awakening window pipeline against real data,
 * WITHOUT dispatching a run.
 *
 * Exercises the genuine code path — channel resolution, the windowed Spaces
 * pull, signal extraction, the triage gate and the renderer — then prints the
 * artifact the agent would have received and the gate's verdict.
 *
 * This is the loop to use when tuning gate rules or the artifact layout: it
 * costs one set of Spaces queries and zero LLM tokens.
 *
 * Usage:
 *   pnpm --filter xyne-claw-auth exec tsx --env-file=.env \
 *     scripts/awakening-dry-run.ts <agent-slug> [windowMinutes]
 */

import { prisma } from "../src/db.js";
import { redisService } from "../src/redis.js";
import { resolveAwakeningConfig, AWAKENING_DEFAULTS, type AwakeningConfig } from "../src/awakening/config.js";
import { resolveAwakeningChannels } from "../src/awakening/channel-resolver.js";
import { collectWindow } from "../src/awakening/collector.js";
import { computeSignals } from "../src/awakening/signals.js";
import { evaluateGate } from "../src/awakening/gate.js";
import { renderWindow } from "../src/awakening/render.js";
import { loadOverlappingRuns, markCoverage } from "../src/awakening/prior-runs.js";
import { resolveAgentIdentity } from "../src/awakening/dispatch.js";
import { resolveWorkspaceId } from "../src/awakening/workspace.js";
import type { AwakeningWindow } from "../src/awakening/types.js";

const slug = process.argv[2];
const windowMinutes = Number(process.argv[3] ?? 30);

if (!slug) {
  console.error("usage: awakening-dry-run.ts <agent-slug> [windowMinutes]");
  process.exit(2);
}

async function main(): Promise<void> {
  const agent = await prisma.agent.findFirst({
    where: { slug },
    select: {
      id: true, slug: true, orgId: true, config: true,
      spacesAppId: true, spacesAppUserId: true, spacesAppToken: true,
    },
  });
  if (!agent) throw new Error(`no agent with slug "${slug}"`);

  // Fall back to permissive defaults so a dry run works on an agent that has
  // never had awakening enabled — the point is to preview what it WOULD see.
  const stored = resolveAwakeningConfig(agent.config);
  const config: AwakeningConfig = stored.enabled
    ? stored
    : { ...AWAKENING_DEFAULTS, ...stored, enabled: true };

  const workspaceId = await resolveWorkspaceId(agent.orgId, config.workspaceId);
  const identity = resolveAgentIdentity(agent, workspaceId);

  const endMs = Date.now() - config.cursor.replicaSafetyMs;
  const startMs = endMs - windowMinutes * 60_000;

  console.log(`agent=${agent.slug} workspace=${workspaceId} bot=${identity.spacesAppUserId}`);
  console.log(`window=${new Date(startMs).toISOString()} -> ${new Date(endMs).toISOString()}\n`);

  const resolved = await resolveAwakeningChannels(agent.id, config.channels, identity, config.periodMs);
  console.log(`channels resolved: ${resolved.channels.length}${resolved.truncated ? " (truncated)" : ""}`);
  for (const c of resolved.channels) console.log(`  - ${c.name} (${c.id})`);
  if (resolved.channels.length === 0) {
    console.log("\nno channels matched — the agent would skip with reason=no_channels");
    return;
  }

  const collected = await collectWindow(resolved.channels, startMs, endMs, identity, config);
  // Requirement 7: what did earlier awakened runs in this window already do?
  const priorRuns = await loadOverlappingRuns(agent.id, startMs, endMs);
  markCoverage(collected.events, priorRuns);
  const signals = computeSignals(collected.events);
  const gate = evaluateGate({ signals, config, consecutiveSkips: 0 });

  console.log(`\ncollected ${collected.events.length} event(s)${collected.truncated ? " (TRUNCATED)" : ""}`);
  if (priorRuns.length > 0) {
    const uncovered = collected.events.filter((e) => !e.covered).length;
    console.log(
      `prior runs overlapping this window: ${priorRuns.length} (${priorRuns.filter((p) => p.covers).length} acted) — ${uncovered} event(s) not already handled`,
    );
  }
  console.log(`gate: ${gate.decision.toUpperCase()} (rule=${gate.rule})\n`);
  console.log(JSON.stringify(signals, null, 2));

  const window: AwakeningWindow = {
    agentId: agent.id,
    agentSlug: agent.slug,
    orgId: agent.orgId,
    kind: "heartbeat",
    startMs,
    endMs,
    channels: resolved.channels.filter((c) => collected.activeChannels.has(c.id)),
    silentChannels: resolved.channels.filter((c) => !collected.activeChannels.has(c.id)),
    events: collected.events,
    signals,
    truncated: collected.truncated,
    gap: null,
    priorRuns,
    config,
  };

  const rendered = renderWindow(window);
  for (const file of rendered.files) {
    console.log(`\n${"=".repeat(72)}\n${file.path}\n${"=".repeat(72)}`);
    console.log(file.content);
  }
}

main()
  .catch((err) => {
    console.error(`\ndry run failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Both clients hold the event loop open; without this the script never exits.
    await prisma.$disconnect().catch(() => {});
    await redisService.disconnect().catch(() => {});
  });
