/**
 * The `@xyne/workflow-sdk` runtime, assembled.
 *
 * Everything the engine needs, wired once: the five adapters, the three registries, the
 * executor and the event bus. Nothing here is xyne-specific logic — the decisions all live
 * in the adapters. This file is the composition root, and the only place that knows they
 * belong together.
 *
 * Deliberately does NOT auto-initialize its queues. The API process and the worker both
 * import this module, but only one of them should own a Bull processor, so
 * `initWorkflows()` is called explicitly from each entry point.
 */
import {
  ExecutionEventBus,
  ServiceRegistry,
  StepRegistry,
  TriggerRegistry,
  WorkflowExecutor,
  WorkflowRuntime,
  type ExecutorLogger,
} from '@xyne/workflow-sdk';
import { HostAgentStep } from '@xyne/workflow-sdk/agents/host';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { workflowsQueue } from '@/queues/workflowsQueue';
import { workflowsCronQueue } from '@/queues/workflowsCronQueue';
import { ClawAgentProvider } from './agents/claw-provider';
import { PrismaPersistenceAdapter } from './adapters/persistence';
import { BullQueueAdapter } from './adapters/queue';
import { BullSchedulerAdapter } from './adapters/scheduler';
import { WorkflowStorageAdapter } from './adapters/storage';
import { XyneWorkflowAuthorizer } from './authorizer';
import { DEFAULT_CRON_TIMEZONE } from './constants';
import type { XyneCtx, XyneFilter } from './types';

/** The SDK logs through the host's logger rather than owning one. */
const sdkLogger: ExecutorLogger = {
  info: (msg) => logger.info(`[workflows] ${msg}`),
  warn: (msg) => logger.warn(`[workflows] ${msg}`),
  error: (msg) => logger.error(`[workflows] ${msg}`),
};

const BASE_URL = config.workflows.baseUrl;

export const persistence = new PrismaPersistenceAdapter();
export const eventBus = new ExecutionEventBus();

const storage = new WorkflowStorageAdapter();
const services = new ServiceRegistry();
const steps = new StepRegistry();
const triggers = new TriggerRegistry();

/**
 * RUN_AGENT — runs on xyne-claw. See docs/guidelines/workflows/AGENTS.md.
 *
 * Claw is where this product's agents live: their prompts, tools, MCP connections, model policy and
 * approvals are all configured there. So a workflow author picks one of the org's agents and gives
 * it a task, rather than assembling an agent inline.
 *
 * Dispatch-and-callback, not streaming — the step parks and its worker slot is released for the
 * duration of the run. Claw reports back to `/api/internal/workflows-v2/claw-callback`.
 *
 * This replaced an interim step that drove the SDK's bundled pi-mono runtime against LiteLLM. That
 * removal is what lets the backend drop the pi peer dependencies: `@xyne/workflow-sdk/agents/host`
 * is pi-free, and nothing else here imports the pi-ful `/agents` barrel.
 *
 * Capability-gated: no claw config means no agent step in the picker, rather than one that is
 * present and fails mid-run — the same rule DEDUP and the WEBHOOK trigger break, being
 * auto-registered by the SDK with no way to opt out.
 */
if (config.xyneClaw.s2sKey && config.xyneClaw.authUrl) {
  steps.register(
    new HostAgentStep(new ClawAgentProvider(), {
      type: 'RUN_AGENT',
      name: 'Run Agent',
      description: "Run one of your workspace's agents and use its response",
      category: 'ai',
    }),
  );
  logger.info('[workflows] RUN_AGENT registered (xyne-claw, S2S dispatch)');
} else {
  logger.warn('[workflows] xyne-claw not configured — RUN_AGENT will not be available');
}

const executor = new WorkflowExecutor(persistence, steps, triggers, services, {
  eventBus,
  baseUrl: BASE_URL,
  storage,
  logger: sdkLogger,
});

export const workflowRuntime = new WorkflowRuntime<Record<string, unknown>, XyneCtx, XyneFilter>({
  persistence,
  queue: new BullQueueAdapter(),
  scheduler: new BullSchedulerAdapter(),
  services,
  steps,
  triggers,
  executor,
  storage,
  eventBus,
  authorizer: new XyneWorkflowAuthorizer(),
  logger: sdkLogger,
  config: {
    baseUrl: BASE_URL,
    defaultCronTimezone: DEFAULT_CRON_TIMEZONE,
  },
});

export const initWorkflows = async (): Promise<void> => {
  await workflowsQueue.initialize();
  await workflowsCronQueue.initialize();
  logger.info('[workflows] runtime ready');
};
