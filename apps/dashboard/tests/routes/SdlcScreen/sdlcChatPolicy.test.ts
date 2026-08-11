import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeSdlcConversationTitle,
  SDLC_CHAT_PANEL_ID,
  SDLC_MAIN_PANEL_ID,
  sdlcChatLayout,
  sdlcChatNavigationSearch,
  sdlcConversationTitleFromHtml,
  shouldClearSelectedSdlcConversation,
  shouldStartFreshSdlcAssistant,
  shouldCloseInvalidSdlcConversationDeepLink,
  shouldUseInlineAssistantDebugger,
  sdlcRightPanelIds,
  sdlcRightPanelMode,
  shouldShowSdlcRelatedLink,
} from '../../../src/routes/SdlcScreen/sdlcChatPolicy.ts';

void test('closes only loaded unresolved SDLC conversation deep links', () => {
  assert.equal(
    shouldCloseInvalidSdlcConversationDeepLink({
      repoQueryComplete: true,
      discussionOpen: true,
      selectedConversationId: 'missing',
      discussionContextResolved: false,
    }),
    true,
  );
  assert.equal(
    shouldCloseInvalidSdlcConversationDeepLink({
      repoQueryComplete: false,
      discussionOpen: true,
      selectedConversationId: 'missing',
      discussionContextResolved: false,
    }),
    false,
  );
  assert.equal(
    shouldCloseInvalidSdlcConversationDeepLink({
      repoQueryComplete: true,
      discussionOpen: true,
      selectedConversationId: 'conversation-1',
      discussionContextResolved: true,
    }),
    false,
  );
});

void test('gives the debugger exclusive ownership of the SDLC right panel', () => {
  assert.equal(sdlcRightPanelMode({ chatOpen: true, debuggerOpen: true }), 'debugger');
  assert.equal(shouldUseInlineAssistantDebugger(true), false);
  assert.deepEqual(sdlcRightPanelIds('debugger'), [SDLC_MAIN_PANEL_ID, SDLC_CHAT_PANEL_ID]);
});

void test('preserves the open SDLC Assistant session for the same repository', () => {
  assert.equal(
    shouldStartFreshSdlcAssistant({
      actorOpen: true,
      selectedAgentSlug: 'sdlc-agent',
      actorChannelId: 'channel-1',
      repositoryChannelId: 'channel-1',
      actorRepositoryId: 'repo-1',
      repositoryId: 'repo-1',
    }),
    false,
  );
  assert.equal(
    shouldStartFreshSdlcAssistant({
      actorOpen: false,
      selectedAgentSlug: null,
      actorChannelId: null,
      repositoryChannelId: 'channel-1',
      actorRepositoryId: null,
      repositoryId: 'repo-1',
    }),
    true,
  );
});

void test('does not reject a linked deep-link merely because it is outside the visible page', () => {
  assert.equal(
    shouldClearSelectedSdlcConversation({
      selectedConversationId: 'older-linked-topic',
      linkedConversationIds: ['new-topic', 'older-linked-topic'],
      selectedQueryComplete: false,
      selectedConversationFound: false,
    }),
    false,
  );
  assert.equal(
    shouldClearSelectedSdlcConversation({
      selectedConversationId: 'unlinked-topic',
      linkedConversationIds: ['new-topic'],
      selectedQueryComplete: false,
      selectedConversationFound: false,
    }),
    true,
  );
});

void test('keeps Chat open across SDLC navigation and selects a valid destination tab', () => {
  assert.equal(
    sdlcChatNavigationSearch({
      currentSearch: '?chat=conversations&discussion=1&conversation=old-topic&canvas=old-canvas',
      destinationSearch: '?canvas=next-canvas',
      destinationHasConversations: true,
    }),
    '?canvas=next-canvas&discussion=1&chat=conversations',
  );
  assert.equal(
    sdlcChatNavigationSearch({
      currentSearch: '?chat=conversations&discussion=1&conversation=old-topic',
      destinationHasConversations: false,
    }),
    '?chat=ai',
  );
  assert.equal(
    sdlcChatNavigationSearch({
      currentSearch: '?chat=ai',
      destinationSearch: '?canvas=next-canvas',
      destinationHasConversations: true,
    }),
    '?canvas=next-canvas&chat=ai',
  );
  assert.equal(
    sdlcChatNavigationSearch({
      currentSearch: '',
      destinationSearch: '?canvas=next-canvas',
      destinationHasConversations: true,
    }),
    '?canvas=next-canvas',
  );
});

void test('keeps one stable main panel identity across SDLC Chat states', () => {
  const closed = sdlcChatLayout({ chatParam: null, discussionParam: null });
  const conversations = sdlcChatLayout({
    chatParam: 'conversations',
    discussionParam: '1',
  });
  const assistant = sdlcChatLayout({ chatParam: 'ai', discussionParam: '1' });

  assert.deepEqual(closed.panelIds, [SDLC_MAIN_PANEL_ID]);
  assert.deepEqual(conversations.panelIds, [SDLC_MAIN_PANEL_ID, SDLC_CHAT_PANEL_ID]);
  assert.deepEqual(assistant.panelIds, [SDLC_MAIN_PANEL_ID, SDLC_CHAT_PANEL_ID]);
  assert.equal(conversations.activeTab, 'conversations');
  assert.equal(assistant.activeTab, 'ai');
});

void test('stores a conversation title as safe normal-message HTML', () => {
  const stored = escapeSdlcConversationTitle('API <-> worker & "retry"');
  assert.equal(stored, 'API &lt;-&gt; worker &amp; &quot;retry&quot;');
  assert.equal(sdlcConversationTitleFromHtml(stored), 'API <-> worker & "retry"');
});

void test('uses an old first message as one compact topic title', () => {
  assert.equal(
    sdlcConversationTitleFromHtml(
      '<p>Clarify <strong>release ownership</strong></p><p>before launch</p>',
    ),
    'Clarify release ownership before launch',
  );
});

void test('hides same-channel conversations and shows cross-channel conversation context', () => {
  assert.equal(
    shouldShowSdlcRelatedLink({
      relationType: 'CONTEXT',
      entityType: 'CONVERSATION',
      entityChannelId: 'repo-channel',
      repositoryChannelId: 'repo-channel',
    }),
    false,
  );
  assert.equal(
    shouldShowSdlcRelatedLink({
      relationType: 'CONTEXT',
      entityType: 'CONVERSATION',
      entityChannelId: 'another-channel',
      repositoryChannelId: 'repo-channel',
    }),
    true,
  );
  assert.equal(
    shouldShowSdlcRelatedLink({
      relationType: 'DISCUSSION',
      entityType: 'CONVERSATION',
      entityChannelId: 'another-channel',
      repositoryChannelId: 'repo-channel',
    }),
    false,
  );
});
