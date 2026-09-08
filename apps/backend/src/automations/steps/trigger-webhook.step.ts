import { z } from 'zod';
import { isIP } from 'node:net';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { OutputSchemaSchema } from '../engine/declared-schema';
import { decryptHeaderValue, isSensitiveHeader } from '../engine/webhook-step-encryption';
import { safeWebhookFetch } from '@/utils/ssrfGuard';
import { logger } from '@/utils/logger';

const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const TriggerWebhookConfigSchema = z.object({
  url: variableRef(
    z
      .string()
      .url()
      .refine(s => s.startsWith('https://'), { message: 'URL must use HTTPS.' })
      .refine(
        s => {
          try {
            return isIP(new URL(s).hostname) === 0;
          } catch {
            return false;
          }
        },
        { message: 'URL must use a domain name, not an IP address.' },
      ),
  ).describe('Destination URL (HTTPS, domain name).'),
  method: HttpMethod.default('POST').describe('HTTP method.'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Custom request headers as key → value pairs. Values support placeholders.'),
  secretHeaders: z
    .array(z.string())
    .optional()
    .describe(
      'Header names whose values are secrets — stored encrypted and redacted in the UI. Common auth headers are sensitive by default.',
    ),
  encoding: z.enum(['JSON', 'FORM', 'RAW']).default('JSON').describe('Request body encoding.'),
  body: variableRef(z.string())
    .optional()
    .describe('Request body. Placeholders like {{trigger.ticket.subject}} are resolved.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(10 * 60 * 1000)
    .default(10_000)
    .describe('Request timeout in milliseconds. Max 600000 (10 minutes).'),
  responseSchema: OutputSchemaSchema.default({}).describe(
    'Expected JSON shape of the response body. Declared keys surface as nested variables under responseJson for downstream steps. Leaves are "string" | "number" | "boolean" | "object" | "array".',
  ),
});

const TriggerWebhookOutputSchema = z.object({
  status: z.number(),
  ok: z.boolean(),
  responseBody: z.string(),
  responseJson: z.unknown().nullable(),
});

interface TriggerWebhookOutput extends Record<string, unknown> {
  status: number;
  ok: boolean;
  responseBody: string;
  responseJson: unknown;
}

const RESPONSE_LOG_LIMIT = 4 * 1024;

export class TriggerWebhookStep extends BaseActionStep<
  typeof TriggerWebhookConfigSchema,
  TriggerWebhookOutput
> {
  readonly type = 'TRIGGER_WEBHOOK';
  readonly configSchema = TriggerWebhookConfigSchema;
  readonly outputSchema = TriggerWebhookOutputSchema;
  readonly name = 'Trigger webhook';
  readonly description =
    'Sends an HTTP request to an external URL — notify another tool, push to an internal API, or hand off to a custom service.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Webhook';

  async execute(
    cfg: z.infer<typeof TriggerWebhookConfigSchema>,
  ): Promise<TriggerWebhookOutput> {
    const { url, method, headers, encoding, body, timeoutMs } = cfg;

    const init: RequestInit = {
      method,
      headers: this.buildHeaders(headers, encoding),
      redirect: 'manual',
    };

    if (method !== 'GET' && body !== undefined) {
      init.body = encoding === 'FORM' ? this.toFormBody(body) : (body as string);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    init.signal = controller.signal;

    let status = 0;
    let ok = false;
    let responseBody = '';

    try {
      // Validates the destination and pins the connection to the checked address
      // (rejects internal/private/link-local; rebinding-safe). redirect:'manual' above.
      const res = await safeWebhookFetch(url, init);
      status = res.status;
      ok = res.ok;

      if (status >= 300 && status < 400) {
        throw new Error(
          `[TRIGGER_WEBHOOK] ${method} ${url} returned ${status} (redirect) — redirects are disabled for SSRF safety.`,
        );
      }

      const text = await res.text();
      responseBody = text.length > RESPONSE_LOG_LIMIT
        ? `${text.slice(0, RESPONSE_LOG_LIMIT)}…[truncated ${text.length - RESPONSE_LOG_LIMIT} bytes]`
        : text;

      logger.info(
        `[automations] TRIGGER_WEBHOOK ${method} ${url} → ${status} (${responseBody.length}B)`,
      );

      if (!ok) {
        throw new Error(
          `[TRIGGER_WEBHOOK] ${method} ${url} returned ${status}: ${responseBody.slice(0, 200)}`,
        );
      }

      let responseJson: unknown = null;
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('json') || responseBody.trimStart().startsWith('{') || responseBody.trimStart().startsWith('[')) {
        try {
          responseJson = JSON.parse(responseBody);
        } catch {
          responseJson = null;
        }
      }

      return { status, ok, responseBody, responseJson };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`[TRIGGER_WEBHOOK] ${method} ${url} timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(
    headers: Record<string, string> | undefined,
    encoding: 'JSON' | 'FORM' | 'RAW',
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
      out[k] = decryptHeaderValue(v);
    }
    const hasContentType = Object.keys(out).some(k => k.toLowerCase() === 'content-type');
    if (!hasContentType) {
      if (encoding === 'JSON') out['Content-Type'] = 'application/json';
      else if (encoding === 'FORM') out['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return out;
  }

  private toFormBody(body: unknown): string {
    if (typeof body !== 'string') return '';
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const usp = new URLSearchParams();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          usp.append(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        return usp.toString();
      }
      return body;
    } catch {
      return body;
    }
  }

  redactInput(input: Record<string, unknown>): Record<string, unknown> {
    const headers = input['headers'];
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      return input;
    }
    const marked = input['secretHeaders'] as string[] | undefined;
    const redacted: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      redacted[k] = isSensitiveHeader(k, marked) ? '[REDACTED]' : String(v);
    }
    return { ...input, headers: redacted };
  }
}

export const triggerWebhookStep = new TriggerWebhookStep();
