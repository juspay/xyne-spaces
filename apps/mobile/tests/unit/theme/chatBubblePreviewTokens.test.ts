import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatRenderTokens } from '@/src/theme/chatRenderTokens';
import { buildChatBubblePreviewTokens } from '@/src/theme/chatBubblePreviewTokens';
import { deriveChatBubbleContentTokens } from '@/src/theme/chatBubbleContentTokens';

const BASE_TOKENS: ChatRenderTokens = {
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
  windowWidth: 360,
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
  usernamePalette: ['#1B8755', '#2563eb'],
  prBadgePalette: {
    created: { background: '#ebfaf0', foreground: '#16a34a' },
    merged: { background: '#f0ebfa', foreground: '#3716a3' },
    danger: { background: '#faebeb', foreground: '#ff0f0f' },
  },
  flowCardStepColors: {
    checkedFill: '#101828cc',
    checkIcon: '#ffffff',
    emptyBorder: '#10182833',
    spinner: '#98a2b3',
    failedFill: '#e7000b',
    failedIcon: '#ffffff',
  },
  flowCardQuestionColors: {
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
  },
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

// The exact set the preview screen is allowed to override. Pinned so the hoist out of
// PreviewPage cannot silently start (or stop) overriding a token.
const OVERRIDDEN_KEYS = [
  'actionPrimaryColor',
  'ambientAccentColor',
  'currentUserBubbleBg',
  'embeddedBgUser',
  'embeddedMutedUser',
  'embeddedTitleUser',
  'linkColor',
  'linkColorUser',
  'mentionPalette',
  'rootAccentUser',
  'rootMetaUser',
  'rootTextUser',
] as const;

describe('buildChatBubblePreviewTokens', () => {
  it('overrides exactly the expected token keys', () => {
    const result = buildChatBubblePreviewTokens(BASE_TOKENS, '#2d68ea', 'light');

    const changed = (Object.keys(BASE_TOKENS) as (keyof ChatRenderTokens)[])
      .filter(key => {
        const before = BASE_TOKENS[key];
        const after = result[key];
        return typeof before === 'object'
          ? JSON.stringify(before) !== JSON.stringify(after)
          : before !== after;
      })
      .sort();

    assert.deepEqual(changed, [...OVERRIDDEN_KEYS]);
  });

  it('passes through every non-overridden base token untouched', () => {
    const result = buildChatBubblePreviewTokens(BASE_TOKENS, '#2d68ea', 'light');

    assert.equal(result.foreground, BASE_TOKENS.foreground);
    assert.equal(result.rootTextOther, BASE_TOKENS.rootTextOther);
    assert.equal(result.cardBg, BASE_TOKENS.cardBg);
    assert.equal(result.brand, BASE_TOKENS.brand);
    assert.equal(result.inlineContentMaxWidth, BASE_TOKENS.inlineContentMaxWidth);
    assert.equal(result.windowWidth, BASE_TOKENS.windowWidth);
    assert.equal(result.forwardedBgUser, BASE_TOKENS.forwardedBgUser);
    assert.equal(result.ticketPriorityLowColor, BASE_TOKENS.ticketPriorityLowColor);
    assert.equal(result.usernamePalette, BASE_TOKENS.usernamePalette);
  });

  it('uses the candidate color as the current-user bubble background', () => {
    assert.equal(
      buildChatBubblePreviewTokens(BASE_TOKENS, '#2d68ea', 'light').currentUserBubbleBg,
      '#2d68ea',
    );
  });

  it('derives every override from deriveChatBubbleContentTokens', () => {
    const color = '#2d68ea';
    const content = deriveChatBubbleContentTokens(color, 'light');
    const result = buildChatBubblePreviewTokens(BASE_TOKENS, color, 'light');

    assert.equal(result.ambientAccentColor, content.ambientAccentColor);
    assert.equal(result.linkColor, content.ambientAccentColor);
    assert.equal(result.linkColorUser, content.linkColorUser);
    assert.equal(result.actionPrimaryColor, content.ambientActionBg);
    assert.equal(result.rootTextUser, content.rootTextUser);
    assert.equal(result.rootMetaUser, content.rootMetaUser);
    assert.equal(result.rootAccentUser, content.rootAccentUser);
    assert.equal(result.embeddedBgUser, content.embeddedBgUser);
    assert.equal(result.embeddedTitleUser, content.embeddedTitleUser);
    assert.equal(result.embeddedMutedUser, content.embeddedMutedUser);

    assert.deepEqual(result.mentionPalette, {
      otherBg: content.ambientMentionBg,
      otherText: content.ambientMentionText,
      currentOtherBg: content.mentionOtherBgUser,
      currentOtherText: content.mentionOtherTextUser,
      mentionedYouBg: content.mentionSelfBgOther,
      mentionedYouText: content.mentionSelfTextOther,
      currentSelfBg: content.mentionSelfBgUser,
      currentSelfText: content.mentionSelfTextUser,
    });
  });

  it('does not mutate the base tokens', () => {
    const snapshot = JSON.stringify(BASE_TOKENS);
    buildChatBubblePreviewTokens(BASE_TOKENS, '#2d68ea', 'dark');

    assert.equal(JSON.stringify(BASE_TOKENS), snapshot);
  });

  it('produces different tokens per theme for the same color', () => {
    const light = buildChatBubblePreviewTokens(BASE_TOKENS, '#2d68ea', 'light');
    const dark = buildChatBubblePreviewTokens(BASE_TOKENS, '#2d68ea', 'dark');

    assert.notDeepEqual(light, dark);
  });
});
