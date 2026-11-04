import { createHmac, timingSafeEqual } from 'node:crypto';
import { encrypt, decrypt } from '@/services/encryptionService';
import { config as appConfig } from '@/config/env';
import { ControlFlowStepType } from '../types/known-types';

const ENC_PREFIX = 'enc:';
const SEALED_PREFIX = 'enc2:';
const TRIGGER_WEBHOOK_TYPE = 'TRIGGER_WEBHOOK';

export const DEFAULT_SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-secret',
  'x-webhook-secret',
]);

export function isSensitiveHeader(name: string, marked: string[] | undefined): boolean {
  const lower = name.toLowerCase();
  if (DEFAULT_SENSITIVE_HEADERS.has(lower)) return true;
  return (marked ?? []).some(h => h.toLowerCase() === lower);
}

function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export function encryptHeaderValue(value: string): string {
  if (typeof value !== 'string') return value;
  if (isEncrypted(value)) return value;
  if (value.includes('{{')) return value;
  if (value.length === 0) return value;
  return ENC_PREFIX + encrypt(value);
}

export function decryptHeaderValue(value: string): string {
  if (typeof value !== 'string' || !isEncrypted(value)) return value;
  try {
    return decrypt(value.slice(ENC_PREFIX.length));
  } catch {
    return value;
  }
}

export function decryptWebhookHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = decryptHeaderValue(v);
  return out;
}

export class WebhookSecretHeaderError extends Error {}

export interface HeaderBinding {
  seriesId: string;
  header: string;
  url: string;
}

function bindingMac(binding: HeaderBinding, ciphertext: string): Buffer {
  const key = createHmac('sha256', String(appConfig.encryptionKey))
    .update('automations/webhook-header-binding/v1')
    .digest();
  return createHmac('sha256', key)
    .update(`${binding.seriesId}\n${binding.header.toLowerCase()}\n${binding.url}\n${ciphertext}`)
    .digest();
}

export function isSealedHeaderValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

export function isLegacyEncryptedHeaderValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function sealHeaderValue(value: string, binding: HeaderBinding): string {
  const ciphertext = encrypt(value);
  return `${SEALED_PREFIX}${ciphertext}.${bindingMac(binding, ciphertext).toString('base64url')}`;
}

export function openSealedHeaderValue(value: string, binding: HeaderBinding): string {
  const body = value.slice(SEALED_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) throw new WebhookSecretHeaderError(`Secret header "${binding.header}" is malformed; re-enter it.`);
  const ciphertext = body.slice(0, dot);
  const given = Buffer.from(body.slice(dot + 1), 'base64url');
  const expected = bindingMac(binding, ciphertext);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new WebhookSecretHeaderError(
      `Secret header "${binding.header}" was not saved for this automation and URL; re-enter it.`,
    );
  }
  return decrypt(ciphertext);
}

export function hasLiteralHttpsOrigin(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const m = /^https:\/\/([^/?#]*)/i.exec(url);
  return !!m && m[1] !== undefined && m[1].length > 0 && !m[1].includes('{{');
}

interface StepLike {
  type?: string;
  config?: Record<string, unknown>;
}

/**
 * Seals plaintext secret header values on TRIGGER_WEBHOOK steps, bound to the automation
 * series, the header name and the raw URL. Already-sealed values must carry a valid binding
 * for this series and URL; legacy `enc:` values and foreign ciphertext are refused.
 */
export function encryptWebhookStepHeaders(steps: unknown, seriesId: string): boolean {
  if (!Array.isArray(steps)) return false;
  let changed = false;
  for (const raw of steps) {
    const step = raw as StepLike;
    if (!step || typeof step !== 'object') continue;

    if (step.type === TRIGGER_WEBHOOK_TYPE && step.config) {
      const headers = step.config['headers'];
      const marked = step.config['secretHeaders'] as string[] | undefined;
      const url = step.config['url'];
      if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
        for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
          if (typeof v !== 'string' || v.length === 0) continue;
          if (!isSensitiveHeader(k, marked)) continue;
          if (v.includes('{{')) continue;
          if (!hasLiteralHttpsOrigin(url)) {
            throw new WebhookSecretHeaderError(
              `Webhook steps with secret header "${k}" must use a fixed https host, not a placeholder.`,
            );
          }
          const binding = { seriesId, header: k, url: url as string };
          if (isSealedHeaderValue(v)) {
            openSealedHeaderValue(v, binding);
            continue;
          }
          if (isLegacyEncryptedHeaderValue(v)) {
            throw new WebhookSecretHeaderError(`Secret header "${k}" must be re-entered.`);
          }
          (headers as Record<string, string>)[k] = sealHeaderValue(v, binding);
          changed = true;
        }
      }
    }

    if (step.type === ControlFlowStepType.CONDITIONAL && step.config) {
      if (encryptWebhookStepHeaders(step.config['if_true'], seriesId)) changed = true;
      if (encryptWebhookStepHeaders(step.config['if_false'], seriesId)) changed = true;
    }

    if (step.type === ControlFlowStepType.SWITCH && step.config) {
      const cases = step.config['cases'];
      if (Array.isArray(cases)) {
        for (const c of cases) {
          if (c && typeof c === 'object' && 'steps' in c) {
            if (encryptWebhookStepHeaders((c as { steps: unknown }).steps, seriesId)) changed = true;
          }
        }
      }
      if (encryptWebhookStepHeaders(step.config['default'], seriesId)) changed = true;
    }
  }
  return changed;
}

/**
 * Runtime: decrypts only header values that were sealed in the stored (pre-resolution) step
 * config for this series. Values produced by variable resolution are never decrypted.
 */
export function openStepSecretHeaders(
  rawConfig: Record<string, unknown>,
  resolvedHeaders: Record<string, string> | undefined,
  seriesId: string,
): Record<string, string> | undefined {
  const rawHeaders = rawConfig['headers'];
  if (!resolvedHeaders || !rawHeaders || typeof rawHeaders !== 'object') return resolvedHeaders;
  const out = { ...resolvedHeaders };
  for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (isLegacyEncryptedHeaderValue(v)) {
      throw new WebhookSecretHeaderError(`Secret header "${k}" must be re-entered.`);
    }
    if (!isSealedHeaderValue(v)) continue;
    if (!hasLiteralHttpsOrigin(rawConfig['url'])) {
      throw new WebhookSecretHeaderError(`Secret header "${k}" requires a fixed https host.`);
    }
    out[k] = openSealedHeaderValue(v, { seriesId, header: k, url: rawConfig['url'] as string });
  }
  return out;
}
