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
import { AgentStep, AgentToolRegistry, PiMonoRuntime } from '@xyne/workflow-sdk/agents';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { workflowsQueue } from '@/queues/workflowsQueue';
import { workflowsCronQueue } from '@/queues/workflowsCronQueue';
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
 * RUN_AGENT — INTERIM. See docs/guidelines/workflows/AGENTS.md.
 *
 * This runs the SDK's bundled pi-mono runtime against LiteLLM, mirroring xyne-search. It should run
 * on xyne-claw instead: claw is where this product's agents, tools, MCP connections and approvals
 * already live, so an author here picks a model and writes a prompt rather than picking one of the
 * org's agents. The claw design is analysed in that doc — `ClawAgentRuntime extends BaseAgentRuntime`,
 * translating claw's SSE stream, which works because claw is itself a pi-mono agent.
 *
 * Capability-gated: no LLM config means RUN_AGENT is absent from the step picker rather than present
 * and failing mid-run — the same rule DEDUP and the WEBHOOK trigger break, being auto-registered by
 * the SDK with no way to opt out.
 */
const llmBaseUrl = config.llm.litellmBaseUrl?.replace(/\/$/, '') ?? '';
const llmApiKey = config.llm.litellmApiKey ?? '';

if (llmBaseUrl && llmApiKey) {
  steps.register(
    new AgentStep(
      new PiMonoRuntime({ baseUrl: llmBaseUrl, apiKey: llmApiKey, api: 'openai-completions' }),
      new AgentToolRegistry(),
    ),
  );
  logger.info('[workflows] RUN_AGENT registered (interim: pi-mono over LiteLLM)');
} else {
  logger.warn('[workflows] LiteLLM not configured — RUN_AGENT will not be available');
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
