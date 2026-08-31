/**
 * Live watch for the injection path — answers "is a live update actually
 * reaching my running agent, and if not, which step dropped it?"
 *
 * Injection has five sequential preconditions and failing any one of them looks
 * identical from the channel (the agent just never mentions your new message).
 * This prints each one as it happens, so the first line that never appears is
 * the answer.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/awakening-injection-watch.ts [agent-slug]
 *
 * Then post messages in a watched channel while a reflex run is in flight.
 * Ctrl-C to stop.
 */

import { prisma } from "../src/db.js";
import { redisService } from "../src/redis.js";
import { readAgentLock } from "../src/awakening/lock.js";
import { readInjectionStats } from "../src/awakening/inbox.js";
import { resolveAwakeningConfig } from "../src/awakening/config.js";
import { TICK_INTERVAL_MS } from "../src/queue/awakening-queue.js";

const slug = process.argv[2] ?? "ask-ai";
const POLL_MS = 1000;

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function say(icon: string, msg: string): void {
  console.log(`${stamp()}  ${icon} ${msg}`);
}

async function main(): Promise<void> {
  const agent = await prisma.agent.findFirst({ where: { slug }, select: { id: true, slug: true, config: true } });
  if (!agent) {
    console.error(`No agent "${slug}"`);
    process.exit(1);
  }

  const cfg = resolveAwakeningConfig(agent.config);
  const effectiveCheckMs = Math.max(cfg.reflex.checkIntervalMs, TICK_INTERVAL_MS);

  console.log(`\nAgent: ${agent.slug} (${agent.id})`);
  console.log(`  injectEnabled ......... ${cfg.reflex.injectEnabled}`);
  console.log(`  injectThreshold ....... ${cfg.reflex.injectThreshold} new event(s)`);
  console.log(`  maxInjectionsPerSession ${cfg.reflex.maxInjectionsPerSession}`);
  console.log(`  injectMinIntervalMs ... ${cfg.reflex.injectMinIntervalMs}`);
  console.log(`  replicaSafetyMs ....... ${cfg.cursor.replicaSafetyMs}`);
  console.log(`  checkIntervalMs ....... ${cfg.reflex.checkIntervalMs}`);
  console.log(`  AWAKENING_TICK_MS ..... ${TICK_INTERVAL_MS}`);

  if (cfg.reflex.checkIntervalMs < TICK_INTERVAL_MS) {
    console.log(
      `\n  ! checkIntervalMs (${cfg.reflex.checkIntervalMs}ms) is below the tick interval ` +
      `(${TICK_INTERVAL_MS}ms).\n` +
      `    Reflex checks are CLAIMED by the tick, so the effective cadence is ` +
      `${effectiveCheckMs}ms.\n` +
      `    Set AWAKENING_TICK_MS=${cfg.reflex.checkIntervalMs} to honour it.`,
    );
  }

  console.log(
    `\n  → A run must stay alive ~${Math.round((cfg.cursor.replicaSafetyMs + effectiveCheckMs) / 1000)}s ` +
    `past your message for an injection to be possible.\n`,
  );
  console.log("Watching. Post messages in a watched channel while a run is in flight.\n");

  const redis = redisService.getConnection();
  let lastSession: string | null = null;
  let lastDepth = -1;
  let lastUsed = -1;

  for (;;) {
    const holder = await readAgentLock(agent.id).catch(() => null);
    const session = holder?.sessionId ?? null;

    if (session !== lastSession) {
      if (session) say("▶", `run STARTED  session=${session} kind=${holder?.kind}`);
      else if (lastSession) say("■", `run ENDED    session=${lastSession}`);
      lastSession = session;
      lastDepth = -1;
      lastUsed = -1;
    }

    if (session) {
      const depth = await redis.llen(`claw:awk:inbox:${session}`).catch(() => -1);
      const stats = await readInjectionStats(session).catch(() => ({ used: 0, lastAtMs: 0 }));

      if (lastUsed >= 0 && stats.used > lastUsed) {
        say("↓", `QUEUED batch #${stats.used} — claw-auth decided to inject`);
      }
      if (lastDepth > 0 && depth === 0) {
        say("↑", `DRAINED — the claw pod pulled it; the model sees it at its next turn boundary`);
      }
      if (depth > 0 && depth !== lastDepth) {
        say("·", `inbox depth=${depth} (waiting for the run to hit a tool call)`);
      }
      lastDepth = depth;
      lastUsed = stats.used;
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
