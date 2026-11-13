/**
 * HTTP_REQUEST step — make HTTP requests to external APIs.
 *
 * Action step that uses the global `fetch` API (Node 20+). Always
 * returns the response — never throws on HTTP error status codes.
 * The consumer can branch on `ok` or `status` via a CONDITIONAL step.
 *
 * ## Body modes (Postman-aligned)
 *
 * `body` is a discriminated union by `mode`. Each mode has its own shape:
 *
 *  - `none`       — no body
 *  - `raw`        — single text payload; pick the content-type via `contentType`
 *  - `urlencoded` — `application/x-www-form-urlencoded` key/value pairs
 *  - `formdata`   — `multipart/form-data` with text fields and optional files
 *
 * Binary request bodies are out of scope for the current iteration. Multipart
 * file fields use the {@link Attachment} primitive and StorageAdapter.
 *
 * ## Auth
 *
 * The optional `credentialName` selects a stored credential from the vault.
 * Before this step runs, the executor resolves that selection and injects the
 * validated value through `ctx.credentials`. The step
 * receives the resolved value and applies it after user-provided headers, so
 * managed authentication cannot be accidentally overridden.
 *
 * ## Response shape
 *
 * The step's output IS the response:
 *
 *     { status, statusText, ok, headers, body, bodyText, size, duration }
 *
 * `body` is the parsed value per `responseType`. `bodyText` is the raw text
 * (always present, empty for `discard`). `size` is bytes received.
 *
 * The author optionally declares `responseBodySchema` (a JSON Schema). When
 * present the step's `resolveOutputJsonSchema(config)` types the `body`
 * field for downstream variable pickers; the runtime behaviour is unchanged.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import { BUILTIN_CREDENTIALS } from '../credentials.js';
import { markCredentialField } from '../../../util/credential-slot-schema.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';
import {
  applyResolvedCredentialAuth,
  CredentialNameSchema,
} from '../../../common/credentials.js';
import { AttachmentSchema, markAttachmentFields } from '../../../common/attachment.js';
import type { Attachment } from '../../../common/attachment.js';
import { variableRef } from '../../../types/workflow-config.js';
import { publicFetch } from './ssrf-guard.js';
import { multipartBody } from './multipart-body.js';
import type { MultipartFile } from './multipart-body.js';

/** Dropped when a redirect leaves the original origin. */
const CROSS_ORIGIN_STRIPPED_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

const RAW_CONTENT_TYPES = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  text: 'text/plain',
  javascript: 'application/javascript',
} as const;

export const HttpRawContentTypeSchema = z.enum([
  'json',
  'xml',
  'html',
  'text',
  'javascript',
  'custom',
]);
export type HttpRawContentType = z.infer<typeof HttpRawContentTypeSchema>;

const HttpBodyNoneSchema = z.object({ mode: z.literal('none') });

const HttpBodyRawSchema = z.object({
  mode: z.literal('raw'),
  raw: z.string().describe('Raw body content'),
  contentType: HttpRawContentTypeSchema.default('json')
    .describe('Content-Type for the raw body'),
  customContentType: z.string().optional()
    .describe('Used when contentType is "custom" (e.g. application/vnd.api+json)'),
});

const HttpBodyUrlencodedFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  enabled: z.boolean().default(true),
});

const HttpBodyUrlencodedSchema = z.object({
  mode: z.literal('urlencoded'),
  fields: z.array(HttpBodyUrlencodedFieldSchema).default([]),
});

const HttpBodyFormdataFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  enabled: z.boolean().default(true),
});

const HttpBodyFormdataFileSchema = z.object({
  key: z.string().min(1),
  value: variableRef(z.union([AttachmentSchema, z.array(AttachmentSchema)])).optional(),
  enabled: z.boolean().default(true),
});

const HttpBodyFormdataSchema = z.object({
  mode: z.literal('formdata'),
  fields: z.array(HttpBodyFormdataFieldSchema).default([]),
  files: z.array(HttpBodyFormdataFileSchema).optional(),
});

