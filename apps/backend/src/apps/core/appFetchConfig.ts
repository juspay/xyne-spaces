/**
 * App Desk history pull configuration.
 *
 * Deliberately the same shape as the automations TRIGGER_WEBHOOK step
 * (automations/steps/trigger-webhook.step.ts) — same field names, same
 * semantics, same header-secret handling — so the dashboard reuses that step's
 * form verbatim and there is one webhook-configuring pattern in the product
 * rather than two. Fields that only mean something to an automation
 * (`responseSchema`, which feeds downstream steps) are simply absent, and Zod
 * strips them if the shared form emits them.
 *
 * Stored as JSON text in `installed_apps.fetchConfig`, which mirrors how
 * automations store their steps: `encryptWebhookStepHeaders` then
 * `JSON.stringify` into `workflows.context` (a Zero-synced string column).
 * Sensitive header values are `enc:`-encrypted at rest by the same helpers.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { tokenize } from '@xyne/shared/automations/variable-ref';
import {
  decryptWebhookHeaders,
  encryptHeaderValue,
  isSensitiveHeader,
} from '@/automations/engine/webhook-step-encryption';
import { buildWebhookHeaders, toWebhookFormBody } from '@/automations/engine/webhook-request';
import { buildSignedAppRequestHeaders } from './webhookRequestSigner';

/** Path suggested when an install has no config yet. */
export const DEFAULT_EXPORT_PATH = '/export/messages';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_PAGE_SIZE = 50;

const MAX_URL_LENGTH = 2_048;
const MAX_BODY_LENGTH = 64 * 1024;
const MAX_HEADERS = 50;
const MAX_HEADER_NAME_LENGTH = 256;
const MAX_HEADER_VALUE_LENGTH = 8 * 1024;

/**
 * Headers Xyne sets itself. A config may not carry any of them under ANY
 * casing: header names are case-insensitive, and undici's Headers *combines*
 * same-name entries rather than replacing them, so a stored
 * `x-xyne-request-signature` and our `X-Xyne-Request-Signature` are sent as
 * `junk, realsig` — enough to break verification for the install, or to hand a
 * verifier that reads the first value an attacker-chosen signature.
 */
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'x-xyne-timestamp',
  'x-xyne-request-signature',
  'x-xyne-signature',
  'x-source',
  'content-type',
  'content-length',
  'host',
  'accept',
]);

/**
 * Reading history is a GET; POST exists because a body is easier to template
 * than a query string. PUT, PATCH and DELETE are deliberately not offered —
 * they mean "change this resource", which an export never does, and a DELETE
 * aimed at a mistyped URL would issue a signed destructive request against the
 * app once per page. Narrower than the automations step's list on purpose: that
 * one calls arbitrary APIs, this one only reads.
 */
const HttpMethod = z.enum(['GET', 'POST']);
export type AppFetchMethod = z.infer<typeof HttpMethod>;

/**
 * How to read the app's response.
 *
 * Without this every app would have to return Xyne's exact envelope and field
 * names. Apps generally have an existing export endpoint with its own shape, so
 * the config describes that shape instead of asking them to change it.
 *
 * Every path is dot-separated and resolved against the item; `''` for
 * `messagesPath` means the response is a bare array.
 */
export const AppFetchResponseMappingSchema = z.object({
  /** Path to the message array. Empty means the response itself is the array. */
  messagesPath: z.string().default(''),
  /** Path to the continuation token. Only read in `cursor` pagination. */
  nextCursorPath: z.string().default('nextCursor'),
  /** Where each of Xyne's message fields lives on the app's item. */
  fields: z
    .object({
      externalId: z.string().default('externalId'),
      externalThreadId: z.string().default('externalThreadId'),
      subject: z.string().default('subject'),
      body: z.string().default('body'),
      senderEmail: z.string().default('sender.email'),
      senderName: z.string().default('sender.name'),
      recipients: z.string().default('recipients'),
      sentAt: z.string().default('sentAt'),
    })
    .default({}),
  /**
   * Paths combined into the dedup id, joined with `|`.
   *
   * An app's own id is not always unique on its own: a canned or auto-reply
   * message legitimately carries its *template* id, so the same value appears on
   * every ticket that used it. Xyne dedups on (source, externalId), so such an
   * id alone would discard every later copy. Listing the fields that are jointly
   * unique — typically thread, id and timestamp — makes the key meaningful
   * without asking the app to change its ids.
   *
   * Empty uses `fields.externalId` alone.
   */
  idFields: z.array(z.string()).default([]),
});

export type AppFetchResponseMapping = z.infer<typeof AppFetchResponseMappingSchema>;

