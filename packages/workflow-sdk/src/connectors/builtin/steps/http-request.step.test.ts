import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import {
  HttpRequestStep,
  HttpRequestStepConfigSchema,
} from './http-request.step.js';
import type { HttpRequestStepConfig } from './http-request.step.js';
import {
  createMockStepContext,
  mockResolvedCredential,
} from '../../../testing/mock-step-context.js';
import type { Attachment } from '../../../common/attachment.js';
import { buildStepDescriptor } from '../../../steps/step-descriptor.js';
import type { StorageAdapter } from '../../../storage/types.js';

// ─── Fetch mock helpers ───

function bodyToBytes(body: unknown): Uint8Array {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new TextEncoder().encode(JSON.stringify(body));
}

function mockFetch(
  responseInit: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) {
  const status = responseInit.status ?? 200;
  const statusText = responseInit.statusText ?? 'OK';
  const headers = new Headers(responseInit.headers ?? { 'content-type': 'application/json' });
  const bytes = bodyToBytes(responseInit.body ?? {});

  const text = new TextDecoder().decode(bytes);
  const response = {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    headers,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    // json/text retained for any caller that uses them; lazy evaluation.
    json: vi.fn().mockImplementation(() => Promise.resolve(JSON.parse(text || 'null'))),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;

  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

function cfg(
  overrides: Partial<z.input<typeof HttpRequestStepConfigSchema>> & { url: string },
): HttpRequestStepConfig {
  return HttpRequestStepConfigSchema.parse(overrides);
}

const doc: Attachment = {
  name: 'doc.pdf',
  mimeType: 'application/pdf',
  handle: 'mem://doc',
};

describe('HttpRequestStep', () => {
  const step = new HttpRequestStep();
  let fetchSpy: ReturnType<typeof mockFetch> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('has correct metadata', () => {
    expect(step.type).toBe('HTTP_REQUEST');
    expect(step.kind).toBe('action');
    expect(step.category).toBe('integration');
  });

  // ─── Config schema ───

  describe('config schema', () => {
    it('validates minimal config with defaults', () => {
      const config = HttpRequestStepConfigSchema.parse({
        url: 'https://api.example.com/data',
      });
      expect(config.method).toBe('GET');
      // No inline auth — the node authenticates via a selected vault credential.
      expect(config.credentialName).toBeUndefined();
      expect(config.body).toEqual({ mode: 'none' });
      expect(config.response).toEqual({ type: 'auto' });
      expect(config.timeoutMs).toBe(30_000);
      expect(config.followRedirects).toBe(true);
    });

    it('validates full config with raw body', () => {
      const config = HttpRequestStepConfigSchema.parse({
        url: 'https://api.example.com/data',
        method: 'POST',
        credentialName: 'my-api',
        headers: { 'x-request-id': 'abc' },
        queryParams: { page: '1', limit: '10' },
        body: { mode: 'raw', raw: '{"name":"test"}', contentType: 'json' },
        response: { type: 'json' },
        timeoutMs: 5000,
        followRedirects: false,
      });
      expect(config.method).toBe('POST');
      expect(config.credentialName).toBe('my-api');
      expect(config.queryParams).toEqual({ page: '1', limit: '10' });
      expect(config.body.mode).toBe('raw');
    });

    it('rejects empty url', () => {
      expect(() => HttpRequestStepConfigSchema.parse({ url: '' })).toThrow();
    });

    it('rejects invalid method', () => {
      expect(() =>
        HttpRequestStepConfigSchema.parse({ url: 'https://x.com', method: 'INVALID' }),
      ).toThrow();
    });

    it('accepts an optional credentialName', () => {
      const withCred = HttpRequestStepConfigSchema.parse({
        url: 'https://x.com',
        credentialName: 'stripe',
      });
      expect(withCred.credentialName).toBe('stripe');
      // Omitted is valid too (unauthenticated request).
      const without = HttpRequestStepConfigSchema.parse({ url: 'https://x.com' });
      expect(without.credentialName).toBeUndefined();
    });

    it('accepts a credential name variable reference for executor resolution', () => {
      const config = HttpRequestStepConfigSchema.parse({
        url: 'https://x.com',
        credentialName: '{{vars.credentialName}}',
      });
      expect(config.credentialName).toBe('{{vars.credentialName}}');
    });

    it('describes credentialName as a picker limited to the HTTP credential types', () => {
      const props = buildStepDescriptor(step).configSchema['properties'] as Record<
        string,
        Record<string, unknown>
      >;
      expect(props['credentialName']!['format']).toBe('credential-name');
      expect(props['credentialName']!['credentialTypes']).toEqual([
        'BUILTIN_BEARER',
        'BUILTIN_BASIC',
        'BUILTIN_CUSTOM_HEADER',
        'BUILTIN_OAUTH2_CLIENT_CREDENTIALS',
      ]);
    });

    it('validates each body mode shape', () => {
      // none
      expect(HttpRequestStepConfigSchema.parse({ url: 'https://x.com', body: { mode: 'none' } }).body)
        .toEqual({ mode: 'none' });
      // raw with default content-type
      const raw = HttpRequestStepConfigSchema.parse({
        url: 'https://x.com',
        body: { mode: 'raw', raw: 'hello' },
      });
      expect(raw.body).toEqual({ mode: 'raw', raw: 'hello', contentType: 'json' });
      // urlencoded
      const ue = HttpRequestStepConfigSchema.parse({
        url: 'https://x.com',
        body: { mode: 'urlencoded', fields: [{ key: 'a', value: '1' }] },
      });
      if (ue.body.mode !== 'urlencoded') throw new Error('expected urlencoded');
      expect(ue.body.fields[0]).toEqual({ key: 'a', value: '1', enabled: true });
      // formdata text fields
      const fd = HttpRequestStepConfigSchema.parse({
        url: 'https://x.com',
        body: {
          mode: 'formdata',
          fields: [
            { key: 'name', value: 'Alice' },
            { key: 'role', value: 'admin' },
          ],
        },
      });
      if (fd.body.mode !== 'formdata') throw new Error('expected formdata');
      expect(fd.body.fields).toHaveLength(2);
    });

    it('rejects unknown body mode', () => {
      expect(() =>
        HttpRequestStepConfigSchema.parse({ url: 'https://x.com', body: { mode: 'graphql' } }),
      ).toThrow();
    });

    it('validates optional formdata file fields', () => {
      const config = HttpRequestStepConfigSchema.parse({
        url: 'https://x.com',
        body: {
          mode: 'formdata',
          fields: [{ key: 'name', value: 'Alice' }],
          files: [{ key: 'documents', value: '{{trigger.documents}}' }],
        },
      });
      expect(config.body.mode).toBe('formdata');
      if (config.body.mode !== 'formdata') throw new Error('expected formdata');
      expect(config.body.files).toEqual([
        { key: 'documents', value: '{{trigger.documents}}', enabled: true },
      ]);
    });

    it('rejects body.mode=binary', () => {
      expect(() =>
        HttpRequestStepConfigSchema.parse({
          url: 'https://x.com',
          body: { mode: 'binary', file: { name: 'a', mimeType: 'text/plain', handle: 'mem://1' } },
        }),
      ).toThrow();
    });
  });

  // ─── Basic requests ───

  describe('execute — basic requests', () => {
    it('makes a GET request and returns parsed JSON', async () => {
      fetchSpy = mockFetch({ body: { users: [{ id: 1 }] } });
      const ctx = createMockStepContext();

      const output = await step.execute(
        cfg({ url: 'https://api.example.com/users' }),
        ctx,
      );

      expect(output.status).toBe(200);
      expect(output.ok).toBe(true);
      expect(output.body).toEqual({ users: [{ id: 1 }] });
      expect(output.bodyText).toBe('{"users":[{"id":1}]}');
      expect(output.size).toBeGreaterThan(0);
      expect(output.duration).toBeGreaterThanOrEqual(0);
    });

    it('makes a POST request with raw JSON body', async () => {
      fetchSpy = mockFetch({ body: { id: 42 }, status: 201, statusText: 'Created' });
      const ctx = createMockStepContext();

      const output = await step.execute(
        cfg({
          url: 'https://api.example.com/users',
          method: 'POST',
          body: { mode: 'raw', raw: '{"name":"Alice"}', contentType: 'json' },
        }),
        ctx,
      );

      expect(output.status).toBe(201);
      expect(output.ok).toBe(true);

      const callInit = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1];
      expect(callInit.body).toBe('{"name":"Alice"}');
      const h = callInit.headers as Headers;
      expect(h.get('content-type')).toBe('application/json');
    });

    it('does not send body for GET requests even when body.mode is set', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com',
          body: { mode: 'raw', raw: 'should be ignored' },
        }),
        ctx,
      );

      const callInit = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1];
      expect(callInit.body).toBeUndefined();
    });
  });

  // ─── Query params ───

  describe('execute — query params', () => {
    it('appends query params to URL', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com/search',
          queryParams: { q: 'hello', page: '2' },
        }),
        ctx,
      );

      const calledUrl = (fetchSpy!.mock.calls[0] as [string, RequestInit])[0];
      const parsed = new URL(calledUrl);
      expect(parsed.searchParams.get('q')).toBe('hello');
      expect(parsed.searchParams.get('page')).toBe('2');
    });

    it('preserves existing query params in URL', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com/search?existing=yes',
          queryParams: { added: 'true' },
        }),
        ctx,
      );

      const calledUrl = (fetchSpy!.mock.calls[0] as [string, RequestInit])[0];
      const parsed = new URL(calledUrl);
      expect(parsed.searchParams.get('existing')).toBe('yes');
      expect(parsed.searchParams.get('added')).toBe('true');
    });
  });

  // ─── Body modes ───

  describe('execute — body modes', () => {
    it('mode=raw sets content-type from the contentType selector', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com',
          method: 'POST',
          body: { mode: 'raw', raw: '<x>data</x>', contentType: 'xml' },
        }),
        ctx,
      );

      const callInit = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1];
      expect(callInit.body).toBe('<x>data</x>');
      const h = callInit.headers as Headers;
      expect(h.get('content-type')).toBe('application/xml');
    });

    it('mode=raw with contentType=custom uses customContentType', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com',
          method: 'POST',
          body: { mode: 'raw', raw: '{}', contentType: 'custom', customContentType: 'application/vnd.api+json' },
        }),
        ctx,
      );

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      expect(h.get('content-type')).toBe('application/vnd.api+json');
    });

    it('mode=raw respects an explicit custom header', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com',
          method: 'POST',
          headers: { 'content-type': 'application/xml' },
          body: { mode: 'raw', raw: '<x>data</x>', contentType: 'json' },
        }),
        ctx,
      );

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      // custom header wins
      expect(h.get('content-type')).toBe('application/xml');
    });

    it('mode=urlencoded encodes enabled fields, skips disabled ones', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com/login',
          method: 'POST',
          body: {
            mode: 'urlencoded',
            fields: [
              { key: 'username', value: 'alice' },
              { key: 'password', value: 'secret' },
              { key: 'remember', value: 'on', enabled: false },
            ],
          },
        }),
        ctx,
      );

      const callInit = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1];
      expect(callInit.body).toBe('username=alice&password=secret');
      const h = callInit.headers as Headers;
      expect(h.get('content-type')).toBe('application/x-www-form-urlencoded');
    });

    it('mode=formdata sends FormData with text fields, lets fetch set the boundary', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com/upload',
          method: 'POST',
          body: {
            mode: 'formdata',
            fields: [
              { key: 'name', value: 'Alice' },
              { key: 'role', value: 'admin' },
              { key: 'skip', value: 'x', enabled: false },
            ],
          },
        }),
        ctx,
      );

      const callInit = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1];
      expect(callInit.body).toBeInstanceOf(FormData);
      const form = callInit.body as FormData;
      expect(form.get('name')).toBe('Alice');
      expect(form.get('role')).toBe('admin');
      // disabled field skipped
      expect(form.get('skip')).toBeNull();
      // fetch sets the multipart boundary itself — we leave content-type unset
      const h = callInit.headers as Headers;
      expect(h.get('content-type')).toBeNull();
    });

    it('mode=formdata sends document attachments when provided', async () => {
      fetchSpy = mockFetch();
      const read = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
      const ctx = createMockStepContext({
        storage: {
          read,
          store: vi.fn(),
        } as unknown as StorageAdapter,
      });

      await step.execute(
        cfg({
          url: 'https://api.example.com/upload',
          method: 'POST',
          body: {
            mode: 'formdata',
            files: [{ key: 'documents', value: [doc] }],
          },
        }),
        ctx,
      );

      const form = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].body as FormData;
      const uploaded = form.get('documents') as Blob & { name?: string };
      expect(read).toHaveBeenCalledWith(doc);
      expect(uploaded).toBeInstanceOf(Blob);
      expect(uploaded.name).toBe('doc.pdf');
      expect(uploaded.type).toBe('application/pdf');
      expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('mode=formdata skips missing or empty document values', async () => {
      fetchSpy = mockFetch();
      const read = vi.fn();
      const ctx = createMockStepContext({
        storage: {
          read,
          store: vi.fn(),
        } as unknown as StorageAdapter,
      });

      await step.execute(
        cfg({
          url: 'https://api.example.com/upload',
          method: 'POST',
          body: {
            mode: 'formdata',
            files: [
              { key: 'missing' },
              { key: 'empty', value: [] },
            ],
          },
        }),
        ctx,
      );

      const form = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].body as FormData;
      expect(form.get('missing')).toBeNull();
      expect(form.get('empty')).toBeNull();
      expect(read).not.toHaveBeenCalled();
    });
  });

  // ─── HTTP error responses ───

  describe('execute — HTTP error responses', () => {
    it('returns 404 without throwing', async () => {
      fetchSpy = mockFetch({ status: 404, statusText: 'Not Found', body: { error: 'not found' } });
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://api.example.com/missing' }), ctx);

      expect(output.status).toBe(404);
      expect(output.ok).toBe(false);
      expect(output.body).toEqual({ error: 'not found' });
    });

    it('returns 500 without throwing', async () => {
      fetchSpy = mockFetch({ status: 500, statusText: 'Internal Server Error' });
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://api.example.com/fail' }), ctx);
      expect(output.status).toBe(500);
      expect(output.ok).toBe(false);
    });
  });

  // ─── Response body parsing ───

  describe('execute — response body parsing', () => {
    it('auto-parses JSON from content-type', async () => {
      fetchSpy = mockFetch({ body: { data: 1 } });
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://x.com' }), ctx);
      expect(output.body).toEqual({ data: 1 });
    });

    it('auto-returns text from text/* content-type', async () => {
      fetchSpy = mockFetch({
        headers: { 'content-type': 'text/plain' },
        body: 'hello world',
      });
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://x.com' }), ctx);
      expect(output.body).toBe('hello world');
    });

    it('auto returns null for binary content', async () => {
      fetchSpy = mockFetch({
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array([1, 2, 3]),
      });
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://x.com' }), ctx);
      expect(output.body).toBeNull();
      // but bodyText still attempts UTF-8 decode and size is the byte count
      expect(output.size).toBe(3);
    });

    it('falls back to text on malformed JSON in auto mode', async () => {
      fetchSpy = mockFetch({
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      });
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://x.com' }), ctx);
      expect(output.body).toBe('not json');
      expect(output.bodyText).toBe('not json');
    });

    it('forces JSON parsing when response.type=json', async () => {
      fetchSpy = mockFetch({
        headers: { 'content-type': 'text/plain' },
        body: { parsed: true },
      });
      const ctx = createMockStepContext();

      const output = await step.execute(
        cfg({ url: 'https://x.com', response: { type: 'json' } }),
        ctx,
      );
      expect(output.body).toEqual({ parsed: true });
    });

    it('forces text parsing when response.type=text', async () => {
      fetchSpy = mockFetch({ body: { will: 'be stringified' } });
      const ctx = createMockStepContext();

      const output = await step.execute(
        cfg({ url: 'https://x.com', response: { type: 'text' } }),
        ctx,
      );
      expect(typeof output.body).toBe('string');
    });

    it('returns base64 when response.type=base64', async () => {
      fetchSpy = mockFetch({
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array([0x68, 0x69]), // "hi"
      });
      const ctx = createMockStepContext();

      const output = await step.execute(
        cfg({ url: 'https://x.com', response: { type: 'base64' } }),
        ctx,
      );
      expect(output.body).toBe('aGk='); // base64 of "hi"
    });

    it('returns null and empty bodyText/size=0 when response.type=discard', async () => {
      fetchSpy = mockFetch({ body: { ignored: true } });
      const ctx = createMockStepContext();

      const output = await step.execute(
        cfg({ url: 'https://x.com', response: { type: 'discard' } }),
        ctx,
      );
      expect(output.body).toBeNull();
      expect(output.bodyText).toBe('');
      expect(output.size).toBe(0);
    });
  });

  // ─── Network errors ───

  describe('execute — network errors', () => {
    it('throws on network failure', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new TypeError('fetch failed'),
      );
      const ctx = createMockStepContext();

      await expect(
        step.execute(cfg({ url: 'https://unreachable.example.com' }), ctx),
      ).rejects.toThrow('HTTP_REQUEST to https://unreachable.example.com failed: fetch failed');
    });

    it('throws on timeout', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('signal is aborted', 'AbortError'),
      );
      const ctx = createMockStepContext();

      await expect(
        step.execute(cfg({ url: 'https://slow.example.com', timeoutMs: 100 }), ctx),
      ).rejects.toThrow('timed out after 100ms');
    });

    it('refuses a redirect to the metadata address written as mapped IPv6', async () => {
      fetchSpy = mockFetch({
        status: 302,
        statusText: 'Found',
        headers: { location: 'http://[::ffff:a9fe:a9fe]/computeMetadata/v1/' },
      });
      const ctx = createMockStepContext();

      await expect(
        step.execute(cfg({ url: 'https://api.example.com/go' }), ctx),
      ).rejects.toThrow(/SSRF guard: blocked address/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Credential auth (pre-resolved by the executor) ───
  //
  // The node has no inline auth. Before execute(), the executor resolves the
  // selected credential and injects it under the declared `credentialName` slot.

  describe('execute — pre-resolved credential auth', () => {
    const ctxWith = (cred: ReturnType<typeof mockResolvedCredential>) =>
      createMockStepContext({
        credentials: { credentialName: cred },
      });

    it('applies a bearer credential', async () => {
      fetchSpy = mockFetch();
      const ctx = ctxWith(mockResolvedCredential('bearer', { token: 'vault-token' }));

      await step.execute(cfg({ url: 'https://api.example.com', credentialName: 'api' }), ctx);

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      expect(h.get('authorization')).toBe('Bearer vault-token');
    });

    it('applies a basic credential', async () => {
      fetchSpy = mockFetch();
      const ctx = ctxWith(mockResolvedCredential('basic', { username: 'u', password: 'p' }));

      await step.execute(cfg({ url: 'https://api.example.com', credentialName: 'api' }), ctx);

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      expect(h.get('authorization')).toBe(`Basic ${btoa('u:p')}`);
    });

    it('applies a custom_header credential', async () => {
      fetchSpy = mockFetch();
      const ctx = ctxWith(mockResolvedCredential('custom_header', {
        name: 'x-secret', value: 'shh',
      }));

      await step.execute(cfg({ url: 'https://api.example.com', credentialName: 'api' }), ctx);

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      expect(h.get('x-secret')).toBe('shh');
    });

    // The step follows redirects itself, so it must drop what native fetch would.
    describe('on redirect', () => {
      /** Answers the first call with a redirect to `location`, records the headers each call carried. */
      const redirectOnce = (location: string) => {
        const sent: Array<Record<string, string>> = [];
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
          sent.push(Object.fromEntries((init!.headers as Headers).entries()));
          return Promise.resolve(
            sent.length === 1
              ? new Response(null, { status: 302, headers: { location } })
              : new Response('{}', { headers: { 'content-type': 'application/json' } }),
          );
        });
        return sent;
      };

      it('drops credential and cookie headers when the redirect leaves the origin', async () => {
        const sent = redirectOnce('https://elsewhere.example.net/landing');
        const ctx = ctxWith(mockResolvedCredential('bearer', { token: 'vault-token' }));

        await step.execute(
          cfg({ url: 'https://api.example.com/go', credentialName: 'api', headers: { cookie: 'sid=1', 'x-trace': 't' } }),
          ctx,
        );

        expect(sent[0]).toMatchObject({ authorization: 'Bearer vault-token', cookie: 'sid=1' });
        expect(sent[1]).not.toHaveProperty('authorization');
        expect(sent[1]).not.toHaveProperty('cookie');
        expect(sent[1]).toMatchObject({ 'x-trace': 't' });
      });

      it('drops a custom_header credential when the redirect leaves the origin', async () => {
        const sent = redirectOnce('http://api.example.com/go'); // https → http is another origin
        const ctx = ctxWith(mockResolvedCredential('custom_header', { name: 'x-secret', value: 'shh' }));

        await step.execute(cfg({ url: 'https://api.example.com/go', credentialName: 'api' }), ctx);

        expect(sent[0]).toMatchObject({ 'x-secret': 'shh' });
        expect(sent[1]).not.toHaveProperty('x-secret');
      });

      it('keeps the credential on a same-origin redirect', async () => {
        const sent = redirectOnce('/v2/go');
        const ctx = ctxWith(mockResolvedCredential('bearer', { token: 'vault-token' }));

        await step.execute(cfg({ url: 'https://api.example.com/go', credentialName: 'api' }), ctx);

        expect(sent[1]).toMatchObject({ authorization: 'Bearer vault-token' });
      });
    });

    it('throws for the oauth2_client_credentials stub (not yet supported)', async () => {
      fetchSpy = mockFetch();
      const ctx = ctxWith(mockResolvedCredential('oauth2_client_credentials', {
        tokenUrl: 'https://auth.example.com/token', clientId: 'cid', clientSecret: 'csecret',
      }));

      await expect(
        step.execute(cfg({ url: 'https://api.example.com', credentialName: 'api' }), ctx),
      ).rejects.toThrow('oauth2_client_credentials is not yet supported');
      expect(fetchSpy!.mock.calls.length).toBe(0);
    });

    it('makes an unauthenticated request when no credential is selected', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      const output = await step.execute(cfg({ url: 'https://api.example.com' }), ctx);
      expect(output.ok).toBe(true);
      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      expect(h.get('authorization')).toBeNull();
    });

    it('managed auth wins over a conflicting user Authorization header', async () => {
      fetchSpy = mockFetch();
      const ctx = ctxWith(mockResolvedCredential('bearer', { token: 'vault-token' }));

      await step.execute(
        cfg({
          url: 'https://api.example.com',
          credentialName: 'api',
          headers: { authorization: 'Custom override' },
        }),
        ctx,
      );

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      // Credential applied LAST → overrides the user's header.
      expect(h.get('authorization')).toBe('Bearer vault-token');
    });
  });

  // ─── Custom headers ───

  describe('execute — custom headers', () => {
    it('sends user headers through when no credential is selected', async () => {
      fetchSpy = mockFetch();
      const ctx = createMockStepContext();

      await step.execute(
        cfg({
          url: 'https://api.example.com',
          headers: { 'authorization': 'Custom override', 'x-request-id': 'abc' },
        }),
        ctx,
      );

      const h = (fetchSpy!.mock.calls[0] as [string, RequestInit])[1].headers as Headers;
      // No credential → user's own headers are sent unchanged.
      expect(h.get('authorization')).toBe('Custom override');
      expect(h.get('x-request-id')).toBe('abc');
    });
  });

  // ─── redactInput ───

  describe('redactInput', () => {
    it('redacts body and auth secrets', () => {
      const redacted = step.redactInput!({
        url: 'https://api.example.com',
        method: 'POST',
        body: { mode: 'raw', raw: '{"secret":"x"}', contentType: 'json' },
        auth: { type: 'bearer', token: 'my-jwt' },
      });

      expect(redacted['url']).toBe('https://api.example.com');
      expect(redacted['body']).toBe('[REDACTED]');
      const auth = redacted['auth'] as Record<string, unknown>;
      expect(auth['type']).toBe('bearer');
      expect(auth['token']).toBe('[REDACTED]');
    });

    it('redacts password in basic auth', () => {
      const redacted = step.redactInput!({
        url: 'https://x.com',
        auth: { type: 'basic', username: 'u', password: 'secret' },
      });
      const auth = redacted['auth'] as Record<string, unknown>;
      expect(auth['username']).toBe('u');
      expect(auth['password']).toBe('[REDACTED]');
    });

    it('does not add body key when not present', () => {
      const redacted = step.redactInput!({ url: 'https://x.com', method: 'GET' });
      expect(redacted).not.toHaveProperty('body');
    });
  });

  // ─── Output schema ───

  describe('output schema', () => {
    it('validates full output', () => {
      const output = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: { 'content-type': 'application/json' },
        body: { data: [1, 2, 3] },
        bodyText: '{"data":[1,2,3]}',
        size: 17,
        duration: 150,
      };
      expect(step.outputSchema.parse(output)).toEqual(output);
    });

    it('validates output with null body', () => {
      const output = {
        status: 204, statusText: 'No Content', ok: true,
        headers: {}, body: null, bodyText: '', size: 0, duration: 50,
      };
      expect(step.outputSchema.parse(output)).toEqual(output);
    });

    it('validates output with string body', () => {
      const output = {
        status: 200, statusText: 'OK', ok: true,
        headers: {}, body: 'hello', bodyText: 'hello', size: 5, duration: 50,
      };
      expect(step.outputSchema.parse(output)).toEqual(output);
    });
  });

  // ─── resolveOutputJsonSchema ───

  describe('resolveOutputJsonSchema', () => {
    it('returns generic body schema for response.type=auto without bodySchema', () => {
      const schema = step.resolveOutputJsonSchema({ url: 'https://x.com', response: { type: 'auto' } });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['status']).toEqual({ type: 'integer' });
      expect(props['body']).toEqual({ type: 'object' });
      expect(props['bodyText']).toEqual({ type: 'string' });
      expect(props['size']).toEqual({ type: 'integer' });
    });

    it('defaults to auto generic shape when response is omitted entirely', () => {
      const schema = step.resolveOutputJsonSchema({ url: 'https://x.com' });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['body']).toEqual({ type: 'object' });
    });

    it('plugs response.bodySchema into the body field for json type', () => {
      const bodySchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: { id: { type: 'number' }, name: { type: 'string' } },
          },
        },
      };
      const schema = step.resolveOutputJsonSchema({
        url: 'https://x.com',
        response: { type: 'json', bodySchema },
      });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['body']).toEqual(bodySchema);
      expect(props['status']).toEqual({ type: 'integer' });
    });

    it('plugs response.bodySchema for auto type', () => {
      const bodySchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
      const schema = step.resolveOutputJsonSchema({
        url: 'https://x.com',
        response: { type: 'auto', bodySchema },
      });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['body']).toEqual(bodySchema);
    });

    it('types body as string for response.type=text', () => {
      const schema = step.resolveOutputJsonSchema({
        url: 'https://x.com',
        response: { type: 'text' },
      });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['body']).toEqual({ type: 'string' });
    });

    it('types body as base64-encoded string for response.type=base64', () => {
      const schema = step.resolveOutputJsonSchema({
        url: 'https://x.com',
        response: { type: 'base64' },
      });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['body']).toEqual({ type: 'string', contentEncoding: 'base64' });
    });

    it('types body as null for response.type=discard', () => {
      const schema = step.resolveOutputJsonSchema({
        url: 'https://x.com',
        response: { type: 'discard' },
      });
      const props = (schema['properties'] as Record<string, Record<string, unknown>>);
      expect(props['body']).toEqual({ type: 'null' });
    });
  });

  // ─── Invalid-state safety ───

  describe('discriminated response invariants', () => {
    it('rejects bodySchema on response.type=text (invalid state unrepresentable)', () => {
      expect(() =>
        HttpRequestStepConfigSchema.parse({
          url: 'https://x.com',
          response: { type: 'text', bodySchema: { type: 'object' } },
        }),
      ).toThrow();
    });

    it('rejects bodySchema on response.type=base64', () => {
      expect(() =>
        HttpRequestStepConfigSchema.parse({
          url: 'https://x.com',
          response: { type: 'base64', bodySchema: { type: 'object' } },
        }),
      ).toThrow();
    });

    it('rejects bodySchema on response.type=discard', () => {
      expect(() =>
        HttpRequestStepConfigSchema.parse({
          url: 'https://x.com',
          response: { type: 'discard', bodySchema: { type: 'object' } },
        }),
      ).toThrow();
    });
  });
});