export const HttpBodySchema = z.discriminatedUnion('mode', [
  HttpBodyNoneSchema,
  HttpBodyRawSchema,
  HttpBodyUrlencodedSchema,
  HttpBodyFormdataSchema,
]);
export type HttpBody = z.infer<typeof HttpBodySchema>;

// ─── Response config (discriminated by type) ───

/**
 * Response handling. Discriminated so the optional `bodySchema` only lives on
 * the modes where it's meaningful (`json`, `auto`); a `text`/`base64`/`discard`
 * config can't accidentally carry an irrelevant schema.
 */
const HttpResponseJsonSchema = z.object({
  type: z.literal('json'),
  bodySchema: z.record(z.unknown()).optional()
    .describe('JSON Schema describing the parsed body. Drives the variable picker for downstream steps.'),
});

const HttpResponseAutoSchema = z.object({
  type: z.literal('auto'),
  bodySchema: z.record(z.unknown()).optional()
    .describe('JSON Schema describing the body when the response is JSON. Drives the variable picker for downstream steps.'),
});

// `.strict()` so a `bodySchema` accidentally left on these variants is a
// validation error instead of being silently stripped.
const HttpResponseTextSchema = z.object({ type: z.literal('text') }).strict();
const HttpResponseBase64Schema = z.object({ type: z.literal('base64') }).strict();
const HttpResponseDiscardSchema = z.object({ type: z.literal('discard') }).strict();

export const HttpResponseSchema = z.discriminatedUnion('type', [
  HttpResponseJsonSchema,
  HttpResponseAutoSchema,
  HttpResponseTextSchema,
  HttpResponseBase64Schema,
  HttpResponseDiscardSchema,
]);
export type HttpResponseConfig = z.infer<typeof HttpResponseSchema>;
export type HttpResponseType = HttpResponseConfig['type'];

// ─── Config ───

