import { z } from 'zod';
import { marked } from 'marked';
import type { AutomationContext } from '../types/context';
import { tokenize, isPureRef, extractRefPath } from '../util/variable-ref';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function resolvePath(context: AutomationContext, path: string): unknown {
  const segments = path.split('.');
  if (segments.length === 0) return undefined;
  if (segments.some(s => FORBIDDEN_KEYS.has(s))) return undefined;

  const head = segments[0];
  if (head === undefined) return undefined;
  let current: unknown;
  let rest: string[];
  if (head === 'trigger' || head === 'automation') {
    current = (context as unknown as Record<string, unknown>)[head];
    rest = segments.slice(1);
  } else {
    current = context.steps[head];
    rest = segments.slice(1);
  }

  for (const segment of rest) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export class VariableResolver {
  resolve(value: unknown, context: AutomationContext): unknown {
    if (typeof value === 'string') {
      return this.resolveString(value, context);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolve(item, context));
    }

    if (value !== null && typeof value === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        resolved[k] = this.resolve(v, context);
      }
      return resolved;
    }

    return value;
  }

  resolveString(value: string, context: AutomationContext): unknown {
    if (!value.includes('{{')) {
      return value;
    }

    if (isPureRef(value)) {
      const path = extractRefPath(value);
      if (path === null) return value;
      return resolvePath(context, path);
    }

    const tokens = tokenize(value);
    return tokens
      .map((token, i) => {
        if (token.kind === 'literal') return token.text;
        const resolved = resolvePath(context, token.path);
        return isRichTextSlot(tokens[i - 1])
          ? markdownToHtml(stringifyForTemplate(resolved))
          : stringifyForTemplate(resolved);
      })
      .join('');
  }
}

const RICH_TEXT_SPAN_TAIL = /<span\b[^>]*\bdata-variable-ref\b[^>]*>[\s\u200B]*$/i;
const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>/i;
const MARKED_OPTIONS = { async: false, gfm: true, breaks: true } as const;

function isRichTextSlot(prev: { kind: string; text?: string } | undefined): boolean {
  return prev?.kind === 'literal' && RICH_TEXT_SPAN_TAIL.test(prev.text ?? '');
}

function markdownToHtml(text: string): string {
  if (!text || LOOKS_LIKE_HTML.test(text)) return text;
  try {
    const html = text.includes('\n')
      ? marked.parse(text, MARKED_OPTIONS)
      : marked.parseInline(text, MARKED_OPTIONS);
    return (html as string).trim();
  } catch {
    return text;
  }
}

function stringifyForTemplate(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return typeof value === 'string' ? value : String(value);
}

export const variableResolver = new VariableResolver();

export function stripNullForOptionalKeys(
  resolved: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  if (!(schema instanceof z.ZodObject)) return resolved;
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const result: Record<string, unknown> = { ...resolved };
  for (const key of Object.keys(result)) {
    if (result[key] !== null) continue;
    const field = shape[key];
    if (!field) continue;
    if (!field.safeParse(null).success && field.safeParse(undefined).success) {
      delete result[key];
    }
  }
  return result;
}
