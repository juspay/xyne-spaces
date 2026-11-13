/**
 * Driving a conversation the way the Conversation API does, for tests.
 *
 * A real runtime over in-memory persistence, a worker that picks jobs off the
 * queue as the host's would, and the two things a caller ever does: see what is
 * being asked, and answer it. Tests that assert what the engine does with this
 * shape go through here, so none of them re-implement the loop.
 *
 * It depends on no test runner, so a script can drive a flow with it too.
 */
import { promptLines } from '../types/pause-state.js';
import { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { InMemoryEventBus } from '../events/in-memory-adapter.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import { testRegistry } from '../testing/test-connector.js';
import { ApprovalRequirement } from '../types/approval.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { readTurn, type RunView } from './turn.js';

/** Who is asking. The harness allows everyone, so it never matters here. */
const ANYONE = {} as never;

export function harness(): { runtime: WorkflowRuntime } {
  const persistence = new InMemoryPersistenceAdapter();
  const eventBus = new InMemoryEventBus();
  const connectors = testRegistry();
  const services = new ServiceRegistry();
  const executor = new WorkflowExecutor(persistence, connectors, services, { eventBus });
  let runtime: WorkflowRuntime;
  // One job at a time per run, a moment after it is queued — as a worker would.
  let work = Promise.resolve();
  const queue: QueueAdapter = {
    async enqueue({ executionId }) {
      setTimeout(() => {
        work = work.then(() => runtime.processJob(executionId).then(() => undefined)).catch(() => undefined);
      }, 0);
    },
  };
  const scheduler: SchedulerAdapter = { async schedule() {}, async unschedule() {} };
  runtime = new WorkflowRuntime({
    persistence,
    authorizer: new AllowAllAuthorizer(),
    queue,
    scheduler,
    services,
    connectors,
    executor,
    eventBus,
    config: { baseUrl: 'https://api.example.com', approval: { default: ApprovalRequirement.NOT_REQUIRED } },
  });
  return { runtime };
}

export interface Parked {
  nodePath: string;
  prompt: string;
}

/**
 * Wait until the run is asking something, and say what and where.
 *
 * Every control step on the way down is marked waiting too, so the one to
 * answer is the WAIT itself — the leaf.
 */
export async function parked(runtime: WorkflowRuntime, id: string, notAt = ''): Promise<Parked> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const detail = await runtime.getExecutionDetail(ANYONE, id);
    for (const step of detail?.steps ?? []) {
      if (step.status !== 'EXTERNAL_WAIT' || step.stepName === notAt) continue;
      const data = JSON.parse(step.data ?? '{}') as { type?: string; pauseState?: { prompt?: unknown } };
      if (data.type !== 'WAIT') continue;
      // A screen may say several things; read as the one block a test asserts on.
      return { nodePath: step.stepName, prompt: promptLines(data.pauseState).join('\n\n') };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('nothing was asked');
}

/** Answer whatever is being asked, and wait for whatever is asked next. */
export async function answer(runtime: WorkflowRuntime, id: string, choice: string): Promise<Parked> {
  const { nodePath } = await parked(runtime, id);
  await runtime.resume(ANYONE, id, { data: { action: 'approve', data: { choice } } as never, nodePath });
  return parked(runtime, id, nodePath);
}

/**
 * What a caller sees once the conversation has stopped working: the run as the
 * Conversation API reads it. A step is marked waiting a moment before the run
 * is, so the wait is on the turn rather than on the run's own status.
 */
export async function seen(runtime: WorkflowRuntime, id: string): Promise<RunView> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const detail = await runtime.getExecutionDetail(ANYONE, id);
    if (detail) {
      const view: RunView = { id, status: detail.execution.status, steps: detail.steps, config: detail.config };
      if (readTurn(view).status !== 'working') return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the conversation never stopped working');
}

/** Start a conversation on `config`, with whatever the app would pass in. */
export async function conversationOn(
  runtime: WorkflowRuntime,
  config: WorkflowConfig,
  context: Record<string, unknown> = {},
): Promise<string> {
  const folder = await runtime.createFolder(ANYONE, { name: 'Tests' });
  const workflow = await runtime.createWorkflow(ANYONE, { name: 'Conversation', config, folderId: folder.id });
  return runtime.triggerManual(ANYONE, workflow.id, { context });
}

/**
 * Stand in for whatever a lookup calls: every request is answered with the same
 * body, and the stub records them — `calls` is how a test says a section's
 * lookup ran once for the whole visit rather than once per screen, and `urls`
 * is how it says what was actually asked for.
 *
 * `restoreFetch()` puts the real one back; call it when the test is done.
 */
export interface FakeService {
  calls: number;
  urls: string[];
  restore: () => void;
}

let realFetch: typeof fetch | undefined;

export function answering(body: unknown): FakeService {
  realFetch ??= globalThis.fetch;
  const service: FakeService = { calls: 0, urls: [], restore: restoreFetch };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    service.calls += 1;
    service.urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return service;
}

/** Put the real `fetch` back, whatever a test left in its place. */
export function restoreFetch(): void {
  if (realFetch) globalThis.fetch = realFetch;
  realFetch = undefined;
}
