import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { WorkflowRuntime } from './workflow-runtime.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { InMemoryStorageAdapter } from '../storage/in-memory-adapter.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import { BaseActionStep } from '../steps/base-step.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import { AllowAllAuthorizer } from '../authz/default.js';
import { variableRef } from '../types/workflow-config.js';
import { AttachmentSchema } from '../common/attachment.js';
import type { Attachment } from '../common/attachment.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { IdScope } from '../authz/id-scope.js';
import type { QueueAdapter, SchedulerAdapter } from '../persistence/types.js';
import { ApprovalRequirement } from '../types/approval.js';

interface Ctx {
  userId: string;
}
const ctx: Ctx = { userId: 'u' };

/** What the step saw at execution time — the proof the variable resolved. */
let captured: { docs: Attachment[]; readBytes: number[] } | null = null;

/** A step whose attachment config field is bound to a `{{vars.*}}` reference. */
const SingleConfig = z.object({ doc: variableRef(AttachmentSchema) });
class EchoDocStep extends BaseActionStep<typeof SingleConfig, { name: string }> {
  readonly type = 'ECHO_DOC';
  readonly configSchema = SingleConfig;
  readonly name = 'Echo Doc';
  readonly description = 'reads the resolved attachment';
  readonly outputSchema = z.object({ name: z.string() });
  readonly category = 'test';
  async execute(config: z.infer<typeof SingleConfig>, c: StepExecutionContext): Promise<{ name: string }> {
    const doc = config.doc as Attachment;
    const bytes = await c.files!.buffer(doc);
    captured = { docs: [doc], readBytes: [bytes.byteLength] };
    return { name: doc.name };
  }
}

const ArrayConfig = z.object({ docs: variableRef(z.array(AttachmentSchema)) });
class EchoDocsStep extends BaseActionStep<typeof ArrayConfig, { count: number }> {
  readonly type = 'ECHO_DOCS';
  readonly configSchema = ArrayConfig;
  readonly name = 'Echo Docs';
  readonly description = 'reads the resolved attachment array';
  readonly outputSchema = z.object({ count: z.number() });
  readonly category = 'test';
  async execute(config: z.infer<typeof ArrayConfig>, c: StepExecutionContext): Promise<{ count: number }> {
    const docs = config.docs as Attachment[];
    const readBytes: number[] = [];
    for (const d of docs) readBytes.push((await c.files!.buffer(d)).byteLength);
    captured = { docs, readBytes };
    return { count: docs.length };
  }
}

function build() {
  const persistence = new InMemoryPersistenceAdapter();
  const storage = new InMemoryStorageAdapter();
  const queue: QueueAdapter = { async enqueue() {} };
  const scheduler: SchedulerAdapter = { async schedule() {}, async unschedule() {} };
  const services = new ServiceRegistry();
  const connectors = testRegistry({ steps: [new EchoDocStep(), new EchoDocsStep()] });
  const executor = new WorkflowExecutor(persistence, connectors, services, { storage });
  const runtime = new WorkflowRuntime<Record<string, unknown>, Ctx, IdScope>({
    persistence,
    queue,
    scheduler,
    services,
    connectors,
    executor,
    storage,
    authorizer: new AllowAllAuthorizer(),
    config: { approval: { default: ApprovalRequirement.NOT_REQUIRED } },
  });
  return { runtime, persistence, storage };
}

/** Seed an ACTIVE MANUAL workflow whose single step binds to `{{vars.*}}`. */
async function seed(
  persistence: InMemoryPersistenceAdapter,
  config: WorkflowConfig,
): Promise<string> {
  return persistence.createWorkflow({
    id: 'wf1',
    status: 'ACTIVE',
    config: JSON.stringify(config),
    metadata: '{}',
    eventType: 'MANUAL',
    folderId: 'f1',
  });
}

describe('attachment as a workflow variable (end-to-end)', () => {
  it('a document variable resolves to the concrete, readable Attachment at the step', async () => {
    captured = null;
    const { runtime, persistence, storage } = build();

    // Author-time "upload": the file is stored once and its ref embedded in config.
    const att = await storage.put({}, {
      name: 'policy.pdf',
      mimeType: 'application/pdf',
      stream: Readable.from(Buffer.from('POLICY-DOCUMENT-BYTES')),
    });

    await seed(persistence, {
      trigger: { type: 'MANUAL', config: {} },
      steps: [{ id: 'echo', type: 'ECHO_DOC', config: { doc: '{{vars.policyDoc}}' } }],
      variables: [{ key: 'policyDoc', type: 'document', value: att }],
    });

    // Run with NO per-execution input — the doc comes entirely from the variable.
    const execId = await runtime.triggerManual(ctx, 'wf1', {});
    await runtime.processJob(execId);

    expect(captured).not.toBeNull();
    // The step received the concrete Attachment (not the "{{vars.policyDoc}}" string)…
    expect(captured!.docs[0]).toEqual(att);
    // …and it was genuinely mountable: bytes read back from storage.
    expect(captured!.readBytes[0]).toBe('POLICY-DOCUMENT-BYTES'.length);
  });

  it('a documents[] variable resolves to the whole readable array', async () => {
    captured = null;
    const { runtime, persistence, storage } = build();

    const a = await storage.put({}, { name: 'a.pdf', mimeType: 'application/pdf', stream: Readable.from(Buffer.from([1, 2, 3])) });
    const b = await storage.put({}, { name: 'b.pdf', mimeType: 'application/pdf', stream: Readable.from(Buffer.from([4, 5])) });

    await seed(persistence, {
      trigger: { type: 'MANUAL', config: {} },
      steps: [{ id: 'echo', type: 'ECHO_DOCS', config: { docs: '{{vars.policyDocs}}' } }],
      variables: [{ key: 'policyDocs', type: 'documents', value: [a, b] }],
    });

    const execId = await runtime.triggerManual(ctx, 'wf1', {});
    await runtime.processJob(execId);

    expect(captured).not.toBeNull();
    expect(captured!.docs).toEqual([a, b]);
    expect(captured!.readBytes).toEqual([3, 2]);
  });
});
