import { z } from 'zod';
import { marked } from 'marked';
import type { AutomationContext } from '../types/context';
import { tokenize, isPureRef, extractRefPath } from '../util/variable-ref';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function resolveAutomationPath(context: AutomationContext, path: string): unknown {
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
      return resolveAutomationPath(context, path);
    }

    const tokens = tokenize(value);
    let result = '';
    let stripNextSpanClose = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === 'literal') {
        result += stripNextSpanClose ? stripLeadingSpanClose(token.text) : token.text;
        stripNextSpanClose = false;
        continue;
      }

      if (!isRichTextSlot(tokens[i - 1])) {
        result += stringifyForTemplate(resolveAutomationPath(context, token.path));
        continue;
      }

      const refs = resolveEntityRefs(token.path, context);
      if (refs && refs.length > 0) {
        result = stripTrailingVariableRefSpanOpen(result) + refs.map(spanForRef).join(' ');
        stripNextSpanClose = true;
        continue;
      }

      result += markdownToHtml(stringifyForTemplate(resolveAutomationPath(context, token.path)));
    }
    return result;
  }
}

const RICH_TEXT_SPAN_TAIL = /<span\b[^>]*\bdata-variable-ref\b[^>]*>[\s\u200B]*$/i;
const SPAN_CLOSE_LEAD = /^[\s\u200B]*<\/span>/i;
const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>/i;
const MARKED_OPTIONS = { async: false, gfm: true, breaks: true } as const;

function isRichTextSlot(prev: { kind: string; text?: string } | undefined): boolean {
  return prev?.kind === 'literal' && RICH_TEXT_SPAN_TAIL.test(prev.text ?? '');
}

function stripTrailingVariableRefSpanOpen(text: string): string {
  return text.replace(RICH_TEXT_SPAN_TAIL, '');
}

function stripLeadingSpanClose(text: string): string {
  return text.replace(SPAN_CLOSE_LEAD, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Automation variable paths that refer to a user / channel / user group, so
// their resolved value can be rendered as a real mention span instead of raw
// text/ids. Keys are field names that actually appear in trigger/step output
// schemas (see ../triggers/*.ts and ../steps/*.ts): "object" fields hold
// {id,name,email} and are matched on their .id/.name/.email leaf, "id"
// fields hold a bare id string and are matched directly.
type MentionKind = 'user' | 'channel' | 'userGroup';
type FieldShape = 'object' | 'id';
interface EntityField {
  kind: MentionKind;
  shape: FieldShape;
}

const ENTITY_FIELDS: Record<string, EntityField> = {
  assignee: { kind: 'user', shape: 'object' },
  creator: { kind: 'user', shape: 'object' },
  author: { kind: 'user', shape: 'object' },
  performedBy: { kind: 'user', shape: 'object' },
  channel: { kind: 'channel', shape: 'object' },
  group: { kind: 'userGroup', shape: 'object' },
  assigneeId: { kind: 'user', shape: 'id' },
  assignedUserId: { kind: 'user', shape: 'id' },
  authorId: { kind: 'user', shape: 'id' },
  createdBy: { kind: 'user', shape: 'id' },
  updatedBy: { kind: 'user', shape: 'id' },
  assignedTo: { kind: 'user', shape: 'id' },
  closedBy: { kind: 'user', shape: 'id' },
  channelId: { kind: 'channel', shape: 'id' },
  groupId: { kind: 'userGroup', shape: 'id' },
  userGroupId: { kind: 'userGroup', shape: 'id' },
};

const ENTITY_ARRAY_FIELDS: Record<string, EntityField> = {
  mentionedUsers: { kind: 'user', shape: 'object' },
  participantUsers: { kind: 'user', shape: 'object' },
  mentionedGroups: { kind: 'userGroup', shape: 'object' },
  mentionedUserIds: { kind: 'user', shape: 'id' },
  channelIds: { kind: 'channel', shape: 'id' },
  mentionedGroupIds: { kind: 'userGroup', shape: 'id' },
};

interface ResolvedEntityRef {
  kind: MentionKind;
  id: string;
  name: string;
  email?: string;
}

function toRef(field: EntityField, value: unknown): ResolvedEntityRef | null {
  if (field.shape === 'id') {
    return typeof value === 'string' && value ? { kind: field.kind, id: value, name: value } : null;
  }
  if (value === null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id) return null;
  return {
    kind: field.kind,
    id: obj.id,
    name: typeof obj.name === 'string' && obj.name ? obj.name : obj.id,
    email: typeof obj.email === 'string' ? obj.email : undefined,
  };
}

function resolveEntityRefs(path: string, context: AutomationContext): ResolvedEntityRef[] | null {
  const segments = path.split('.');
  const leaf = segments[segments.length - 1] ?? '';
  const parent = segments[segments.length - 2] ?? '';

  if (leaf === 'id' || leaf === 'name' || leaf === 'email') {
    const field = ENTITY_FIELDS[parent];
    if (field?.shape === 'object') {
      const ref = toRef(field, resolveAutomationPath(context, segments.slice(0, -1).join('.')));
      return ref ? [ref] : null;
    }
  }

  const field = ENTITY_FIELDS[leaf];
  if (field?.shape === 'id') {
    const ref = toRef(field, resolveAutomationPath(context, path));
    return ref ? [ref] : null;
  }

  const arrayField = ENTITY_ARRAY_FIELDS[leaf];
  if (arrayField) {
    const value = resolveAutomationPath(context, path);
    if (!Array.isArray(value)) return null;
    return value.map((item) => toRef(arrayField, item)).filter((ref): ref is ResolvedEntityRef => ref !== null);
  }

  return null;
}

function spanForRef(ref: ResolvedEntityRef): string {
  const id = escapeHtml(ref.id);
  const name = escapeHtml(ref.name);

  switch (ref.kind) {
    case 'user': {
      const emailAttr = ref.email ? ` data-user-email="${escapeHtml(ref.email)}"` : '';
      return `<span data-mention data-mention-type="user" data-user-id="${id}" data-username="${name}"${emailAttr}>@${name}</span>`;
    }
    case 'channel':
      return `<span data-channel-mention data-channel-id="${id}" data-channel-name="${name}">#${name}</span>`;
    case 'userGroup':
      return `<span data-mention data-mention-type="group" data-group-id="${id}" data-group-name="${name}">@${name}</span>`;
  }
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
  if (value instanceof Date) return Number.isNaN(+value) ? '' : value.toISOString();
  if (typeof value === 'object') {
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