export const AppFetchConfigSchema = z.object({
  /**
   * Absolute URL of the app's export endpoint; may contain `{{...}}` refs.
   * Validated only as a URL — SSRF checks belong at dispatch
   * (prepareAppWebhookDispatch + safeWebhookFetch), which is also where
   * INTERNAL_APP_HOST_MAP rewriting happens, so requiring https here would break
   * internal pod hosts that legitimately use http.
   */
  url: z.string().min(1, 'A fetch URL is required').max(MAX_URL_LENGTH),
  method: HttpMethod.default('POST'),
  headers: z.record(z.string().max(MAX_HEADER_VALUE_LENGTH)).optional(),
  secretHeaders: z.array(z.string().max(MAX_HEADER_NAME_LENGTH)).max(MAX_HEADERS).optional(),
  encoding: z.enum(['JSON', 'FORM', 'RAW']).default('JSON'),
  /** Request body; `{{...}}` refs are resolved. Not sent for GET. */
  body: z.string().max(MAX_BODY_LENGTH).optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(10 * 60 * 1000)
    .default(DEFAULT_TIMEOUT_MS),
  /**
   * How the app paginates.
   *
   * `cursor` — the app returns an opaque `nextCursor` and we echo it back. The
   * app decides when the export ends by omitting it.
   *
   * `offset` — the app takes numeric `offset`/`limit` and returns a plain page
   * with no continuation token. We advance the offset ourselves and stop on an
   * empty page, so the app needs no extra state. Note that some apps count
   * `limit` in threads rather than messages; that is fine, the offset advances
   * in whatever unit the app paginates by.
   */
  pagination: z.enum(['cursor', 'offset']).default('cursor'),
  /**
   * Page size for `offset` pagination — rendered as `{{fetch.limit}}` and used
   * as the offset increment, so it must match what the app is sent. Ignored in
   * `cursor` mode, where the app controls page size.
   */
  pageSize: z.number().int().positive().max(1_000).default(DEFAULT_PAGE_SIZE),
  response: AppFetchResponseMappingSchema.default({}),
})
  .superRefine((cfg, ctx) => {
    for (const name of Object.keys(cfg.headers ?? {})) {
      if (RESERVED_HEADERS.has(name.trim().toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headers', name],
          message: `"${name}" is set by Xyne and cannot be overridden`,
        });
      }
    }
    if (Object.keys(cfg.headers ?? {}).length > MAX_HEADERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headers'],
        message: `At most ${MAX_HEADERS} headers`,
      });
    }

    const templated = `${cfg.url}\n${cfg.body ?? ''}`;
    // Offset pagination advances a counter the app never sees unless the
    // template sends it. Without this a config paginates forever over page one,
    // re-ingesting it until the run budget expires, and reports success.
    if (cfg.pagination === 'offset' && !templated.includes('{{fetch.offset}}')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message:
          'Offset pagination requires {{fetch.offset}} in the URL or body, otherwise every page repeats the first',
      });
    }
    // Without a window the app returns its entire history, so a one-week
    // request silently backfills everything. Xyne cannot filter afterwards —
    // ingest does not look at sentAt.
    for (const bound of ['startDate', 'endDate'] as const) {
      if (!templated.includes(`{{fetch.${bound}}}`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['url'],
          message:
            `The request must include {{fetch.${bound}}}, or the app decides the range instead of the person who asked for it`,
        });
      }
    }
  });

export type AppFetchConfig = z.infer<typeof AppFetchConfigSchema>;

/**
 * Everything a config may reference. Flat and explicit: an app author reads this
 * to know what can be interpolated, and anything absent resolves to empty rather
 * than leaking unrelated state into an outbound request.
 *
 * There is deliberately no page-size variable — the body carries whatever limit
 * the app wants as a literal, exactly as an automation's body would.
 */
export interface AppFetchVariables {
  fetch: {
    startDate: string;
    endDate: string;
    /** Empty on the first page. `cursor` pagination only. */
    cursor: string;
    /** Rows already requested. `offset` pagination only. */
    offset: number;
    /** Page size, from the config. `offset` pagination only. */
    limit: number;
  };
  channel: { id: string; name: string };
  source: { id: string };
  installedApp: { id: string };
  app: { id: string };
  workspace: { id: string };
}

export class AppFetchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppFetchConfigError';
  }
}

