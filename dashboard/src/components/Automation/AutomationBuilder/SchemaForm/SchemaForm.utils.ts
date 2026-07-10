import type { JsonSchema, ValidationIssue } from '../../Automation.types';
import { VARIABLE_REF_DESCRIPTION_PREFIX, VARIABLE_REF_REGEX } from '../../Automation.types';

export const EntityKind = {
  USER: 'user',
  USER_GROUP: 'userGroup',
  CHANNEL: 'channel',
  BOARD: 'board',
  PROJECT: 'project',
  STAGE: 'stage',
  SENDER: 'sender',
  TICKET: 'ticket',
  CONVERSATION: 'conversation',
  MESSAGE: 'message',
  EMAIL: 'email',
} as const;

export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

const RICH_TEXT_FIELD_NAMES = new Set(['body', 'content', 'message']);

export function isRichTextField(fieldKey: string): boolean {
  return RICH_TEXT_FIELD_NAMES.has(fieldKey);
}

export function detectEntityKind(fieldKey: string): EntityKind | null {
  switch (fieldKey) {
    case 'channelId':
      return EntityKind.CHANNEL;
    case 'userId':
    case 'assigneeId':
    case 'assignedUserId':
    case 'createdById':
    case 'updatedBy':
      return EntityKind.USER;
    case 'senderId':
      return EntityKind.SENDER;
    case 'boardId':
      return EntityKind.BOARD;
    case 'projectId':
      return EntityKind.PROJECT;
    case 'groupId':
    case 'userGroupId':
      return EntityKind.USER_GROUP;
    case 'stageName':
      return EntityKind.STAGE;
    case 'ticketId':
    case 'parentTicketId':
    case 'mappedTicketId':
    case 'subTicketId':
      return EntityKind.TICKET;
    case 'conversationId':
      return EntityKind.CONVERSATION;
    case 'messageId':
      return EntityKind.MESSAGE;
    case 'emailId':
      return EntityKind.EMAIL;
    default:
      return null;
  }
}

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  channelId: 'Channel',
  channelIds: 'Channels',
  boardId: 'Board',
  boardIds: 'Boards',
  projectId: 'Project',
  projectIds: 'Projects',
  userId: 'User',
  userIds: 'Users',
  assigneeId: 'Assignee',
  assigneeIds: 'Assignees',
  toAssigneeIds: 'Assign to',
  memberIds: 'Members',
  groupId: 'Group',
  groupIds: 'Groups',
  userGroupId: 'User group',
  userGroupIds: 'User groups',
  mentionedUserIds: 'Mentioned users',
  mentionedGroupIds: 'Mentioned user groups',
  participantUserIds: 'Participants',
  stageName: 'Stage',
  senderId: 'Sender',
  createdById: 'Created by',
  updatedBy: 'Updated by',
};

export function labelForFieldKey(fieldKey: string): string | null {
  return FIELD_LABEL_OVERRIDES[fieldKey] ?? null;
}

export function detectEntityArrayKind(fieldKey: string): EntityKind | null {
  switch (fieldKey) {
    case 'channelIds':
      return EntityKind.CHANNEL;
    case 'userIds':
    case 'assigneeIds':
    case 'toAssigneeIds':
    case 'memberIds':
    case 'mentionedUserIds':
    case 'participantUserIds':
      return EntityKind.USER;
    case 'boardIds':
      return EntityKind.BOARD;
    case 'projectIds':
      return EntityKind.PROJECT;
    case 'groupIds':
    case 'userGroupIds':
    case 'mentionedGroupIds':
      return EntityKind.USER_GROUP;
    case 'ticketIds':
    case 'subTicketIds':
      return EntityKind.TICKET;
    case 'conversationIds':
      return EntityKind.CONVERSATION;
    case 'messageIds':
      return EntityKind.MESSAGE;
    case 'emailIds':
      return EntityKind.EMAIL;
    default:
      return null;
  }
}

