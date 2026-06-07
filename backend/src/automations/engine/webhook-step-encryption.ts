import { encrypt, decrypt } from '@/services/encryptionService';
import { ControlFlowStepType } from '../types/known-types';

const ENC_PREFIX = 'enc:';
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

interface StepLike {
  type?: string;
  config?: Record<string, unknown>;
}

export function encryptWebhookStepHeaders(steps: unknown): boolean {
  if (!Array.isArray(steps)) return false;
  let changed = false;
  for (const raw of steps) {
    const step = raw as StepLike;
    if (!step || typeof step !== 'object') continue;

    if (step.type === TRIGGER_WEBHOOK_TYPE && step.config) {
      const headers = step.config['headers'];
      const marked = step.config['secretHeaders'] as string[] | undefined;
      if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
        for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
          if (typeof v !== 'string') continue;
          if (!isSensitiveHeader(k, marked)) continue;
          const enc = encryptHeaderValue(v);
          if (enc !== v) {
            (headers as Record<string, string>)[k] = enc;
            changed = true;
          }
        }
      }
    }

    if (step.type === ControlFlowStepType.CONDITIONAL && step.config) {
      if (encryptWebhookStepHeaders(step.config['if_true'])) changed = true;
      if (encryptWebhookStepHeaders(step.config['if_false'])) changed = true;
    }

    if (step.type === ControlFlowStepType.SWITCH && step.config) {
      const cases = step.config['cases'];
      if (Array.isArray(cases)) {
        for (const c of cases) {
          if (c && typeof c === 'object' && 'steps' in c) {
            if (encryptWebhookStepHeaders((c as { steps: unknown }).steps)) changed = true;
          }
        }
      }
      if (encryptWebhookStepHeaders(step.config['default'])) changed = true;
    }
  }
  return changed;
}
