import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkflowClient, WorkflowClientError } from './workflow-client.js';
import type { WorkflowClientConfig, WorkflowClient } from './types.js';

// ─── Mock fetch ───

function mockFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function clientWith(
  fetchFn: typeof globalThis.fetch,
  baseUrl = 'https://api.test.com/api/workflows',
): WorkflowClient {
  const config: WorkflowClientConfig = {
    baseUrl,
    getHeaders: () => ({ Authorization: 'Bearer test-token' }),
    fetch: fetchFn,
  };
  return createWorkflowClient(config);
}

describe('createWorkflowClient', () => {
  describe('schema', () => {
    it('fetches step summaries', async () => {
      const summaries = [{ type: 'HTTP_REQUEST', name: 'HTTP Request', description: 'desc', category: 'action', kind: 'action', icon: undefined }];
      const fetch = mockFetch(200, { steps: summaries });
      const client = clientWith(fetch);

      const result = await client.schema.steps();

      expect(result).toEqual(summaries);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/schema/steps',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('fetches a single step descriptor', async () => {
      const descriptor = { type: 'HTTP_REQUEST', name: 'HTTP Request', configSchema: {} };
      const fetch = mockFetch(200, descriptor);
      const client = clientWith(fetch);

      const result = await client.schema.step('HTTP_REQUEST');

      expect(result).toEqual(descriptor);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/schema/steps/HTTP_REQUEST',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('fetches trigger summaries', async () => {
      const summaries = [{ type: 'MANUAL', name: 'Manual', description: 'desc' }];
      const fetch = mockFetch(200, { triggers: summaries });
      const client = clientWith(fetch);

      const result = await client.schema.triggers();

      expect(result).toEqual(summaries);
    });

    it('fetches a single trigger descriptor', async () => {
      const descriptor = { type: 'MANUAL', name: 'Manual', configSchema: {} };
      const fetch = mockFetch(200, descriptor);
      const client = clientWith(fetch);

      const result = await client.schema.trigger('MANUAL');

      expect(result).toEqual(descriptor);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/schema/triggers/MANUAL',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('fetches operators', async () => {
      const operators = [{ value: 'eq', label: 'equals', valueType: 'string' }];
      const fetch = mockFetch(200, { operators });
      const client = clientWith(fetch);

      const result = await client.schema.operators();

      expect(result).toEqual(operators);
    });

    it('posts available context', async () => {
      const context = { trigger: { type: 'object', properties: {} } };
      const fetch = mockFetch(200, { context });
      const client = clientWith(fetch);
      const config = { trigger: { type: 'MANUAL', config: {} }, steps: [] };

      const result = await client.schema.availableContext(
        config as Parameters<typeof client.schema.availableContext>[0],
        'step_1',
      );

      expect(result).toEqual(context);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/schema/available-context',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ config, atStepId: 'step_1' }),
        }),
      );
    });
  });

  describe('workflows', () => {
    it('lists workflows', async () => {
      const workflows = [{ id: 'w1', status: 'ACTIVE', config: null, metadata: null, eventType: 'MANUAL' }];
      const fetch = mockFetch(200, { workflows });
      const client = clientWith(fetch);

      const result = await client.workflows.list();

      expect(result.items).toEqual(workflows);
      expect(result.nextCursor).toBeUndefined();
    });

    it('carries the cursor through a workflow page', async () => {
      const workflows = [{ id: 'w1', status: 'ACTIVE', config: null, metadata: null, eventType: 'MANUAL' }];
      const fetch = mockFetch(200, { workflows, nextCursor: 'w1' });
      const client = clientWith(fetch);

      const result = await client.workflows.list({ limit: 1, cursor: 'w0' });

      expect(result.nextCursor).toBe('w1');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows?limit=1&cursor=w0',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('aborts a read when its signal fires', async () => {
      const fetch = mockFetch(200, { workflows: [] });
      const client = clientWith(fetch);
      const controller = new AbortController();

      await client.workflows.list(undefined, { signal: controller.signal });

      // The signal must reach fetch — a caller that merely discards the result
      // still leaves the database doing the work.
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('gets a single workflow', async () => {
      const workflow = { id: 'w1', status: 'ACTIVE' };
      const fetch = mockFetch(200, workflow);
      const client = clientWith(fetch);

      const result = await client.workflows.get('w1');

      expect(result).toEqual(workflow);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows/w1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('validates a workflow config', async () => {
      const validationResult = { valid: true, issues: [] };
      const fetch = mockFetch(200, validationResult);
      const client = clientWith(fetch);
      const config = { trigger: { type: 'MANUAL', config: {} }, steps: [] };

      const result = await client.workflows.validate(
        config as Parameters<typeof client.workflows.validate>[0],
      );

      expect(result).toEqual(validationResult);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows/validate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(config),
        }),
      );
    });

    it('activates a workflow', async () => {
      const fetch = mockFetch(200, { activated: true });
      const client = clientWith(fetch);

      await client.workflows.activate('w1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows/w1/activate',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('deactivates a workflow', async () => {
      const fetch = mockFetch(200, { deactivated: true });
      const client = clientWith(fetch);

      await client.workflows.deactivate('w1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows/w1/deactivate',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('triggers a workflow with payload', async () => {
      const fetch = mockFetch(201, { executionId: 'exec_1' });
      const client = clientWith(fetch);

      const result = await client.workflows.trigger('w1', { key: 'value' });

      expect(result).toEqual({ executionId: 'exec_1' });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows/w1/trigger',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ key: 'value' }),
        }),
      );
    });

    it('triggers a workflow without payload', async () => {
      const fetch = mockFetch(201, { executionId: 'exec_1' });
      const client = clientWith(fetch);

      const result = await client.workflows.trigger('w1');

      expect(result).toEqual({ executionId: 'exec_1' });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/workflows/w1/trigger',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    });

    it('triggers a workflow with schema-shaped multipart input', async () => {
      const fetch = mockFetch(201, { executionId: 'exec_doc' });
      const client = createWorkflowClient({
        baseUrl: 'https://api.test.com',
        getHeaders: () => ({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
        fetch,
      });
      const file = new File(['hello'], 'contract.txt', { type: 'text/plain' });
      const extractionSchema = { type: 'object', properties: { answer: { type: 'string' } } };

      const result = await client.workflows.triggerV2('wf1', {
        payload: {
          documents: [file],
          extractionSchema,
          responseUrl: 'https://client.example.com/result',
        },
      });

      expect(result).toEqual({ executionId: 'exec_doc' });
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/v2/workflows/wf1/trigger/v2',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
          body: expect.any(FormData),
        }),
      );
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
      const form = init.body as FormData;
      expect(form.get('extractionSchema')).toBe(JSON.stringify(extractionSchema));
      expect(form.get('responseUrl')).toBe('https://client.example.com/result');
      expect(form.get('documents')).toBeInstanceOf(File);
    });

    it('triggers a workflow v2 without documents', async () => {
      const fetch = mockFetch(201, { executionId: 'exec_no_doc' });
      const client = createWorkflowClient({
        baseUrl: 'https://api.test.com',
        getHeaders: () => ({ Authorization: 'Bearer test-token' }),
        fetch,
      });

      const result = await client.workflows.triggerV2('wf1', {
        payload: {
          responseUrl: 'https://client.example.com/result',
        },
      });

      expect(result).toEqual({ executionId: 'exec_no_doc' });
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
      const form = init.body as FormData;
      expect(form.get('responseUrl')).toBe('https://client.example.com/result');
      expect(form.get('documents')).toBeNull();
    });
  });

  describe('executions', () => {
    it('lists executions with params', async () => {
      const executions = [{ id: 'e1', workflowId: 'w1', status: 'COMPLETED', createdAt: '2026-01-01' }];
      const fetch = mockFetch(200, { items: executions, nextCursor: 'abc' });
      const client = clientWith(fetch);

      const result = await client.executions.list({ workflowId: 'w1', status: 'COMPLETED', limit: 10 });

      expect(result.items).toEqual(executions);
      expect(result.nextCursor).toBe('abc');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('workflowId=w1'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('gets execution detail', async () => {
      const detail = { id: 'e1', workflowId: 'w1', status: 'COMPLETED', steps: [] };
      const fetch = mockFetch(200, detail);
      const client = clientWith(fetch);

      const result = await client.executions.get('e1');

      expect(result).toEqual(detail);
    });

    it('resumes an execution', async () => {
      const fetch = mockFetch(200, { resumed: true });
      const client = clientWith(fetch);

      await client.executions.resume('e1', { data: { action: 'approve' } });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/executions/e1/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: { action: 'approve' } }),
        }),
      );
    });

    it('cancels an execution', async () => {
      const fetch = mockFetch(200, undefined);
      const client = clientWith(fetch);

      await client.executions.cancel('e1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/executions/e1/cancel',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('connector credentials — schema', () => {
    it('lists credential types grouped by connector', async () => {
      const connectors = [
        {
          connectorId: 'github',
          connectorName: 'GitHub',
          credentials: [
            {
              credType: 'GITHUB_WEBHOOK_SECRET',
              label: 'Webhook secret',
              authType: 'secret',
              fields: [{ key: 'value', label: 'Secret', control: 'password' }],
            },
          ],
        },
      ];
      const fetch = mockFetch(200, { connectors });
      const client = clientWith(fetch);

      expect(await client.schema.credentialTypes()).toEqual(connectors);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/schema/credentials',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('credentials — vault client', () => {
    it('lists credentials and returns CredentialListResponse', async () => {
      const credentials = [
        {
          summary: {
            name: 'bearer-token',
            credType: 'BUILTIN_BEARER',
            authType: 'bearer',
            status: 'ACTIVE',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
          },
          attributes: { createdBy: 'alice', updatedBy: 'bob' },
        },
      ];
      const fetch = mockFetch(200, { credentials });
      const client = clientWith(fetch);

      const result = await client.credentials.list();

      expect(result).toEqual({ credentials });
      expect(result.credentials).toHaveLength(1);
      expect(result.credentials[0]!.summary).not.toHaveProperty('values');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('lists empty credentials', async () => {
      const fetch = mockFetch(200, { credentials: [] });
      const client = clientWith(fetch);

      const result = await client.credentials.list({ limit: 20, cursor: 'b-cred' });

      expect(result.credentials).toEqual([]);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials?limit=20&cursor=b-cred',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('creates a credential and returns CredentialSummary', async () => {
      const summary = {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        status: 'ACTIVE',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };
      const fetch = mockFetch(201, summary);
      const client = clientWith(fetch);

      const result = await client.credentials.create({
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        values: { token: 'secret-token' },
      });

      expect(result).toEqual(summary);
      expect(result).not.toHaveProperty('values');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'my-bearer',
            credType: 'BUILTIN_BEARER',
            values: { token: 'secret-token' },
          }),
        }),
      );
    });


    it('replaces credential values and returns CredentialSummary', async () => {
      const summary = {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        status: 'ACTIVE',
        createdAt: 1700000000000,
        updatedAt: 1700000005000,
      };
      const fetch = mockFetch(200, summary);
      const client = clientWith(fetch);

      const result = await client.credentials.replaceValues('my-bearer', {
        values: { token: 'new-token' },
      });

      expect(result.updatedAt).toBe(1700000005000);
      expect(result).not.toHaveProperty('values');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials/my-bearer',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ values: { token: 'new-token' } }),
        }),
      );
    });

    it('URL-encodes the credential name in replaceValues', async () => {
      const fetch = mockFetch(200, {
        name: 'my/key',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        status: 'ACTIVE',
        createdAt: 1,
        updatedAt: 1,
      });
      const client = clientWith(fetch);

      await client.credentials.replaceValues('my/key', {
        values: { token: 't' },
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials/my%2Fkey',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('revokes a credential and returns CredentialSummary', async () => {
      const summary = {
        name: 'my-bearer',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        status: 'REVOKED',
        createdAt: 1700000000000,
        updatedAt: 1700000005000,
      };
      const fetch = mockFetch(200, summary);
      const client = clientWith(fetch);

      const result = await client.credentials.revoke('my-bearer');

      expect(result.status).toBe('REVOKED');
      expect(result).not.toHaveProperty('values');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials/my-bearer/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('URL-encodes the credential name in revoke', async () => {
      const fetch = mockFetch(200, {
        name: 'my key',
        credType: 'BUILTIN_BEARER',
        authType: 'bearer',
        status: 'REVOKED',
        createdAt: 1,
        updatedAt: 2,
      });
      const client = clientWith(fetch);

      await client.credentials.revoke('my key');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/credentials/my%20key/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('does not have a delete method', () => {
      const client = clientWith(mockFetch(200, {}));
      // @ts-expect-error — `delete` should not exist on CredentialsClient
      expect(client.credentials.delete).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws WorkflowClientError on non-OK response', async () => {
      const fetch = mockFetch(404, { error: 'Workflow not found' });
      const client = clientWith(fetch);

      await expect(client.workflows.get('bad-id')).rejects.toThrow(WorkflowClientError);
      await expect(client.workflows.get('bad-id')).rejects.toThrow('Workflow not found');
    });

    it('includes status and body in error', async () => {
      const fetch = mockFetch(400, { error: 'Bad request', details: 'missing field' });
      const client = clientWith(fetch);

      try {
        await client.workflows.validate({} as Parameters<typeof client.workflows.validate>[0]);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(WorkflowClientError);
        const clientError = err as WorkflowClientError;
        expect(clientError.status).toBe(400);
        expect(clientError.body).toEqual({ error: 'Bad request', details: 'missing field' });
      }
    });
  });

  describe('request construction', () => {
    it('sends Authorization header from getHeaders', async () => {
      const fetch = mockFetch(200, { workflows: [] });
      const client = createWorkflowClient({
        baseUrl: 'https://api.test.com',
        getHeaders: () => ({ Authorization: 'Bearer my-token', 'X-Custom': 'value' }),
        fetch,
      });

      await client.workflows.list();

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token',
            'X-Custom': 'value',
          }),
        }),
      );
    });

    it('supports async getHeaders', async () => {
      const fetch = mockFetch(200, { workflows: [] });
      const client = createWorkflowClient({
        baseUrl: 'https://api.test.com',
        getHeaders: async () => ({ Authorization: 'Bearer async-token' }),
        fetch,
      });

      await client.workflows.list();

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer async-token',
          }),
        }),
      );
    });

    it('sets Content-Type for POST requests with body', async () => {
      const fetch = mockFetch(200, { valid: true, issues: [] });
      const client = clientWith(fetch);
      const config = { trigger: { type: 'MANUAL', config: {} }, steps: [] };

      await client.workflows.validate(
        config as Parameters<typeof client.workflows.validate>[0],
      );

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('strips trailing slash from baseUrl', async () => {
      const fetch = mockFetch(200, { workflows: [] });
      const client = clientWith(fetch, 'https://api.test.com/api/');

      await client.workflows.list();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows',
        expect.any(Object),
      );
    });

    it('encodes special characters in URL params', async () => {
      const fetch = mockFetch(200, { type: 'test' });
      const client = clientWith(fetch);

      await client.schema.step('step/with spaces');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/workflows/schema/steps/step%2Fwith%20spaces',
        expect.any(Object),
      );
    });
  });
});
