import { createLogger } from "../logger.js";
import { ERROR_PIPELINE } from "../config.js";
import { runner as errorPipelineRunner } from "../error-pipeline/runner/runner.js";
import { connectDb } from "../db.js";
import { ensureTickScheduler, closeAwakeningQueues } from "../queue/awakening-queue.js";
import { initAwakeningTickWorker, closeAwakeningTickWorker } from "../queue/awakening-tick-worker.js";
import { initAwakeningWindowWorker, closeAwakeningWindowWorker } from "../queue/awakening-window-worker.js";
import { initAwakeningReflexWorker, closeAwakeningReflexWorker } from "../queue/awakening-reflex-worker.js";
import { initScheduledJobsWorker, closeWorker } from "../queue/scheduled-jobs-worker.js";
import { closeQueue } from "../queue/scheduled-jobs-queue.js";
import { initDailyBriefWorker, closeDailyBriefWorker } from "../queue/daily-brief-worker.js";
import { closeDailyBriefQueue } from "../queue/daily-brief-queue.js";
import { initDailyBriefCron } from "../services/dailyBriefCron.js";
import { initRunRecoveryWorker, closeRunRecoveryWorker } from "../queue/run-recovery-worker.js";
import { initProviderRetryWorker, closeProviderRetryWorker } from "../queue/provider-retry-worker.js";
import { initExperimentSupervisor, closeExperimentSupervisor } from "../queue/experiment-supervisor.js";
import { initDigitalTwinBackfillWorker } from "../queue/digital-twin-backfill-worker.js";
import { initAgentBackfillWorker, closeAgentBackfillWorker } from "../queue/agent-backfill-worker.js";
import { closeAgentBackfillQueue } from "../queue/agent-backfill-queue.js";
import { initEvalImportWorker, closeEvalImportWorker } from "../queue/eval-import-worker.js";
import { initEvalGenerationWorker, closeEvalGenerationWorker } from "../queue/eval-generation-worker.js";
import { initSearchEvalRunWorker, closeSearchEvalRunWorker } from "../queue/search-eval-run-worker.js";
import { initEntityExtractionWorker, closeEntityExtractionWorker } from "../queue/entity-extraction-worker.js";
import { closeEntityExtractionQueue } from "../queue/entity-extraction-queue.js";
import { initEvalJudgeWorker, closeEvalJudgeWorker } from "../queue/eval-judge-worker.js";
import { initFailureCuratorWorker, closeFailureCuratorWorker } from "../services/failure-curator-worker.js";
import { closeBackfillQueue } from "../queue/digital-twin-backfill-queue.js";
import { bootstrapCustomTools } from "../bootstrap-tools.js";
import { initMemoryCron } from "../services/memoryCronService.js";
import { initSlackConfigTokenCron } from "../surfaces/slack/config-token-cron.js";
import { initDigitalTwinDaily } from "../services/digitalTwinDaily.js";
import {
  startBitbucketStatsBackgroundRefresh,
  stopBitbucketStatsBackgroundRefresh,
} from "../services/bitbucket-stats.js";

const log = createLogger("main");

type WorkerEntry = {
  name: string;
  init?: () => void;
  close?: () => Promise<unknown>;
  closeSync?: () => void;
};

const WORKERS: WorkerEntry[] = [
  { name: "bitbucket-stats", closeSync: stopBitbucketStatsBackgroundRefresh },
  { name: "scheduled-jobs-worker", init: initScheduledJobsWorker, close: closeWorker },
  { name: "scheduled-jobs-queue", close: closeQueue },
  { name: "run-recovery-worker", init: initRunRecoveryWorker, close: closeRunRecoveryWorker },
  { name: "provider-retry-worker", init: initProviderRetryWorker, close: closeProviderRetryWorker },
  { name: "experiment-supervisor", init: initExperimentSupervisor, closeSync: closeExperimentSupervisor },
  { name: "digital-twin-backfill-worker", init: initDigitalTwinBackfillWorker },
  { name: "digital-twin-backfill-queue", close: closeBackfillQueue },
  { name: "agent-backfill-worker", init: initAgentBackfillWorker, close: closeAgentBackfillWorker },
  { name: "agent-backfill-queue", close: closeAgentBackfillQueue },
  { name: "eval-import-worker", init: initEvalImportWorker, close: closeEvalImportWorker },
  { name: "eval-generation-worker", init: initEvalGenerationWorker, close: closeEvalGenerationWorker },
  { name: "eval-judge-worker", init: initEvalJudgeWorker, close: closeEvalJudgeWorker },
  { name: "search-eval-run-worker", init: initSearchEvalRunWorker, close: closeSearchEvalRunWorker },
  { name: "entity-extraction-worker", init: initEntityExtractionWorker, close: closeEntityExtractionWorker },
  { name: "entity-extraction-queue", close: closeEntityExtractionQueue },
  { name: "memory-cron", init: initMemoryCron },
  { name: "slack-config-token-cron", init: initSlackConfigTokenCron },
  { name: "digital-twin-daily", init: initDigitalTwinDaily },
  // Daily Brief: bounded worker (caps concurrent LLM runs) + leader-locked
  // enqueue cron (fans out opted-in users once/day). See services/dailyBrief*.
  { name: "daily-brief-worker", init: initDailyBriefWorker, close: closeDailyBriefWorker },
  { name: "daily-brief-queue", close: closeDailyBriefQueue },
  { name: "daily-brief-cron", init: initDailyBriefCron },
  { name: "failure-curator-worker", init: initFailureCuratorWorker, closeSync: closeFailureCuratorWorker },
  // Awakened agents: one fleet-wide tick fans out to per-agent window jobs.
  // ensureTickScheduler is idempotent, so every pod calling it converges on
  // a single scheduler — which is also what makes a Redis wipe self-heal on
  // the next boot instead of silently stopping every awakened agent.
  { name: "awakening-tick-worker", init: initAwakeningTickWorker, close: closeAwakeningTickWorker },
  { name: "awakening-window-worker", init: initAwakeningWindowWorker, close: closeAwakeningWindowWorker },
  { name: "awakening-reflex-worker", init: initAwakeningReflexWorker, close: closeAwakeningReflexWorker },
  { name: "awakening-queues", close: closeAwakeningQueues },
];