export const HttpMethodSchema = z.enum([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const HttpRequestStepConfigSchema = z.object({
  url: z.string().min(1).describe('Full URL including protocol (e.g. https://api.example.com/data)'),
  method: HttpMethodSchema.default('GET').describe('HTTP method'),
  credentialName: variableRef(
    CredentialNameSchema.describe(
      'Credential from the vault used to authenticate the request. The executor resolves it before this step runs.',
    ),
  ).optional(),
  headers: z.record(z.string(), z.string()).optional().describe('Request headers as key-value pairs'),
  queryParams: z.record(z.string(), z.string()).optional().describe('Query parameters appended to URL'),
  body: HttpBodySchema.default({ mode: 'none' }).describe('Request body — ignored for GET/HEAD. Postman-style modes: none/raw/urlencoded/formdata/binary'),
  response: HttpResponseSchema.default({ type: 'auto' })
    .describe('How to parse the response body. `bodySchema` (on json/auto) types the variable picker for downstream steps.'),
  timeoutMs: z.number().int().positive().default(30_000).describe('Request timeout in milliseconds'),
  followRedirects: z.boolean().default(true).describe('Whether to follow HTTP redirects'),
});

export type HttpRequestStepConfig = z.infer<typeof HttpRequestStepConfigSchema>;

// ─── Output ───

export interface HttpRequestStepOutput extends Record<string, unknown> {
  /** HTTP status code (e.g. 200, 404, 500). */
  status: number;
  /** Status text (e.g. "OK", "Not Found"). */
  statusText: string;
  /** Whether the status is 2xx. */
  ok: boolean;
  /** Response headers as a flat key-value map (lowercase keys). */
  headers: Record<string, string>;
  /**
   * Parsed response body. Shape depends on `responseType`:
   * - `json`    → object / array / primitive
   * - `text`    → string
   * - `base64`  → base64 string of the raw bytes
   * - `auto`    → object | string | null (detected from content-type)
   * - `discard` → null
   */
  body: unknown;
  /** Raw response body text — always present, empty for `discard`. */
  bodyText: string;
  /** Response size in bytes. */
  size: number;
  /** Request duration in milliseconds. */
  duration: number;
}

const HttpRequestStepOutputSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  ok: z.boolean(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
  bodyText: z.string(),
  size: z.number().int().nonnegative(),
  duration: z.number().nonnegative(),
});

// ─── Step ───

export class HttpRequestStep extends BaseActionStep<
  typeof HttpRequestStepConfigSchema,
  HttpRequestStepOutput
> {
  override readonly type = BuiltinStepType.HTTP_REQUEST;
  override readonly name = 'HTTP Request';
  override readonly description = 'Make HTTP requests to external APIs';
  override readonly configSchema = HttpRequestStepConfigSchema;
  override readonly outputSchema = HttpRequestStepOutputSchema;
  override readonly category: StepCategory = 'integration';
  override readonly icon = 'globe';

  // The slot name is also the config field: the executor reads the selected
  // name from `config.credentialName` and injects the resolved, validated value
  // as `ctx.credentials.credentialName` before execute() is called.
  override readonly credentialSlots = [
    { name: 'credentialName', required: false },
  ] as const;

  /**
   * Any shape its connector offers — an HTTP request calls arbitrary APIs, so
   * every auth style is legitimate here. Accepting them is not the same as
   * needing one: the slot above stays optional, because a public API takes no
   * credential at all.
   */
  override readonly credential = [...BUILTIN_CREDENTIALS];

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const rootProps = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (rootProps?.['credentialName']) {
      rootProps['credentialName'] = markCredentialField(rootProps['credentialName'], this.credential);
    }
    // The `bodySchema` field inside the discriminated `response` union should
    // render with the JSON Schema builder UI. The schema-form renderer walks
    // discriminator variants, so we tag the field within each variant that
    // carries it (json/auto).
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    const response = props?.['response'] as Record<string, unknown> | undefined;
    const variants = (response?.['anyOf'] ?? response?.['oneOf']) as Record<string, unknown>[] | undefined;
    if (variants) {
      for (const variant of variants) {
        const vProps = variant['properties'] as Record<string, Record<string, unknown>> | undefined;
        if (vProps?.['bodySchema']) {
          vProps['bodySchema'] = { ...vProps['bodySchema'], format: 'json-schema' };
        }
      }
    }
    const body = props?.['body'] as Record<string, unknown> | undefined;
    const bodyVariants = (body?.['anyOf'] ?? body?.['oneOf']) as Record<string, unknown>[] | undefined;
    const formdataVariant = bodyVariants?.find((variant) => {
      const vProps = variant['properties'] as Record<string, Record<string, unknown>> | undefined;
      return vProps?.['mode']?.['const'] === 'formdata';
    });
    const formdataProps = formdataVariant?.['properties'] as Record<string, Record<string, unknown>> | undefined;
    const filesItems = formdataProps?.['files']?.['items'] as Record<string, unknown> | undefined;
    if (filesItems) {
      markAttachmentFields(filesItems, ['value']);
    }
    return jsonSchema;
  }

  /**
   * Per-instance output schema. When the author's `response` config provides
   * a `bodySchema` (json/auto), we plug it into `body`. For other response
   * types (`text`, `base64`, `discard`) we set the body's static type since
   * no user shape is involved.
   */
  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const response = (config['response'] ?? { type: 'auto' }) as { type: HttpResponseType; bodySchema?: Record<string, unknown> };
    const bodySchema = this.outputBodySchemaFor(response);

    return {
      type: 'object',
      properties: {
        status: { type: 'integer' },
        statusText: { type: 'string' },
        ok: { type: 'boolean' },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        body: bodySchema,
        bodyText: { type: 'string' },
        size: { type: 'integer' },
        duration: { type: 'integer' },
      },
    };
  }

  private outputBodySchemaFor(
    response: { type: HttpResponseType; bodySchema?: Record<string, unknown> },
  ): Record<string, unknown> {
    switch (response.type) {
      case 'json':
      case 'auto':
        return response.bodySchema && Object.keys(response.bodySchema).length > 0
          ? response.bodySchema
          : { type: 'object' };
      case 'text':
        return { type: 'string' };
      case 'base64':
        return { type: 'string', contentEncoding: 'base64' };
      case 'discard':
        return { type: 'null' };
    }
  }

  override redactInput(input: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...input };
    // Never persist body — may contain sensitive data
    if ('body' in redacted) {
      redacted['body'] = '[REDACTED]';
    }
    // Redact auth tokens
    if (redacted['auth'] && typeof redacted['auth'] === 'object') {
      const auth = { ...(redacted['auth'] as Record<string, unknown>) };
      if ('token' in auth) auth['token'] = '[REDACTED]';
      if ('password' in auth) auth['password'] = '[REDACTED]';
      if ('key' in auth) auth['key'] = '[REDACTED]';
      if ('value' in auth) auth['value'] = '[REDACTED]';
      redacted['auth'] = auth;
    }
    return redacted;
  }

  override async execute(
    config: HttpRequestStepConfig,
    ctx: StepExecutionContext,
  ): Promise<HttpRequestStepOutput> {
    // Build URL with query params
    const url = this.buildUrl(config.url, config.queryParams);

    // Build headers: user headers FIRST, then managed credential auth LAST — so
    // a conflicting manually-entered header can't override the selected
    // credential's authentication.
    const headers = new Headers();
    if (config.headers) {
      for (const [k, v] of Object.entries(config.headers)) {
        headers.set(k, v);
      }
    }
    const credential = ctx.credentials['credentialName'];
    if (credential) {
      applyResolvedCredentialAuth(headers, credential);
    }

    // Build request. Redirects are followed manually (redirect: 'manual') so the
    // SSRF guard re-checks every hop — native 'follow' would chase a redirect
    // straight to a private / cloud-metadata address.
    const init: RequestInit = {
      method: config.method,
      headers,
      redirect: 'manual',
    };

    // Encode body for methods that support it.
    // GET/HEAD never carry a body even if the user configured one.
    if (config.body.mode !== 'none' && !['GET', 'HEAD'].includes(config.method)) {
      const encoded = await this.encodeBody(config.body, headers, ctx);
      if (encoded !== undefined) {
        init.body = encoded;
      }
    }

    // Timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    init.signal = controller.signal;

    const maxRedirects = config.followRedirects ? 5 : 0;
    const t0 = Date.now();
    let response: Response;
    try {
      let currentUrl = url.toString();
      let hops = 0;
      for (;;) {
        // SSRF guard runs on the initial URL and on every redirect target.
        response = await publicFetch(currentUrl, init);
        const location = response.headers.get('location');
        const isRedirectStatus = response.status >= 300 && response.status < 400;
        if (!isRedirectStatus || location === null || hops >= maxRedirects) break;
        hops += 1;
        const next = new URL(location, currentUrl);
        // As fetch's own redirect handling does: credentials stay with the origin they were sent to.
        if (next.origin !== new URL(currentUrl).origin) {
          for (const name of CROSS_ORIGIN_STRIPPED_HEADERS) headers.delete(name);
          if (credential?.authType === 'custom_header') headers.delete(credential.values.name);
        }
        currentUrl = next.toString();
        // A one-shot body (multipart/stream) can't be replayed on the next hop.
        if (init.body instanceof FormData || init.body instanceof ReadableStream) {
          init.body = null;
        }
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `HTTP_REQUEST to ${config.url} timed out after ${String(config.timeoutMs)}ms`,
        );
      }
      throw new Error(
        `HTTP_REQUEST to ${config.url} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    clearTimeout(timer);
    const duration = Date.now() - t0;

    // Always capture raw bytes; we then expose size, bodyText, and the
    // parsed body view in one pass.
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (config.response.type === 'discard') {
      return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: responseHeaders,
        body: null,
        bodyText: '',
        size: 0,
        duration,
      };
    }

    const rawBytes = new Uint8Array(await response.arrayBuffer());
    const size = rawBytes.byteLength;
    const bodyText = this.decodeText(rawBytes);
    const body = this.parseResponseBody(
      rawBytes,
      bodyText,
      responseHeaders,
      config.response.type,
    );

    return {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: responseHeaders,
      body,
      bodyText,
      size,
      duration,
    };
  }

  // ─── URL building ───

  private buildUrl(
    baseUrl: string,
    queryParams?: Record<string, string>,
  ): URL {
    const url = new URL(baseUrl);
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.append(k, v);
      }
    }
    return url;
  }

  // ─── Body encoding (Postman-style modes) ───

  /**
   * Encode the request body for the given mode. Mutates `headers` to set
   * the appropriate Content-Type unless the user already supplied one.
   *
   * Returns the `BodyInit` to attach (or `undefined` for empty bodies).
   */
  private async encodeBody(
    body: HttpBody,
    headers: Headers,
    ctx: StepExecutionContext,
  ): Promise<RequestInit['body'] | undefined> {
    switch (body.mode) {
      case 'none':
        return undefined;

      case 'raw': {
        if (!headers.has('content-type')) {
          const ct =
            body.contentType === 'custom'
              ? body.customContentType ?? 'application/octet-stream'
              : RAW_CONTENT_TYPES[body.contentType];
          headers.set('content-type', ct);
        }
        return body.raw;
      }

      case 'urlencoded': {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/x-www-form-urlencoded');
        }
        const params = new URLSearchParams();
        for (const f of body.fields) {
          if (f.enabled === false) continue;
          params.append(f.key, f.value);
        }
        return params.toString();
      }

      case 'formdata': {
        const fields = body.fields
          .filter((f) => f.enabled !== false)
          .map((f) => ({ key: f.key, value: f.value }));

        const files: MultipartFile[] = [];
        for (const f of body.files ?? []) {
          if (f.enabled === false) continue;
          if (f.value === undefined || f.value === null) continue;
          const attachments = (Array.isArray(f.value) ? f.value : [f.value])
            .filter((value): value is Attachment => typeof value === 'object' && value !== null);
          for (const attachment of attachments) files.push({ key: f.key, attachment });
        }

        // Built as a stream rather than a FormData, so a large attachment is
        // forwarded from storage to the wire without this process holding it.
        // That means setting the boundary ourselves, since fetch only does that
        // for a FormData it built.
        const { body: stream, contentType } = multipartBody(fields, files, (attachment) =>
          ctx.files.stream(attachment),
        );
        headers.set('content-type', contentType);
        return stream;
      }
    }
  }

  // ─── Response parsing ───

  private decodeText(bytes: Uint8Array): string {
    try {
      // strict: false → invalid utf-8 yields replacement chars instead of throwing.
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      return '';
    }
  }

  private parseResponseBody(
    bytes: Uint8Array,
    bodyText: string,
    headers: Record<string, string>,
    responseType: HttpResponseType,
  ): unknown {
    switch (responseType) {
      case 'json':
        // Throws on malformed JSON — explicit opt-in to strict parsing.
        return JSON.parse(bodyText) as unknown;
      case 'text':
        return bodyText;
      case 'base64':
        return bytesToBase64(bytes);
      case 'discard':
        return null;
      case 'auto':
        return this.autoParseBody(bodyText, headers);
    }
  }

  private autoParseBody(
    bodyText: string,
    headers: Record<string, string>,
  ): unknown {
    const ct = headers['content-type'] ?? '';
    if (ct.includes('application/json')) {
      try {
        return JSON.parse(bodyText) as unknown;
      } catch {
        return bodyText;
      }
    }
    if (ct.startsWith('text/')) {
      return bodyText;
    }
    return null;
  }
}

// ─── Helpers ───

/** Encode bytes as base64. Works in browsers and Node (no Buffer dependency). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  // btoa is global in Node 18+ and all browsers.
  return btoa(binary);
}
