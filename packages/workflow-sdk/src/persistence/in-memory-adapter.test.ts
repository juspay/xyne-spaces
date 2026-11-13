import { describe, it, expect, beforeEach } from 'vitest';
import type { IdScope } from '../authz/id-scope.js';
import { InMemoryPersistenceAdapter } from './in-memory-adapter.js';
import { GateCategory } from '../types/known-types.js';

describe('InMemoryPersistenceAdapter', () => {
  let adapter: InMemoryPersistenceAdapter;

  beforeEach(() => {
    adapter = new InMemoryPersistenceAdapter();
  });

  // ─── Workflow definitions ───

  describe('getWorkflow', () => {
    it('returns null for unknown id', async () => {
      expect(await adapter.getWorkflow('nonexistent')).toBeNull();
    });

    it('returns seeded workflow', async () => {
      adapter.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: '{}',
        metadata: null,
        eventType: 'TICKET_CREATED',
      });
      const wf = await adapter.getWorkflow('wf_1');
      expect(wf).not.toBeNull();
      expect(wf!.id).toBe('wf_1');
      expect(wf!.status).toBe('ACTIVE');
    });
  });

  describe('findActiveWorkflows', () => {
    it('returns only active workflows matching eventType', async () => {
      adapter.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: '{}',
        metadata: null,
        eventType: 'TICKET_CREATED',
      });
      adapter.seedWorkflow({
        id: 'wf_2',
        status: 'DISABLED',
        config: '{}',
        metadata: null,
        eventType: 'TICKET_CREATED',
      });
      adapter.seedWorkflow({
        id: 'wf_3',
        status: 'ACTIVE',
        config: '{}',
        metadata: null,
        eventType: 'EMAIL_RECEIVED',
      });

      const result = await adapter.findActiveWorkflows('TICKET_CREATED', {});
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('wf_1');
    });

    it('returns empty array when no match', async () => {
      const result = await adapter.findActiveWorkflows('NONEXISTENT', {});
      expect(result).toEqual([]);
    });
  });

  // ─── Execution lifecycle ───

  describe('createExecution + getExecution', () => {
    it('creates and retrieves execution', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{"trigger":{"type":"TEST"}}',
      });
      expect(execId).toBeTruthy();

      const exec = await adapter.getExecution(execId);
      expect(exec).not.toBeNull();
      expect(exec!.workflowId).toBe('wf_1');
      expect(exec!.status).toBe('PENDING');
      expect(exec!.createdAt).toBeInstanceOf(Date);
    });

    it('creates execution state alongside execution', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{"data":true}',
      });

      const state = await adapter.getExecutionState(execId);
      expect(state).not.toBeNull();
      expect(state!.context).toBe('{"data":true}');
      expect(state!.currentStepIndex).toBe(0);
      expect(state!.pausePath).toBeNull();
    });

    it('generates unique ids', async () => {
      const id1 = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{}',
      });
      const id2 = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{}',
      });
      expect(id1).not.toBe(id2);
    });

    it('round-trips sourceExecutionId for rerun executions', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{}',
        sourceExecutionId: 'src_exec',
      });
      const exec = await adapter.getExecution(execId);
      expect(exec!.sourceExecutionId).toBe('src_exec');
    });

    it('omits sourceExecutionId when not provided', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{}',
      });
      const exec = await adapter.getExecution(execId);
      expect(exec!.sourceExecutionId).toBeUndefined();
    });
  });

  describe('updateExecutionStatus', () => {
    it('updates status', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{}',
      });
      await adapter.updateExecutionStatus(execId, 'RUNNING');
      const exec = await adapter.getExecution(execId);
      expect(exec!.status).toBe('RUNNING');
    });

    it('is a no-op for unknown execution', async () => {
      await adapter.updateExecutionStatus('nonexistent', 'RUNNING');
      // No error thrown
    });
  });

  describe('getExecution', () => {
    it('returns null for unknown id', async () => {
      expect(await adapter.getExecution('nonexistent')).toBeNull();
    });
  });

  // ─── Execution state ───

  describe('persistState + getExecutionState', () => {
    it('updates context and step index', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'RUNNING',
        context: '{"v":1}',
      });

      await adapter.persistState(execId, {
        context: '{"v":2}',
        currentStepIndex: 3,
      });

      const state = await adapter.getExecutionState(execId);
      expect(state!.context).toBe('{"v":2}');
      expect(state!.currentStepIndex).toBe(3);
      expect(state!.pausePath).toBeNull();
    });

    it("round-trips pauseType: 'review'", async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'RUNNING',
        context: '{}',
      });
      await adapter.persistState(execId, {
        context: '{"v":1}',
        currentStepIndex: 0,
        pauseType: 'review',
      });
      const state = await adapter.getExecutionState(execId);
      expect(state!.pauseType).toBe('review');
    });

    it('omits pauseType when not provided', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'RUNNING',
        context: '{}',
      });
      await adapter.persistState(execId, { context: '{}' });
      const state = await adapter.getExecutionState(execId);
      expect(state!.pauseType).toBeUndefined();
    });

    it('stores pause path', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'RUNNING',
        context: '{}',
      });

      const pausePath = JSON.stringify([{ stepIndex: 2 }]);
      await adapter.persistState(execId, {
        context: '{"paused":true}',
        currentStepIndex: 2,
        pausePath,
      });

      const state = await adapter.getExecutionState(execId);
      expect(state!.pausePath).toBe(pausePath);
    });

    it('creates state for unknown execution', async () => {
      await adapter.persistState('new_exec', {
        context: '{}',
        currentStepIndex: 0,
      });
      const state = await adapter.getExecutionState('new_exec');
      expect(state).not.toBeNull();
      expect(state!.currentStepIndex).toBe(0);
    });
  });

  describe('getExecutionState', () => {
    it('returns null for unknown execution', async () => {
      expect(await adapter.getExecutionState('nonexistent')).toBeNull();
    });
  });

  // ─── Step tracking ───

  describe('upsertStep + getStep + getStepRows', () => {
    it('creates and retrieves a step', async () => {
      await adapter.upsertStep('exec_1', 'send_message', {
        status: 'RUNNING',
        executorType: 'deterministic',
      });

      const step = await adapter.getStep('exec_1', 'send_message');
      expect(step).not.toBeNull();
      expect(step!.stepName).toBe('send_message');
      expect(step!.status).toBe('RUNNING');
      expect(step!.executorType).toBe('deterministic');
      expect(step!.data).toBeNull();
    });

    it('updates an existing step', async () => {
      await adapter.upsertStep('exec_1', 'step_1', {
        status: 'RUNNING',
        executorType: 'deterministic',
      });
      await adapter.upsertStep('exec_1', 'step_1', {
        status: 'COMPLETED',
        executorType: 'deterministic',
        data: '{"output":true}',
      });

      const step = await adapter.getStep('exec_1', 'step_1');
      expect(step!.status).toBe('COMPLETED');
      expect(step!.data).toBe('{"output":true}');
    });

    it('getStepRows returns all steps for an execution', async () => {
      await adapter.upsertStep('exec_1', 'step_a', {
        status: 'COMPLETED',
        executorType: 'deterministic',
      });
      await adapter.upsertStep('exec_1', 'step_b', {
        status: 'RUNNING',
        executorType: 'conditional',
      });
      await adapter.upsertStep('exec_2', 'step_c', {
        status: 'COMPLETED',
        executorType: 'deterministic',
      });

      const rows = await adapter.getStepRows('exec_1');
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.stepName).sort()).toEqual([
        'step_a',
        'step_b',
      ]);
    });

    it('getStep returns null for unknown step', async () => {
      expect(await adapter.getStep('exec_1', 'nonexistent')).toBeNull();
    });

    it('getStepRows returns empty for unknown execution', async () => {
      expect(await adapter.getStepRows('nonexistent')).toEqual([]);
    });
  });

  // ─── Failure handling ───

  describe('markFailed', () => {
    it('marks a running execution as failed', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'RUNNING',
        context: '{}',
      });

      const result = await adapter.markFailed(execId, 'something broke');
      expect(result).toBe('marked');
      expect((await adapter.getExecution(execId))!.status).toBe('FAILED');
    });

    it('skips terminal execution (COMPLETED)', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'COMPLETED',
        context: '{}',
      });

      const result = await adapter.markFailed(execId, 'too late');
      expect(result).toBe('skipped-terminal');
      expect((await adapter.getExecution(execId))!.status).toBe('COMPLETED');
    });

    it('skips terminal execution (FAILED)', async () => {
      const execId = await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'FAILED',
        context: '{}',
      });

      const result = await adapter.markFailed(execId, 'again');
      expect(result).toBe('skipped-terminal');
    });

    it('returns not-found for unknown execution', async () => {
      const result = await adapter.markFailed('nonexistent', 'err');
      expect(result).toBe('not-found');
    });
  });

  // ─── Static data ───

  describe('staticData', () => {
    it('set then get', async () => {
      await adapter.setStaticData('wf_1', 'counter', 42);
      expect(await adapter.getStaticData('wf_1', 'counter')).toBe(42);
    });

    it('get returns undefined for missing key', async () => {
      expect(await adapter.getStaticData('wf_1', 'missing')).toBeUndefined();
    });

    it('overwrite existing key', async () => {
      await adapter.setStaticData('wf_1', 'key', 'a');
      await adapter.setStaticData('wf_1', 'key', 'b');
      expect(await adapter.getStaticData('wf_1', 'key')).toBe('b');
    });

    it('delete removes key', async () => {
      await adapter.setStaticData('wf_1', 'key', 'value');
      await adapter.deleteStaticData('wf_1', 'key');
      expect(await adapter.getStaticData('wf_1', 'key')).toBeUndefined();
    });

    it('keys are scoped to workflow', async () => {
      await adapter.setStaticData('wf_1', 'key', 'one');
      await adapter.setStaticData('wf_2', 'key', 'two');
      expect(await adapter.getStaticData('wf_1', 'key')).toBe('one');
      expect(await adapter.getStaticData('wf_2', 'key')).toBe('two');
    });

    it('stores complex values', async () => {
      const obj = { nested: { arr: [1, 2, 3] } };
      await adapter.setStaticData('wf_1', 'obj', obj);
      expect(await adapter.getStaticData('wf_1', 'obj')).toEqual(obj);
    });
  });


  /**
   * Unwrap a credential page. These tests assert on content, not on the paging
   * envelope, and a generous default limit keeps them saying what they meant.
   */
  const listCreds = async (
    filter: Parameters<InMemoryPersistenceAdapter['listCredentials']>[0],
    page: { limit: number; cursor?: string } = { limit: 100 },
  ) => (await adapter.listCredentials(filter, page)).items;

  describe('credentials — createCredential', () => {
    it('creates a credential with ACTIVE status', async () => {
      const summary = await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'abc123' },
      });
      expect(summary.status).toBe('ACTIVE');
    });

    it('sets createdAt and updatedAt to the same timestamp', async () => {
      const summary = await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'abc123' },
      });
      expect(summary.createdAt).toBe(summary.updatedAt);
      expect(typeof summary.createdAt).toBe('number');
      expect(typeof summary.updatedAt).toBe('number');
    });

    it('returns a safe summary without values', async () => {
      const summary = await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'secret-token' },
      });
      expect(summary).not.toHaveProperty('values');
      expect(Object.keys(summary).sort()).toEqual(
        ['authType', 'createdAt', 'credType', 'name', 'status', 'updatedAt'],
      );
    });

    it('rejects duplicate name', async () => {
      await adapter.createCredential({}, {
        name: 'my-key',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'first' },
      });
      await expect(
        adapter.createCredential({}, {
          name: 'my-key',
          credType: 'BUILTIN_BASIC',
          authType: 'basic',
          values: { username: 'u', password: 'p' },
        }),
      ).rejects.toThrow();
    });

    it('rejects invalid values for the given authType', async () => {
      await expect(
        adapter.createCredential({}, {
          name: 'bad-cred',
          credType: 'BUILTIN_BEARER',
          authType: 'bearer',
          values: {} as never,
        }),
      ).rejects.toThrow();
    });

    it('creates credentials of all four auth types', async () => {
      const types = [
        { authType: 'bearer' as const, values: { token: 't' } },
        { authType: 'basic' as const, values: { username: 'u', password: 'p' } },
        { authType: 'custom_header' as const, values: { name: 'X-Key', value: 'v' } },
        { authType: 'oauth2_client_credentials' as const, values: { tokenUrl: 'https://oauth.example.com/token', clientId: 'cid', clientSecret: 'csec' } },
      ];
      for (const { authType, values } of types) {
        const summary = await adapter.createCredential({}, {
          name: `cred-${authType}`,
          credType: `BUILTIN_${authType.toUpperCase()}`,
          authType,
          values: values as never,
        });
        expect(summary.authType).toBe(authType);
        expect(summary.status).toBe('ACTIVE');
      }
    });
  });

  describe('credentials — listCredentials', () => {
    it('returns safe summaries without values', async () => {
      await adapter.createCredential({}, {
        name: 'cred-a',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'secret-a' },
      });
      const list = await listCreds({ kind: 'all' });
      expect(list).toHaveLength(1);
      expect(list[0]!.summary.name).toBe('cred-a');
      expect(list[0]!.summary.status).toBe('ACTIVE');
      // No `values` property anywhere.
      for (const entry of list) {
        expect(entry.summary).not.toHaveProperty('values');
      }
    });

    it('returns credentials sorted by name', async () => {
      await adapter.createCredential({}, { name: 'zebra', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 'z' } });
      await adapter.createCredential({}, { name: 'alpha', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 'a' } });
      await adapter.createCredential({}, { name: 'mango', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 'm' } });
      const list = await listCreds({ kind: 'all' });
      expect(list.map((c) => c.summary.name)).toEqual(['alpha', 'mango', 'zebra']);
    });

    it('includes revoked credentials', async () => {
      await adapter.createCredential({}, { name: 'cred', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 't' } });
      await adapter.revokeCredential({}, 'cred');
      const list = await listCreds({ kind: 'all' });
      expect(list).toHaveLength(1);
      expect(list[0]!.summary.status).toBe('REVOKED');
    });

    it('returns empty when no credentials exist', async () => {
      expect(await listCreds({ kind: 'all' })).toEqual([]);
    });

    it('applies visibility filters before pagination', async () => {
      await adapter.createCredential({}, { name: 'alpha', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 'a' } });
      await adapter.createCredential({}, { name: 'beta', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 'b' } });
      await adapter.createCredential({}, { name: 'gamma', credType: 'BUILTIN_BEARER', authType: 'bearer', values: { token: 'g' } });

      // The filter is applied BEFORE the page is cut, so `beta` never occupies
      // a slot: page one is alpha, and paging past it reaches gamma.
      const scope: IdScope = { kind: 'ids', ids: ['alpha', 'gamma'] };
      const first = await adapter.listCredentials(scope, { limit: 1 });
      expect(first.items).toMatchObject([{ summary: { name: 'alpha' } }]);
      // The cursor is opaque — it is round-tripped below, never inspected.
      expect(first.nextCursor).toBeDefined();

      const second = await adapter.listCredentials(scope, {
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(second.items).toMatchObject([{ summary: { name: 'gamma' } }]);
      // Nothing after gamma, so no cursor — a Load-more here would fetch air.
      expect(second.nextCursor).toBeUndefined();

      expect(await listCreds({ kind: 'none' })).toEqual([]);
    });
  });

  describe('credentials — replaceCredentialValues', () => {
    it('replaces values and updates the timestamp', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'old-token' },
      });

      const summary = await adapter.replaceCredentialValues(
        {},
        'my-bearer',
        { token: 'new-token' },
      );
      expect(summary).not.toBeNull();
      expect(summary!.updatedAt).toBeGreaterThanOrEqual(summary!.createdAt);
    });

    it('preserves createdAt after replacement', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'old' },
      });

      const before = (await listCreds({ kind: 'all' }))[0]!;

      await adapter.replaceCredentialValues(
        {},
        'my-bearer',
        { token: 'new' },
      );

      const after = (await listCreds({ kind: 'all' }))[0]!;

      expect(after.summary.createdAt).toBe(before.summary.createdAt);
      expect(after.summary.updatedAt).toBeGreaterThanOrEqual(before.summary.updatedAt);
    });

    it('returns null for missing credential', async () => {
      const result = await adapter.replaceCredentialValues(
        {},
        'nonexistent',
        { token: 'x' },
      );
      expect(result).toBeNull();
    });

    it('returns null for revoked credential', async () => {
      await adapter.createCredential({}, {
        name: 'revoked-cred',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });
      await adapter.revokeCredential({}, 'revoked-cred');

      const result = await adapter.replaceCredentialValues(
        {},
        'revoked-cred',
        { token: 'new' },
      );
      expect(result).toBeNull();
    });

    it('validates new values against the stored auth type', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });

      await expect(
        adapter.replaceCredentialValues(
          {},
          'my-bearer',
          { username: 'u', password: 'p' } as never,
        ),
      ).rejects.toThrow();
    });

    it('replaces all values completely — no partial merge', async () => {
      await adapter.createCredential({}, {
        name: 'my-basic',
        credType: 'BUILTIN_BASIC',
        authType: 'basic',
        values: { username: 'old-user', password: 'old-password' },
      });

      await adapter.replaceCredentialValues(
        {},
        'my-basic',
        { username: 'new-user', password: 'new-password' },
      );

      const resolved = await adapter.resolveCredential({}, 'my-basic');
      expect(resolved!.values).toEqual({ username: 'new-user', password: 'new-password' });
    });
  });

  describe('credentials — revokeCredential', () => {
    it('transitions ACTIVE to REVOKED', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });

      const summary = await adapter.revokeCredential({}, 'my-bearer');
      expect(summary).not.toBeNull();
      expect(summary!.status).toBe('REVOKED');
    });

    it('preserves createdAt after revocation', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });

      const before = (await listCreds({ kind: 'all' }))[0]!;
      const summary = await adapter.revokeCredential({}, 'my-bearer');
      expect(summary!.createdAt).toBe(before.summary.createdAt);
    });

    it('returns null for missing credential', async () => {
      const result = await adapter.revokeCredential({}, 'nonexistent');
      expect(result).toBeNull();
    });

    it('is idempotent — repeating revoke preserves the revocation timestamp', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });

      // First revocation by bob.
      const firstRevoke = await adapter.revokeCredential({}, 'my-bearer');
      const secondRevoke = await adapter.revokeCredential({}, 'my-bearer');
      expect(secondRevoke!.updatedAt).toBe(firstRevoke!.updatedAt);
      expect(secondRevoke!.status).toBe('REVOKED');
    });

    it('keeps the row — revoked credential remains visible in list', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });
      await adapter.revokeCredential({}, 'my-bearer');

      const list = await listCreds({ kind: 'all' });
      expect(list).toHaveLength(1);
      expect(list[0]!.summary.status).toBe('REVOKED');
    });
  });

  describe('credentials — resolveCredential (execution-time)', () => {
    it('returns ResolvedCredential with values for an active credential', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'secret-token' },
      });

      const resolved = await adapter.resolveCredential({}, 'my-bearer');
      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('my-bearer');
      expect(resolved!.authType).toBe('bearer');
      expect(resolved!.status).toBe('ACTIVE');
      expect(resolved!.values).toEqual({ token: 'secret-token' });
    });

    it('returns null for missing credential', async () => {
      expect(await adapter.resolveCredential({}, 'missing')).toBeNull();
    });

    it('returns null for revoked credential', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });
      await adapter.revokeCredential({}, 'my-bearer');

      expect(await adapter.resolveCredential({}, 'my-bearer')).toBeNull();
    });

    it('re-validates stored values against the auth type schema', async () => {
      await adapter.createCredential({}, {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 'valid-token' },
      });

      adapter.credentials.get('my-bearer')!.values = { invalid: true } as never;

      await expect(adapter.resolveCredential({}, 'my-bearer')).rejects.toThrow();
    });
  });

  describe('credentials — seedCredential (test helper)', () => {
    it('seeds an ACTIVE credential by default', async () => {
      adapter.seedCredential('test-cred', {
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
      });
      const list = await listCreds({ kind: 'all' });
      expect(list[0]!.summary.status).toBe('ACTIVE');
    });

    it('seeds a revoked credential when status is provided', async () => {
      adapter.seedCredential('revoked-cred', {
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
        status: 'REVOKED',
      });
      const list = await listCreds({ kind: 'all' });
      expect(list[0]!.summary.status).toBe('REVOKED');
      expect(await adapter.resolveCredential({}, 'revoked-cred')).toBeNull();
    });

    it('seeds with custom timestamps', async () => {
      adapter.seedCredential('custom-cred', {
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        values: { token: 't' },
        createdAt: 100,
        updatedAt: 200,
      });
      const list = await listCreds({ kind: 'all' });
      expect(list[0]!.summary.createdAt).toBe(100);
      expect(list[0]!.summary.updatedAt).toBe(200);
    });

    it('validates values on seed', async () => {
      expect(() =>
        adapter.seedCredential('bad-cred', {
          credType: 'BUILTIN_BEARER',
          authType: 'bearer',
          values: {} as never,
        }),
      ).toThrow();
    });
  });

  // ─── Test helpers ───

  describe('clear', () => {
    it('removes all data', async () => {
      adapter.seedWorkflow({
        id: 'wf_1',
        status: 'ACTIVE',
        config: '{}',
        metadata: null,
        eventType: 'TEST',
      });
      await adapter.createExecution({
        workflowId: 'wf_1',
        status: 'PENDING',
        context: '{}',
      });
      await adapter.setStaticData('wf_1', 'key', 'value');
      adapter.seedCredential('cred', {
        credType: 'BUILTIN_CUSTOM_HEADER',
        authType: 'custom_header',
        values: { name: 'X-Key', value: 'secret' },
      });

      adapter.clear();

      expect(await adapter.getWorkflow('wf_1')).toBeNull();
      expect(adapter.executions.size).toBe(0);
      expect(adapter.executionStates.size).toBe(0);
      expect(adapter.steps.size).toBe(0);
      expect(await adapter.getStaticData('wf_1', 'key')).toBeUndefined();
      expect(await listCreds({ kind: 'all' })).toEqual([]);
      expect(adapter.stepEvents.size).toBe(0);
    });
  });

  describe('step events', () => {
    it('appends and retrieves events', async () => {
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'progress',
        data: '{"phase":"connecting"}',
      });
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{"message":"done"}',
      });

      const events = await adapter.getStepEvents('exec_1', 'step_0');
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('progress');
      expect(events[1]!.type).toBe('log');
    });

    it('returns empty for unknown step', async () => {
      const events = await adapter.getStepEvents('exec_1', 'step_99');
      expect(events).toEqual([]);
    });

    it('events have unique ids', async () => {
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{}',
      });
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{}',
      });

      const events = await adapter.getStepEvents('exec_1', 'step_0');
      expect(events[0]!.id).not.toBe(events[1]!.id);
    });

    it('filters by after date', async () => {
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{"n":1}',
      });
      const cutoff = new Date();
      // Small delay to ensure the second event has a later timestamp
      await new Promise((r) => { setTimeout(r, 5); });
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{"n":2}',
      });

      const filtered = await adapter.getStepEvents(
        'exec_1',
        'step_0',
        cutoff,
      );
      expect(filtered).toHaveLength(1);
      expect(JSON.parse(filtered[0]!.data)).toEqual({ n: 2 });
    });

    it('isolates events by execution and step', async () => {
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{"a":1}',
      });
      await adapter.appendStepEvent('exec_1', 'step_1', {
        type: 'log',
        data: '{"b":2}',
      });
      await adapter.appendStepEvent('exec_2', 'step_0', {
        type: 'log',
        data: '{"c":3}',
      });

      expect(await adapter.getStepEvents('exec_1', 'step_0')).toHaveLength(1);
      expect(await adapter.getStepEvents('exec_1', 'step_1')).toHaveLength(1);
      expect(await adapter.getStepEvents('exec_2', 'step_0')).toHaveLength(1);
    });

    it('clear removes step events', async () => {
      await adapter.appendStepEvent('exec_1', 'step_0', {
        type: 'log',
        data: '{}',
      });
      adapter.clear();
      expect(await adapter.getStepEvents('exec_1', 'step_0')).toEqual([]);
    });
  });

  describe('countWorkflowsByFolder', () => {
    it('returns total and per-folder active counts', async () => {
      adapter.seedWorkflow({ id: 'wf1', status: 'ACTIVE', config: '{}', metadata: null, eventType: 'MANUAL', folderId: 'f1' });
      adapter.seedWorkflow({ id: 'wf2', status: 'DISABLED', config: '{}', metadata: null, eventType: 'MANUAL', folderId: 'f1' });
      adapter.seedWorkflow({ id: 'wf3', status: 'ACTIVE', config: '{}', metadata: null, eventType: 'MANUAL', folderId: 'f2' });

      const result = await adapter.countWorkflowsByFolder({ kind: 'all' });
      expect(result.total).toBe(3);
      expect(result.byFolder['f1']).toEqual({ total: 2, active: 1 });
      expect(result.byFolder['f2']).toEqual({ total: 1, active: 1 });
    });
  });

  describe('getAnalyticsSummary with folderId', () => {
    it('scopes stats to workflows in the given folder', async () => {
      adapter.seedWorkflow({ id: 'wf1', status: 'ACTIVE', config: '{}', metadata: JSON.stringify({ name: 'WF1' }), eventType: 'MANUAL', folderId: 'f1' });
      adapter.seedWorkflow({ id: 'wf2', status: 'ACTIVE', config: '{}', metadata: JSON.stringify({ name: 'WF2' }), eventType: 'MANUAL', folderId: 'f2' });

      // Seed one execution per workflow
      await adapter.createExecution({ workflowId: 'wf1', status: 'COMPLETED', context: '{}' });
      await adapter.createExecution({ workflowId: 'wf2', status: 'FAILED', context: '{}' });

      const since = new Date(Date.now() - 86_400_000);
      const result = await adapter.getAnalyticsSummary({ kind: 'all' }, { since, rangeDays: 7, folderId: 'f1' });

      expect(result.totalRuns).toBe(1);
      expect(result.byWorkflow).toHaveLength(1);
      expect(result.byWorkflow[0]?.workflowId).toBe('wf1');
      expect(result.totalWorkflows).toBe(1);
    });
  });

  describe('system integrity reads are unfiltered by design', () => {
    it('listAllFolders ignores the caller filter — a hidden folder must not break the cycle check', async () => {
      const a = await adapter.createFolder({ name: 'A', metadata: '{}' });
      await adapter.createFolder({ name: 'B', metadata: '{}' });
      expect((await adapter.listFolders({ kind: 'ids', ids: [a] }, { limit: 100 })).items).toHaveLength(1);
      expect(await adapter.listAllFolders()).toHaveLength(2);
    });

    it('countWorkflowsInFolder counts workflows the caller cannot see', async () => {
      adapter.seedWorkflow({ id: 'wf1', status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', folderId: 'f1' });
      adapter.seedWorkflow({ id: 'wf2', status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', folderId: 'f1' });
      adapter.seedWorkflow({ id: 'wf3', status: 'ACTIVE', config: '{}', metadata: '{}', eventType: 'MANUAL', folderId: 'f2' });
      // Only wf1 is visible, but the folder still holds two — deleting it must be blocked.
      expect(
        (await adapter.listWorkflows({ kind: 'ids', ids: ['wf1'] }, { limit: 100, folderId: 'f1' })).items,
      ).toHaveLength(1);
      expect(await adapter.countWorkflowsInFolder('f1')).toBe(2);
      expect(await adapter.countWorkflowsInFolder('empty')).toBe(0);
    });
  });

  // ─── Approvals: deadline buckets ───

  describe('pending approval buckets', () => {
    const scope: IdScope = { kind: 'all' };
    const HOUR = 3_600_000;

    /** A run parked on an approval gate, with an optional deadline. */
    const gate = async (workflowId: string, dueInMs?: number): Promise<string> => {
      adapter.seedWorkflow({
        id: workflowId,
        status: 'ACTIVE',
        config: '{}',
        metadata: JSON.stringify({ name: workflowId }),
        eventType: 'MANUAL',
      });
      const id = await adapter.createExecution({
        workflowId,
        status: 'EXTERNAL_WAIT',
        context: '{}',
      });
      await adapter.upsertStep(id, 'gate', {
        status: 'EXTERNAL_WAIT',
        executorType: 'wait',
        data: JSON.stringify({
          waitMode: 'approval',
          ...(dueInMs !== undefined
            ? { dueAt: new Date(Date.now() + dueInMs).toISOString() }
            : {}),
        }),
      });
      return id;
    };

    const names = (rows: { workflowName?: string }[]) => rows.map((r) => r.workflowName);

    beforeEach(async () => {
      await gate('late', -2 * HOUR);
      await gate('soon', 2 * HOUR);
      await gate('next-week', 24 * 7 * HOUR);
      await gate('no-deadline');
    });

    it('puts a passed deadline in overdue and nothing else', async () => {
      const page = await adapter.listPendingApprovals(scope, {
        limit: 10,
        bucket: 'overdue',
      });
      expect(names(page.items)).toEqual(['late']);
    });

    it('bounds due-today by the caller\'s end of day, not the server\'s', async () => {
      // `soon` is 2h away. With a boundary an hour before that it is out of
      // reach; move the boundary past it and it appears. A timezone whose day
      // ends earlier than the server\'s must not silently swallow the row.
      const tooEarly = await adapter.listPendingApprovals(scope, {
        limit: 10,
        bucket: 'dueToday',
        dayEnd: Date.now() + HOUR,
      });
      expect(names(tooEarly.items)).toEqual([]);

      const later = await adapter.listPendingApprovals(scope, {
        limit: 10,
        bucket: 'dueToday',
        dayEnd: Date.now() + 3 * HOUR,
      });
      expect(names(later.items)).toEqual(['soon']);
    });

    it('puts tomorrow and the day after in due-soon, not today or next week', async () => {
      await gate('tomorrow', 30 * HOUR);
      const dayEnd = Date.now() + 12 * HOUR;
      const soon = await adapter.listPendingApprovals(scope, { limit: 10, bucket: 'dueSoon', dayEnd });
      expect(names(soon.items)).toEqual(['tomorrow']);
    });

    it('leaves a gate with no deadline out of every bucket', async () => {
      const dayEnd = Date.now() + 12 * HOUR;
      const overdue = await adapter.listPendingApprovals(scope, { limit: 10, bucket: 'overdue' });
      const today = await adapter.listPendingApprovals(scope, { limit: 10, bucket: 'dueToday', dayEnd });
      const all = await adapter.listPendingApprovals(scope, { limit: 10 });

      expect(names(overdue.items)).not.toContain('no-deadline');
      expect(names(today.items)).not.toContain('no-deadline');
      expect(names(all.items)).toContain('no-deadline');
    });

    it('counts the bucket, not the page in hand', async () => {
      const dayEnd = Date.now() + 12 * HOUR;
      expect(await adapter.countPendingApprovals(scope, { bucket: 'overdue' })).toBe(1);
      expect(await adapter.countPendingApprovals(scope, { bucket: 'dueToday', dayEnd })).toBe(1);
      expect(await adapter.countPendingApprovals(scope)).toBe(4);
    });

    it('orders a bucket by deadline, most overdue first', async () => {
      await gate('later-still', -1 * HOUR);
      const page = await adapter.listPendingApprovals(scope, {
        limit: 10,
        bucket: 'overdue',
        sort: 'due',
      });
      expect(names(page.items)).toEqual(['late', 'later-still']);
    });
  });


  // ─── Approvals: who the gate waits on ───

  describe('pending approvals are human gates', () => {
    const scope: IdScope = { kind: 'all' };

    /** A run parked on one gate of the given category. */
    const parked = async (workflowId: string, category?: GateCategory): Promise<string> => {
      adapter.seedWorkflow({
        id: workflowId,
        status: 'ACTIVE',
        config: '{}',
        metadata: JSON.stringify({ name: workflowId }),
        eventType: 'MANUAL',
      });
      const id = await adapter.createExecution({ workflowId, status: 'EXTERNAL_WAIT', context: '{}' });
      await adapter.upsertStep(id, 'gate', {
        status: 'EXTERNAL_WAIT',
        executorType: 'wait',
        data: '{}',
        ...(category !== undefined ? { category } : {}),
      });
      return id;
    };

    const names = (rows: { workflowName?: string }[]) => rows.map((r) => r.workflowName).sort();

    beforeEach(async () => {
      await parked('needs-a-person', GateCategory.WaitingOnApprover);
      await parked('needs-a-build', GateCategory.WaitingOnApiCall);
      await parked('needs-a-clock', GateCategory.Delay);
      await parked('mid-conversation', GateCategory.WaitingOnConsumer);
    });

    it('leaves out every gate that is not an approver\'s', async () => {
      // A build, a clock, and a customer mid-chat are all somebody's — or
      // nobody's — but none of them is work for this queue.
      const page = await adapter.listPendingApprovals(scope, { limit: 10 });
      expect(names(page.items)).toEqual(['needs-a-person']);
    });

    it('counts and facets the same set the list returns', async () => {
      expect(await adapter.countPendingApprovals(scope)).toBe(1);
      const facets = await adapter.pendingApprovalFacets(scope);
      expect(facets.workflows.map((w) => w.name)).toEqual(['needs-a-person']);
    });

    it('still shows a gate recorded before categories existed', async () => {
      await parked('unclassified');
      const page = await adapter.listPendingApprovals(scope, { limit: 10 });
      expect(names(page.items)).toEqual(['needs-a-person', 'unclassified']);
    });
  });
});