const SHUTDOWN_SEQUENCE: string[] = [
  "bitbucket-stats",
  "scheduled-jobs-worker",
  "run-recovery-worker",
  "provider-retry-worker",
  "experiment-supervisor",
  "eval-import-worker",
  "eval-generation-worker",
  "eval-judge-worker",
  "search-eval-run-worker",
  "entity-extraction-worker",
  "entity-extraction-queue",
  "failure-curator-worker",
  "awakening-tick-worker",
  "awakening-window-worker",
  "awakening-reflex-worker",
  "awakening-queues",
  "scheduled-jobs-queue",
  "daily-brief-worker",
  "daily-brief-queue",
  "digital-twin-backfill-queue",
  "agent-backfill-worker",
  "agent-backfill-queue",
];

export function bootWorkers(): void {
  void connectDb().catch(err => {
    log.error('[xyne-claw-auth] Database warmup failed:', err);
  });
  // npx cache scrub: prior deploys left half-installed package trees in
  // ~/.npm/_npx (e.g. node-fetch present, data-uri-to-buffer missing),
  // which made every stdio MCP spawn (github, etc.) die with
  // ERR_MODULE_NOT_FOUND → "Connection closed". Wipe on boot so the
  // next npx -y re-downloads a complete tree.
  void (async () => {
    try {
      const { rm } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      const path = `${homedir()}/.npm/_npx`;
      await rm(path, { recursive: true, force: true });
      log.info(`[boot] scrubbed npx cache at ${path}`);
    } catch (err) {
      log.warn(`[boot] npx cache scrub failed:`, err);
    }
  })();

  if (ERROR_PIPELINE.isRunnerPod) {
    log.info("[boot] runner pod — starting pipeline workers, skipping all other background workers/crons");
    errorPipelineRunner.start();
    return;
  }

  // Normal API pod: the full background fleet, no runner.
  for (const worker of WORKERS) {
    worker.init?.();
  }

  void ensureTickScheduler().catch((err) =>
    log.error("[boot] awakening tick scheduler registration failed:", err),
  );
  // Upsert custom tools from the shared registry so newly added tools (e.g.
  // google-sheets-create, google-forms-create) show up in the agent UI on
  // restart without needing a manual POST /tools/sync call.
  void bootstrapCustomTools();
  // Jobs persist in Redis. A full Redis wipe loses schedulers; there is no
  // auto-reconcile from Postgres. If that ever happens, restore by iterating
  // active ScheduledJob rows and calling enqueueCronJob / enqueueDelayedJob.
  // Warm the Bitbucket-author stats cache (PR/commit counts for xyne-doctor)
  // so the admin dashboard's stat cards never serve a cold fetch.
  startBitbucketStatsBackgroundRefresh();
}

export async function shutdownWorkers(): Promise<void> {
  if (ERROR_PIPELINE.isRunnerPod) {
    errorPipelineRunner.stop();
    return;
  }

  // API pod: drain the background fleet (none of it ran on the runner pod).
  for (const name of SHUTDOWN_SEQUENCE) {
    const worker = WORKERS.find((entry) => entry.name === name);
    if (worker === undefined) continue;
    if (worker.closeSync !== undefined) {
      worker.closeSync();
      continue;
    }
    if (worker.close !== undefined) {
      await worker.close().catch(() => {});
    }
  }
}
