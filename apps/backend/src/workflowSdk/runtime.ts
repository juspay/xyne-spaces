// Singleton assembly of the @xyne/workflow-sdk runtime — the v2 workflow
// engine mounted at /api/workflow-studio. Mirrors xyne-search's runtime.ts with
// xyne-spaces infrastructure: Prisma persistence, Bull queue/scheduler,
// GCS/S3 storage, and the workspace-scoped authorizer.
//
// Phase 1 registers built-in steps only: no sandbox (the CODE step fails
// closed by design), no AgentStep/ai-builder (needs LiteLLM + pi peers).
//
// This module is imported by BOTH processes: the API server (router — enqueues
// only) and the worker (processors — see ./worker.ts). Construction has no
// side effects beyond object creation.

import {
  ExecutionEventBus,
  ServiceRegistry,
  StepRegistry,
  TriggerRegistry,
  WorkflowExecutor,
  WorkflowRuntime,
} from '@xyne/workflow-sdk';
import type { ExecutorLogger } from '@xyne/workflow-sdk';
import { logger } from '@/utils/logger';
import { PrismaPersistenceAdapter } from './persistence';
import { BullQueueAdapter } from './queue';
import { BullSchedulerAdapter } from './scheduler';
import { XyneStorageAdapter } from './storage';
import { XyneWorkflowAuthorizer } from './authorizer';
import { MessageReceivedTrigger } from './triggers/message-received.trigger';
import { ReplyToMessageStep } from './steps/reply-to-message.step';
import type { XyneCtx, XyneFilter } from './acl';

const sdkLogger: ExecutorLogger = {
  info: msg => logger.info(`[WORKFLOW-SDK] ${msg}`),
  warn: msg => logger.warn(`[WORKFLOW-SDK] ${msg}`),
  error: msg => logger.error(`[WORKFLOW-SDK] ${msg}`),
};

// Public origin + mount prefix. Webhook and wait-callback URLs are rendered
// from this for external callers, so it must be the internet-reachable backend
// origin — the same one inbound Google webhooks are validated against.
const BASE_URL = `${process.env.BACKEND_URL ?? 'http://localhost:3001'}/api/workflow-studio`;

export const workflowSdkPersistence = new PrismaPersistenceAdapter();

const queue = new BullQueueAdapter();
const scheduler = new BullSchedulerAdapter();
const eventBus = new ExecutionEventBus();
const storage = new XyneStorageAdapter();

// StepRegistry auto-registers the SDK builtins (CODE, HTTP_REQUEST, CONDITIONAL,
// LOOP, MAP, PARALLEL, SWITCH, WAIT, DEDUP); host domain steps go on top.
const steps = new StepRegistry();
steps.register(new ReplyToMessageStep());

const triggers = new TriggerRegistry();
triggers.register(new MessageReceivedTrigger());

const services = new ServiceRegistry();

const executor = new WorkflowExecutor(workflowSdkPersistence, steps, triggers, services, {
  eventBus,
  baseUrl: BASE_URL,
  logger: sdkLogger,
  storage,
});

export const workflowSdkRuntime = new WorkflowRuntime<Record<string, unknown>, XyneCtx, XyneFilter>({
  persistence: workflowSdkPersistence,
  queue,
  scheduler,
  services,
  steps,
  triggers,
  executor,
  authorizer: new XyneWorkflowAuthorizer(),
  eventBus,
  storage,
  logger: sdkLogger,
  config: {
    baseUrl: BASE_URL,
    defaultCronTimezone: 'Asia/Kolkata',
  },
});