/** Default an install starts from, offered by the config UI as a prefill. */
export function buildDefaultFetchConfig(webhookUrl: string): AppFetchConfig {
  const base = new URL(webhookUrl);
  base.search = '';
  base.hash = '';
  return AppFetchConfigSchema.parse({
    url: `${base.toString().replace(/\/+$/, '')}${DEFAULT_EXPORT_PATH}`,
    method: 'POST',
    body: [
      '{',
      '  "startDate": "{{fetch.startDate}}",',
      '  "endDate": "{{fetch.endDate}}",',
      '  "cursor": "{{fetch.cursor}}",',
      '  "channelId": "{{channel.id}}",',
      '  "sourceId": "{{source.id}}",',
      '  "installedAppId": "{{installedApp.id}}"',
      '}',
    ].join('\n'),
  });
}

/**
 * Validate and decode a stored config. `label` names the install in the error so
 * an operator can tell which app is misconfigured from the message alone.
 */
export function parseFetchConfig(raw: string | null | undefined, label: string): AppFetchConfig {
  if (!raw?.trim()) {
    throw new AppFetchConfigError(
      `${label} has no history fetch configuration — configure it on the app's Installed screen before fetching`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new AppFetchConfigError(`${label} has a corrupt history fetch configuration (not valid JSON)`);
  }
  const result = AppFetchConfigSchema.safeParse(decoded);
  if (!result.success) {
    const detail = result.error.issues
      .map(i => `${i.path.join('.') || 'config'}: ${i.message}`)
      .join('; ');
    throw new AppFetchConfigError(`${label} has an invalid history fetch configuration — ${detail}`);
  }
  return result.data;
}

/**
 * Encrypt sensitive header values before storing, the way
 * `encryptWebhookStepHeaders` does for an automation's steps. Values holding a
 * `{{...}}` ref are left alone so they stay resolvable.
 */
export function serializeFetchConfig(config: AppFetchConfig): string {
  const headers = config.headers
    ? Object.fromEntries(
        Object.entries(config.headers).map(([name, value]) => [
          name,
          isSensitiveHeader(name, config.secretHeaders) ? encryptHeaderValue(value) : value,
        ]),
      )
    : undefined;
  return JSON.stringify({ ...config, ...(headers && { headers }) });
}

/** Placeholder shown in place of a stored secret header value. */
export const REDACTED_HEADER_VALUE = '••••••••';

/** Auth schemes whose prefix survives redaction — see redactHeaderValue. */
const AUTH_SCHEMES = ['Bearer', 'Basic'] as const;

function redactHeaderValue(decrypted: string | null): string {
  const scheme = AUTH_SCHEMES.find(s => decrypted?.startsWith(`${s} `));
  return scheme ? `${scheme} ${REDACTED_HEADER_VALUE}` : REDACTED_HEADER_VALUE;
}

/** True when a value coming back from the form is still the mask, not a retyped secret. */
export function isRedactedValue(value: string): boolean {
  return (
    value === REDACTED_HEADER_VALUE ||
    AUTH_SCHEMES.some(s => value === `${s} ${REDACTED_HEADER_VALUE}`)
  );
}

/** Redact secret header values for display; the plaintext never leaves the server. */
export function redactFetchConfig(config: AppFetchConfig): AppFetchConfig {
  if (!config.headers) return config;
  return {
    ...config,
    headers: Object.fromEntries(
      Object.entries(config.headers).map(([name, value]) => {
        if (!isSensitiveHeader(name, config.secretHeaders) || !value.startsWith('enc:')) {
          return [name, value];
        }
        let decrypted: string | null = null;
        try {
          decrypted = decryptWebhookHeaders({ [name]: value })?.[name] ?? null;
        } catch {
          decrypted = null;
        }
        return [name, redactHeaderValue(decrypted)];
      }),
    ),
  };
}

/**
 * Carry stored secrets across a save.
 *
 * The form is served redacted values, so an admin who edits the URL and saves
 * would otherwise write the mask back over the real credential. Any header whose
 * incoming value is still the placeholder keeps whatever is stored; a header the
 * admin actually retyped overwrites it.
 */
export function preserveRedactedSecrets(
  incoming: AppFetchConfig,
  storedRaw: string | null | undefined,
): AppFetchConfig {
  if (!incoming.headers || !storedRaw) return incoming;
  // The placeholder is only honoured when the destination is unchanged..
  let storedUrl: string | undefined;
  let storedUrlHost: string | null = null;
  let incomingUrlHost: string | null = null;
  try {
    storedUrl = (JSON.parse(storedRaw) as { url?: string }).url;
    storedUrlHost = new URL(storedUrl ?? '').host;
    incomingUrlHost = new URL(incoming.url).host;
  } catch {
    // A templated URL cannot be parsed; fall back to exact string equality.
  }
  const sameDestination =
    storedUrlHost !== null && incomingUrlHost !== null
      ? storedUrlHost === incomingUrlHost
      : storedUrl !== undefined && storedUrl === incoming.url;
  if (!sameDestination) {
    return {
      ...incoming,
      headers: Object.fromEntries(
        Object.entries(incoming.headers).filter(([, v]) => !isRedactedValue(v)),
      ),
    };
  }
  const masked = Object.entries(incoming.headers).filter(([, value]) => isRedactedValue(value));
  if (masked.length === 0) return incoming;

  let stored: AppFetchConfig;
  try {
    stored = AppFetchConfigSchema.parse(JSON.parse(storedRaw));
  } catch {
    // Nothing trustworthy to carry over; the mask is dropped rather than stored.
    return {
      ...incoming,
      headers: Object.fromEntries(
        Object.entries(incoming.headers).filter(([, v]) => !isRedactedValue(v)),
      ),
    };
  }

  const headers = { ...incoming.headers };
  for (const [name] of masked) {
    const previous = stored.headers?.[name];
    if (previous === undefined) delete headers[name];
    else headers[name] = previous;
  }
  return { ...incoming, headers };
}

/** Resolve a dotted path against the variable bag. Own-property walk only. */
function resolvePath(vars: AppFetchVariables, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = vars;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * How a substituted value must be escaped for the context it lands in.
 *
 * Only the *values* are escaped, never the surrounding template text — the
 * template's own quotes, ampersands and separators are structure the author
 * wrote deliberately.
 */
export type RenderEscape = 'none' | 'json' | 'url' | 'header';

function escapeValue(raw: string, mode: RenderEscape): string {
  switch (mode) {
    // A channel named `Support "EU"` would otherwise close the JSON string and
    // produce a body the app rejects as malformed.
    case 'json':
      return JSON.stringify(raw).slice(1, -1);
    // A cursor containing `+` or `&` would otherwise arrive corrupted, and its
    // `&` would inject extra query parameters into a request we then sign.
    case 'url':
      return encodeURIComponent(raw);
    // CR/LF in a header value is header injection.
    case 'header':
      return raw.replace(/[\r\n]+/g, ' ');
    default:
      return raw;
  }
}

/**
 * Interpolate `{{...}}` refs in a template string. An unresolved ref renders
 * empty, matching how the automations resolver treats a missing variable — so
 * `{{fetch.cursor}}` yields `""` on the first page and apps must read an empty
 * cursor as "start from the beginning".
 *
 * `escape` must match where the result is going; see RenderEscape. Values come
 * from channel names and app-supplied cursors, so none of them can be assumed
 * safe for the syntax they are being pasted into.
 */
export function renderTemplate(
  template: string,
  vars: AppFetchVariables,
  escape: RenderEscape = 'none',
): string {
  if (!template.includes('{{')) return template;
  return tokenize(template)
    .map(token => {
      if (token.kind === 'literal') return token.text;
      const resolved = resolvePath(vars, token.path);
      const value = resolved === undefined || resolved === null ? '' : String(resolved);
      return escapeValue(value, escape);
    })
    .join('');
}

/** Resolve a dot-separated path against an arbitrary decoded JSON value. */
function readPath(source: unknown, path: string): unknown {
  if (!path) return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readString(source: unknown, path: string): string | undefined {
  const value = readPath(source, path);
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Translate one page of the app's response into Xyne's export shape.
 *
 * Throws AppFetchConfigError with the offending path named, because the most
 * common failure here is a mapping that points at a field the app does not
 * actually send — and "missing messages array" alone is not enough to fix it.
 */
export function mapExportPage(
  raw: unknown,
  mapping: AppFetchResponseMapping,
  pagination: 'cursor' | 'offset',
): { messages: MappedExportMessage[]; invalidRows: string[]; nextCursor?: string } {
  const rows = readPath(raw, mapping.messagesPath);
  if (!Array.isArray(rows)) {
    const where = mapping.messagesPath
      ? `path "${mapping.messagesPath}"`
      : 'the response root';
    throw new AppFetchConfigError(
      `expected an array of messages at ${where}, got ${
        rows === undefined ? 'nothing' : typeof rows
      }`,
    );
  }

  const messages: MappedExportMessage[] = [];
  const invalidRows: string[] = [];
  const f = mapping.fields;

  rows.forEach((row, index) => {
    const sentAt = readString(row, f.sentAt);
    if (!sentAt) {
      invalidRows.push(`row ${index}: no timestamp at "${f.sentAt}"`);
      return;
    }

    // Every listed dedup path must resolve.
    let id: string | undefined;
    if (mapping.idFields.length > 0) {
      const missing = mapping.idFields.filter(path => !readString(row, path));
      if (missing.length > 0) {
        invalidRows.push(
          `row ${index}: dedup key incomplete — no value at ${missing
            .map(path => `"${path}"`)
            .join(', ')}`,
        );
        return;
      }
      id = mapping.idFields.map(path => readString(row, path)).join('|');
    } else {
      id = readString(row, f.externalId);
    }
    if (!id) {
      invalidRows.push(`row ${index}: no id at "${f.externalId}"`);
      return;
    }

    const recipients = readPath(row, f.recipients);
    messages.push({
      externalId: id,
      externalThreadId: readString(row, f.externalThreadId),
      subject: readString(row, f.subject),
      body: readString(row, f.body) ?? '',
      sender: {
        email: readString(row, f.senderEmail) ?? '',
        name: readString(row, f.senderName),
      },
      recipients: Array.isArray(recipients)
        ? recipients.filter((r): r is string => typeof r === 'string')
        : undefined,
      sentAt,
    });
  });

  // A page where nothing mapped is a mapping error
  if (rows.length > 0 && messages.length === 0) {
    throw new AppFetchConfigError(
      `no row on this page could be mapped — ${invalidRows.slice(0, 3).join('; ')}`,
    );
  }

  // Offset pagination has no continuation token — the caller advances the
  // offset itself and stops on an empty page.
  const nextCursor =
    pagination === 'cursor' ? readString(raw, mapping.nextCursorPath) : undefined;
  return { messages, invalidRows, ...(nextCursor && { nextCursor }) };
}

/** Xyne's message shape, as produced by the mapping. */
export interface MappedExportMessage {
  externalId: string;
  externalThreadId?: string;
  subject?: string;
  body: string;
  sender: { email: string; name?: string };
  recipients?: string[];
  sentAt: string;
}

export interface SignedFetchRequest {
  url: string;
  init: RequestInit;
}

/**
 * Build one signed export request.
 *
 * The signature covers the rendered body as well as the method and path — see
 * webhookRequestSigner. Binding the body matters here because the body carries
 * the channel and the date window: signing only the path would let a captured
 * request be replayed against a different channel within the skew window.
 *
 * Xyne's own headers are applied last
 * header names are case-insensitive and undici combines same-name entries, so a
 * stored `x-xyne-request-signature` would be sent alongside ours as
 * `junk, realsig`. Reserved names are therefore rejected by the schema
 * (RESERVED_HEADERS).
 *
 * Returns the URL and init separately; dispatching (host rewriting, SSRF guard)
 * stays with the caller, which already owns that policy.
 */
export function buildSignedFetchRequest(params: {
  config: AppFetchConfig;
  vars: AppFetchVariables;
  signingSecret: string;
}): SignedFetchRequest {
  const { config, vars, signingSecret } = params;

  // Query values are percent-encoded; the template's own separators are not.
  const renderedUrl = renderTemplate(config.url, vars, 'url');
  let url: URL;
  try {
    url = new URL(renderedUrl);
  } catch {
    throw new AppFetchConfigError(`history fetch URL is not a valid URL: ${renderedUrl}`);
  }

  // GET carries no body — an app that wants the window in the query string puts
  // the refs in the URL, exactly as a TRIGGER_WEBHOOK step would.
  const isBodyless = config.method === 'GET';
  let body: string | undefined;
  if (!isBodyless && config.body !== undefined) {
    // FORM is JSON-escaped too: toWebhookFormBody parses the rendered body as
    // JSON before form-encoding it, so an unescaped quote breaks it there.
    // RAW is the author's own syntax, so it is left alone.
    const rendered = renderTemplate(config.body, vars, config.encoding === 'RAW' ? 'none' : 'json');
    body = config.encoding === 'FORM' ? toWebhookFormBody(rendered) : rendered;
  }

  // Decryption and the Content-Type default are the automations step's, shared
  // rather than reimplemented. Only a request that carries a body gets a
  // Content-Type, so a GET is not given one it does not need.
  const base =
    body !== undefined
      ? buildWebhookHeaders(config.headers, config.encoding)
      : (decryptWebhookHeaders(config.headers) ?? {});
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    headers[name] = renderTemplate(value, vars, 'header');
  }
  headers['Accept'] = 'application/json';

  Object.assign(
    headers,
    buildSignedAppRequestHeaders({
      signingSecret,
      method: config.method,
      pathWithQuery: `${url.pathname}${url.search}`,
      bodyHash: sha256Hex(body ?? ''),
    }),
  );

  return {
    url: url.toString(),
    init: {
      method: config.method,
      headers,
      ...(body !== undefined && { body }),
      redirect: 'manual',
    },
  };
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
