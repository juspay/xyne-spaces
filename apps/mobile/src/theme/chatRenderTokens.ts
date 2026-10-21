/**
 * Chat paint token contract. Type + defaults only — no CSS-variable resolution.
 * v2 and v3 both consume this so bubble chrome cannot drift.
 */

export const USERNAME_COLOR_VAR_NAMES = [
  '--color-username-1',
  '--color-username-2',
  '--color-username-3',
  '--color-username-4',
  '--color-username-5',
  '--color-username-6',
  '--color-username-7',
  '--color-username-8',
  '--color-username-9',
  '--color-username-10',
  '--color-username-11',
  '--color-username-12',
] as const;

export const PR_BADGE_COLOR_VAR_NAMES = [
  '--color-pr-badge-created-bg',
  '--color-pr-badge-created-fg',
  '--color-pr-badge-merged-bg',
  '--color-pr-badge-merged-fg',
  '--color-pr-badge-danger-bg',
  '--color-pr-badge-danger-fg',
] as const;

export const FLOW_CARD_COLOR_VAR_NAMES = [
  '--color-flow-card-step-checked-fill',
  '--color-flow-card-step-check-icon',
  '--color-flow-card-step-empty-border',
  '--color-flow-card-step-spinner',
  '--color-flow-card-step-failed-fill',
  '--color-flow-card-step-failed-icon',
  '--color-border',
  '--color-chat-card-muted',
  '--color-background',
] as const;

export const CHAT_SURFACE_COLOR_VAR_NAMES = [
  '--color-border',
  '--color-chat-card',
  '--color-popover',
] as const;

export const SYSTEM_MESSAGE_COLOR_VAR_NAMES = [
  '--color-conversation-composer-system-text',
] as const;

export const CALL_MESSAGE_COLOR_VAR_NAMES = ['--color-conversation-composer-call-icon'] as const;

export type ChatFlowCardStepColors = {
  checkedFill: string;
  checkIcon: string;
  emptyBorder: string;
  spinner: string;
  failedFill: string;
  failedIcon: string;
};

export type ChatFlowCardQuestionColors = {
  borderDefault: string;
  borderSelected: string;
  rowBackground: string;
  indicatorFill: string;
  indicatorCheck: string;
  indicatorEmpty: string;
  plusIcon: string;
  inputBorder: string;
  inputText: string;
  inputBackground: string;
  inputPlaceholder: string;
};

export const DEFAULT_FLOW_CARD_STEP_COLORS: ChatFlowCardStepColors = {
  checkedFill: '#101828cc',
  checkIcon: '#ffffff',
  emptyBorder: '#10182833',
  spinner: '#98a2b3',
  failedFill: '#e7000b',
  failedIcon: '#ffffff',
};

export const DEFAULT_FLOW_CARD_QUESTION_COLORS: ChatFlowCardQuestionColors = {
  borderDefault: '#d6dce6',
  borderSelected: '#101828',
  rowBackground: '#f1f5f9',
  indicatorFill: '#101828cc',
  indicatorCheck: '#ffffff',
  indicatorEmpty: '#10182833',
  plusIcon: '#6b7280',
  inputBorder: '#d6dce6',
  inputText: '#101828',
  inputBackground: '#e5eaef',
  inputPlaceholder: '#6b7280',
};

export type ChatPrBadgePalette = {
  created: { background: string; foreground: string };
  merged: { background: string; foreground: string };
  danger: { background: string; foreground: string };
};

export const DEFAULT_PR_BADGE_PALETTE: ChatPrBadgePalette = {
  created: { background: '#ebfaf0', foreground: '#16a34a' },
  merged: { background: '#f0ebfa', foreground: '#3716a3' },
  danger: { background: '#faebeb', foreground: '#ff0f0f' },
};

