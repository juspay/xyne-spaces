/**
 * Test-side stand-in for the `@xyne/shared` root barrel.
 *
 * The real barrel re-exports the Zero schema, which imports `@rocicorp/zero`
 * (ESM-only) at module load; jest cannot parse it. Rendering tests that reach a
 * module importing an enum from `@xyne/shared` map the barrel to this file:
 *
 *   jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));
 *
 * Only the members the channel-tickets feature reads are defined here, with the
 * exact runtime values of the real enums. Add members as new tests need them.
 */
export const CallType = {
  AUDIO: 'AUDIO',
  VIDEO: 'VIDEO',
  HEADLESS: 'HEADLESS',
} as const;

export const TicketStatusV2 = {
  TODO: 'TODO',
  STARTED: 'STARTED',
  PAUSED: 'PAUSED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;

export const MailboxState = {
  INBOX: 'INBOX',
  ARCHIVED: 'ARCHIVED',
  SPAM: 'SPAM',
} as const;

export const TicketPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export const FormFieldType = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  DATE: 'DATE',
  SINGLE_SELECT: 'SINGLE_SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  USER: 'USER',
  DOC: 'DOC',
  TICKET: 'TICKET',
} as const;

export const BaseTicketType = {
  Fix: 'Fix',
  Feature: 'Feature',
  Story: 'Story',
  Hotfix: 'Hotfix',
  Release: 'Release',
  Support: 'Support',
} as const;

export const ChannelScopeType = {
  DEFAULT: 'DEFAULT',
  DM: 'DM',
  GROUP_DM: 'GROUP_DM',
} as const;

export const ChannelType = {
  DEFAULT: 'DEFAULT',
  EMAIL: 'EMAIL',
  SUPPORT: 'SUPPORT',
  SLACK: 'SLACK',
  APP: 'APP',
} as const;

const DESK_CHANNEL_TYPES: ReadonlySet<string> = new Set([
  ChannelType.EMAIL,
  ChannelType.SLACK,
  ChannelType.APP,
]);

export function isDeskChannelType(type: string | null | undefined): boolean {
  return type !== null && type !== undefined && DESK_CHANNEL_TYPES.has(type);
}
