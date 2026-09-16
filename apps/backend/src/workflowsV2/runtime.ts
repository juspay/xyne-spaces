import {
  BaseConnector,
  ConnectorRegistry,
  ServiceRegistry,
  WorkflowExecutor,
  WorkflowRuntime,
  type AnyStep,
  type ExecutorLogger,
} from '@xyne/workflow-sdk';
import { BitbucketConnector } from '@xyne/connector-sdk/bitbucket';
import { GitHubConnector } from '@xyne/connector-sdk/github';
import { HostAgentStep } from '@xyne/workflow-sdk/agents/host';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { workflowsQueue } from '@/queues/workflowsQueue';
import { workflowsCronQueue } from '@/queues/workflowsCronQueue';
import { ClawAgentProvider } from './agents/claw-provider';
import { SdlcArtifactAgentProvider } from './agents/sdlc-artifact-provider';
import { SDLC_AGENT_STEP_TYPE, SdlcAgentProvider } from './agents/sdlc-agent-provider';
import { SdlcWikiPlanStep } from '@/sdlc/wiki/wikiPlanStep';
import { RedisEventBus } from './adapters/event-bus';
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
export const eventBus = new RedisEventBus();

const storage = new WorkflowStorageAdapter();
const services = new ServiceRegistry();

const connectors = new ConnectorRegistry();
connectors.register(new GitHubConnector());
connectors.register(new BitbucketConnector({ apiBaseUrl: config.bitbucket.baseUrl }));

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
 */
class ClawConnector extends BaseConnector {
  readonly id = 'claw';
  readonly version = '1.0.0';
  readonly name = 'Xyne Claw';
  readonly description = 'Agents configured on xyne-claw';
  readonly icon = 'bot';
  readonly credentials = [];
  readonly triggers = [];
  readonly steps: readonly AnyStep[] = [
    new HostAgentStep(new ClawAgentProvider(), {
      type: 'RUN_AGENT',
      name: 'Run Agent',
      description: "Run one of your workspace's agents and use its response",
      category: 'ai',
    }),
  ];
}

/** SDLC hub steps. The agent steps dispatch to claw's sdlc-agent, so they share its gate. */
class SdlcConnector extends BaseConnector {
  readonly id = 'sdlc';
  readonly version = '1.0.0';
  readonly name = 'SDLC';
  readonly description = 'Steps that work on an SDLC hub';
  readonly icon = 'git-branch';
  readonly credentials = [];
  readonly triggers = [];
  readonly steps: readonly AnyStep[] = [
    new HostAgentStep(new SdlcArtifactAgentProvider(), {
      type: 'CREATE_SDLC_ARTIFACT',
      name: 'Create SDLC artifact',
      description: "Generate or refresh one document in an SDLC hub's artifact type",
      category: 'ai',
    }),
    new HostAgentStep(new SdlcAgentProvider(), {
      type: SDLC_AGENT_STEP_TYPE,
      name: 'SDLC Agent',
      description: 'Run the SDLC agent in a hub, optionally pinned to one repository',
      category: 'ai',
    }),
    new SdlcWikiPlanStep(),
  ];
}

if (config.xyneClaw.s2sKey && config.xyneClaw.authUrl) {
  connectors.register(new ClawConnector());
  logger.info('[workflows] RUN_AGENT registered (xyne-claw, S2S dispatch)');
  connectors.register(new SdlcConnector());
  logger.info('[workflows] CREATE_SDLC_ARTIFACT, SDLC_AGENT and SDLC_WIKI_PLAN registered');
} else {
  logger.warn('[workflows] xyne-claw not configured — RUN_AGENT will not be available');
}

const executor = new WorkflowExecutor(persistence, connectors, services, {
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
  connectors,
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

export const shutdownWorkflows = async (): Promise<void> => {
  await eventBus.close();
  logger.info('[workflows] runtime closed');
};