export type ChatRenderTokens = {
  foreground: string;
  foregroundMuted: string;
  rootTextUser: string;
  rootTextOther: string;
  rootMetaUser: string;
  rootAccentUser: string;
  cardBg: string;
  systemText: string;
  callIconColor: string;
  borderColor: string;
  chatCardColor: string;
  popoverColor: string;
  brand: string;
  ambientAccentColor: string;
  linkColor: string;
  linkColorUser: string;
  inlineContentMaxWidth: number;
  windowWidth: number;
  actionPrimaryColor: string;
  mutedForeground: string;
  forwardedBgUser: string;
  forwardedBgOther: string;
  embeddedBgUser: string;
  embeddedTitleUser: string;
  embeddedMutedUser: string;
  ticketPriorityLowColor: string;
  ticketPriorityMediumColor: string;
  ticketPriorityHighColor: string;
  ticketPriorityCriticalColor: string;
  currentUserBubbleBg: string;
  tableHeaderBg: string;
  tableBorderColor: string;
  // 12-color username palette, read once at the list and indexed per sender so
  // rows pay zero per-row CSS-variable subscriptions.
  usernamePalette: readonly string[];
  prBadgePalette: ChatPrBadgePalette;
  flowCardStepColors: ChatFlowCardStepColors;
  flowCardQuestionColors: ChatFlowCardQuestionColors;
  mentionPalette: {
    otherBg: string;
    otherText: string;
    currentOtherBg: string;
    currentOtherText: string;
    mentionedYouBg: string;
    mentionedYouText: string;
    currentSelfBg: string;
    currentSelfText: string;
  };
};

export const DEFAULT_USERNAME_PALETTE: readonly string[] = [
  '#1B8755',
  '#2563eb',
  '#9333ea',
  '#db2777',
  '#ea580c',
  '#0891b2',
  '#65a30d',
  '#c026d3',
  '#0d9488',
  '#dc2626',
  '#7c3aed',
  '#d97706',
];

/** Context fallback when a list has not provided resolved tokens. */
export const DEFAULT_CHAT_RENDER_TOKENS: ChatRenderTokens = {
  foreground: '#111827',
  foregroundMuted: '#6b7280',
  rootTextUser: '#0a0a0a',
  rootTextOther: '#0a0a0a',
  rootMetaUser: 'rgba(10, 10, 10, 0.58)',
  rootAccentUser: 'rgba(10, 10, 10, 0.7)',
  cardBg: '#ffffff',
  systemText: '#666665',
  callIconColor: '#101828',
  borderColor: '#d6dce6',
  chatCardColor: '#f9f9f9',
  popoverColor: '#f1f5f9',
  brand: '#1B8755',
  ambientAccentColor: '#1B8755',
  linkColor: '#1B8755',
  linkColorUser: '#1B8755',
  inlineContentMaxWidth: 300,
  windowWidth: 300,
  actionPrimaryColor: '#1B8755',
  mutedForeground: '#6b7280',
  forwardedBgUser: '#d7f3ea',
  forwardedBgOther: '#eef2ff',
  embeddedBgUser: 'rgba(0, 0, 0, 0.07)',
  embeddedTitleUser: '#0a0a0a',
  embeddedMutedUser: 'rgba(10, 10, 10, 0.56)',
  ticketPriorityLowColor: '#6b7280',
  ticketPriorityMediumColor: '#f59e0b',
  ticketPriorityHighColor: '#c2410c',
  ticketPriorityCriticalColor: '#dc2626',
  currentUserBubbleBg: '#d8fdd2',
  tableHeaderBg: '#f3f4f6',
  tableBorderColor: '#d6dce6',
  usernamePalette: DEFAULT_USERNAME_PALETTE,
  prBadgePalette: DEFAULT_PR_BADGE_PALETTE,
  flowCardStepColors: DEFAULT_FLOW_CARD_STEP_COLORS,
  flowCardQuestionColors: DEFAULT_FLOW_CARD_QUESTION_COLORS,
  mentionPalette: {
    otherBg: '#eef2ff',
    otherText: '#4453a6',
    currentOtherBg: '#d7f3ea',
    currentOtherText: '#2b6b59',
    mentionedYouBg: '#d6a21f',
    mentionedYouText: '#251700',
    currentSelfBg: '#d6a21f',
    currentSelfText: '#251700',
  },
};
