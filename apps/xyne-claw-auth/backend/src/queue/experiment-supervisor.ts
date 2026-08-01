import { experimentRepository, agentRunRepository, agentRepository } from "../repositories/index.js";
import { dispatchExperimentEpoch } from "../lib/experiment.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { decryptStoredField } from "../surfaces/spaces/client.js";
import { createLogger } from "../logger.js";

const log = createLogger("experiment-supervisor");

const INTERVAL_MS = 60_000;
const STALE_MS = 10 * 60_000;
const FORCE_DONE_AFTER_MS = 15 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function postNotice(run: { channelId: string; conversationId: string; agentSlug: string; orgId: string | null; finalReport?: string | null }): Promise<void> {
  if (!run.orgId) return;
  const agent = await agentRepository.findBySlug(run.agentSlug, run.orgId);
  if (!agent?.spacesAppToken || !agent.spacesAppUserId) return;
  const appToken = decryptStoredField(agent.spacesAppToken);
  await spacesAppFetch("/chat/postMessage", {
    channelId: run.channelId,
    conversationId: run.conversationId,
    markdownText: run.finalReport?.trim()
      ? `**/experiment ended**\n\n${run.finalReport.trim()}`
      : "**/experiment ended**\n\n(experiment ended without final report)",
    userId: agent.spacesAppUserId,
    metadata: { contentFormat: "markdown" },
  }, appToken);
}

async function sessionIsActive(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const row = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
  return row?.status === "running";
}

async function tickOnce(): Promise<void> {
  const runs = await experimentRepository.listActive();
  const now = Date.now();
  for (const run of runs) {
    try {
      const deadlineMs = run.deadlineAt.getTime();
      if (now > deadlineMs + FORCE_DONE_AFTER_MS) {
        await experimentRepository.update(run.id, {
          status: "done",
          finalReport: run.finalReport ?? "(experiment ended without final report)",
        });
        await postNotice({ ...run, finalReport: run.finalReport ?? "(experiment ended without final report)" }).catch((err) => {
          log.warn(`[experiment] force-done notice failed id=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
        continue;
      }

      // NEVER dispatch while the current epoch session is live — a long quiet
      // epoch (agent grinding in the sandbox without touching the run row) is
      // normal, and dispatching over it double-runs the agent in one thread
      // (session-lock collisions). Run-recovery owns hung-session handling.
      const active = await sessionIsActive(run.currentSessionId);
      if (active) continue;
      // Inactive but recently touched = the immediate continuation hook is (or
      // was just) handling the epoch handoff — don't race it. Only rescue runs
      // that are BOTH inactive and quiet past the stale window.
      const stale = now - run.updatedAt.getTime() > STALE_MS;
      if (!stale) continue;

      if (now < deadlineMs && run.status === "running") {
        const next = await experimentRepository.update(run.id, {
          epoch: { increment: 1 },
          lastEpochEndedAt: new Date(),
        });
        await dispatchExperimentEpoch(next);
      } else if (now >= deadlineMs && run.status === "running") {
        const finishing = await experimentRepository.update(run.id, {
          status: "finishing",
          epoch: { increment: 1 },
          lastEpochEndedAt: new Date(),
        });
        await dispatchExperimentEpoch(finishing);
      }
    } catch (err) {
      log.warn(`[experiment] supervisor tick failed id=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function initExperimentSupervisor(): void {
  if (timer) return;
  timer = setInterval(() => { void tickOnce(); }, INTERVAL_MS);
  void tickOnce();
  log.info("[experiment] supervisor started");
}

export function closeExperimentSupervisor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