export function detectEntityKindFromPath(path: string): EntityKind | null {
  const segments = path.split('.');
  const leaf = segments[segments.length - 1] ?? '';
  const direct = detectEntityKind(leaf) ?? detectEntityArrayKind(leaf);
  if (direct) return direct;
  if (leaf !== 'id') return null;
  const parent = segments[segments.length - 2] ?? '';
  switch (parent) {
    case 'ticket':
    case 'parentTicket':
    case 'subTicket':
    case 'mappedTicket':
      return EntityKind.TICKET;
    case 'conversation':
      return EntityKind.CONVERSATION;
    case 'message':
      return EntityKind.MESSAGE;
    case 'email':
      return EntityKind.EMAIL;
    case 'channel':
      return EntityKind.CHANNEL;
    case 'board':
      return EntityKind.BOARD;
    case 'project':
      return EntityKind.PROJECT;
    case 'user':
    case 'assignee':
    case 'createdBy':
    case 'performedBy':
    case 'author':
    case 'sender':
      return EntityKind.USER;
    case 'group':
    case 'userGroup':
      return EntityKind.USER_GROUP;
    case 'stage':
      return EntityKind.STAGE;
    default:
      return null;
  }
}

export type FieldKind =
  | 'string'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'datetime'
  | 'array'
  | 'object'
  | 'record'
  | 'variableRef';

export function resolveSchema(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const ref = schema.$ref;
  const match = /^#\/definitions\/(.+)$/.exec(ref);
  if (!match || !schema.definitions) return schema;
  const name = match[1];
  if (!name) return schema;
  const target = schema.definitions[name];
  if (!target) return schema;
  return { ...target, definitions: schema.definitions };
}

export function isVariableRef(schema: JsonSchema): boolean {
  return (
    !!schema.description &&
    schema.description.startsWith(VARIABLE_REF_DESCRIPTION_PREFIX) &&
    Array.isArray(schema.anyOf)
  );
}

export function getVariableRefInner(schema: JsonSchema): JsonSchema | null {
  if (!isVariableRef(schema) || !schema.anyOf) return null;
  const inner = schema.anyOf.find(
    s =>
      !(
        s.type === 'string' &&
        (s.pattern === VARIABLE_REF_REGEX.source || /context/.test(s.pattern ?? ''))
      ),
  );
  return inner ?? null;
}

export function isVariableRefValue(value: unknown): value is string {
  return typeof value === 'string' && VARIABLE_REF_REGEX.test(value);
}

export function detectFieldKind(schema: JsonSchema): FieldKind {
  if (isVariableRef(schema)) return 'variableRef';

  const resolved = followAnyOf(schema);

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return 'enum';
  if (resolved.type === 'boolean') return 'boolean';
  if (resolved.type === 'integer') return 'integer';
  if (resolved.type === 'number') return 'number';
  if (resolved.type === 'array') return 'array';
  if (resolved.type === 'object') {
    const hasNoProperties = !resolved.properties || Object.keys(resolved.properties).length === 0;
    const hasAdditional =
      resolved.additionalProperties === true ||
      (typeof resolved.additionalProperties === 'object' && resolved.additionalProperties !== null);
    if (hasNoProperties && hasAdditional) return 'record';
    return 'object';
  }
  if (resolved.format === 'date-time' || resolved.format === 'date') return 'datetime';
  if (resolved.type === 'string') {
    if (typeof resolved.maxLength === 'number' && resolved.maxLength > 200) return 'textarea';
    return 'string';
  }
  return 'string';
}

export function followAnyOf(schema: JsonSchema): JsonSchema {
  if (!schema.anyOf || schema.anyOf.length === 0) return schema;
  const concrete = schema.anyOf.find(s => s.type && s.type !== 'null');
  return concrete ?? schema.anyOf[0] ?? schema;
}

export function issuesForField(
  issues: ValidationIssue[] | null | undefined,
  pathPrefix: string,
  field: string,
): ValidationIssue[] {
  if (!issues || issues.length === 0) return [];
  const target = `${pathPrefix}${field}`;
  return issues.filter(i => i.path === target);
}

export function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (parent.length === 0) return key;
  return `${parent}.${key}`;
}

export function coerceNumber(raw: string, kind: 'number' | 'integer'): number | undefined {
  if (raw.trim().length === 0) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) return undefined;
  return kind === 'integer' ? Math.trunc(n) : n;
}
