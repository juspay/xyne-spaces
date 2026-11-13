import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { ConfigValidator } from '../engine/config-validator.js';
import type { WorkflowConfig } from './workflow-config.js';

// ─── Summary column round-trips through the adapter ───

describe('workflow summary column', () => {
  it('stores summary on create and returns it from getWorkflow', async () => {
    const db = new InMemoryPersistenceAdapter();
    const id = await db.createWorkflow({
      status: 'ACTIVE',
      config: '{}',
      metadata: '{}',
      eventType: 'MANUAL',
      summary: 'Processes refunds end to end.',
      folderId: 'f1',
    });
    const wf = await db.getWorkflow(id);
    expect(wf?.summary).toBe('Processes refunds end to end.');
  });

  it('defaults summary to null when omitted', async () => {
    const db = new InMemoryPersistenceAdapter();
    const id = await db.createWorkflow({
      status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', folderId: 'f1',
    });
    expect((await db.getWorkflow(id))?.summary).toBeNull();
  });

  it('updates summary; leaves it untouched when not provided', async () => {
    const db = new InMemoryPersistenceAdapter();
    const id = await db.createWorkflow({
      status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', summary: 'v1', folderId: 'f1',
    });
    await db.updateWorkflow(id, { summary: 'v2' });
    expect((await db.getWorkflow(id))?.summary).toBe('v2');
    await db.updateWorkflow(id, { status: 'INACTIVE' }); // no summary key
    expect((await db.getWorkflow(id))?.summary).toBe('v2');
  });
});

// ─── Alias + group fields don't affect validation ───

describe('step alias + grouping fields', () => {
  const validator = new ConfigValidator(testRegistry());

  const base = (extra: Record<string, unknown>): WorkflowConfig => ({
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      { id: 's1', type: 'CODE', config: { code: 'return { ok: true };' }, ...extra },
    ],
  });

  it('a config with title/description/groupId + groups validates the same as without', () => {
    const plain = validator.validate(base({}));
    const annotated = validator.validate({
      ...base({ title: 'Compute total', description: 'sums the cart', groupId: 'g1' }),
      groups: [{ id: 'g1', title: 'Checkout', description: 'the checkout phase' }],
    });
    expect(annotated.valid).toBe(plain.valid);
    expect(annotated.valid).toBe(true);
  });
});
