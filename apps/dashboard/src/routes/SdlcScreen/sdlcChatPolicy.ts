import type { SdlcEntityType, SdlcRelationType } from '@xyne/shared';

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'");

export type SdlcChatTab = 'conversations' | 'ai';
export type SdlcRightPanelMode = 'closed' | 'chat' | 'debugger';

export const sdlcRightPanelMode = (input: {
  chatOpen: boolean;
  debuggerOpen: boolean;
}): SdlcRightPanelMode => {
  if (input.debuggerOpen) return 'debugger';
  if (input.chatOpen) return 'chat';
  return 'closed';
};

export const shouldUseInlineAssistantDebugger = (embeddedInSdlc: boolean): boolean =>
  !embeddedInSdlc;

export const SDLC_MAIN_PANEL_ID = 'sdlc-main';
export const SDLC_CHAT_PANEL_ID = 'sdlc-chat';

const SDLC_CLOSED_PANEL_IDS = [SDLC_MAIN_PANEL_ID];
const SDLC_OPEN_PANEL_IDS = [SDLC_MAIN_PANEL_ID, SDLC_CHAT_PANEL_ID];

export const sdlcRightPanelIds = (mode: SdlcRightPanelMode): string[] =>
  mode === 'closed' ? SDLC_CLOSED_PANEL_IDS : SDLC_OPEN_PANEL_IDS;

export const sdlcChatLayout = (input: {
  chatParam: string | null;
  discussionParam: string | null;
}): { activeTab: SdlcChatTab; panelOpen: boolean; panelIds: string[] } => {
  const activeTab: SdlcChatTab = input.chatParam === 'ai' ? 'ai' : 'conversations';
  const panelOpen = activeTab === 'ai' || input.discussionParam === '1';
  return {
    activeTab,
    panelOpen,
    panelIds: panelOpen ? SDLC_OPEN_PANEL_IDS : SDLC_CLOSED_PANEL_IDS,
  };
};

export const sdlcChatNavigationSearch = (input: {
  currentSearch: string;
  destinationSearch?: string;
  destinationHasConversations: boolean;
}): string => {
  const current = new URLSearchParams(input.currentSearch);
  const destination = new URLSearchParams(input.destinationSearch ?? '');
  const currentLayout = sdlcChatLayout({
    chatParam: current.get('chat'),
    discussionParam: current.get('discussion'),
  });

  if (!currentLayout.panelOpen) {
    const search = destination.toString();
    return search ? `?${search}` : '';
  }

  destination.delete('conversation');
  if (currentLayout.activeTab === 'conversations' && input.destinationHasConversations) {
    destination.set('discussion', '1');
    destination.set('chat', 'conversations');
  } else {
    destination.delete('discussion');
    destination.set('chat', 'ai');
  }

  return `?${destination.toString()}`;
};

export const shouldStartFreshSdlcAssistant = (input: {
  actorOpen: boolean;
  selectedAgentSlug: string | null;
  actorChannelId: string | null;
  repositoryChannelId: string;
  actorRepositoryId: string | null;
  repositoryId: string;
}): boolean =>
  !input.actorOpen ||
  input.selectedAgentSlug !== 'sdlc-agent' ||
  input.actorChannelId !== input.repositoryChannelId ||
  input.actorRepositoryId !== input.repositoryId;

export const shouldClearSelectedSdlcConversation = (input: {
  selectedConversationId: string | null;
  linkedConversationIds: readonly string[];
  selectedQueryComplete: boolean;
  selectedConversationFound: boolean;
}): boolean => {
  if (!input.selectedConversationId) return false;
  if (!input.linkedConversationIds.includes(input.selectedConversationId)) return true;
  return input.selectedQueryComplete && !input.selectedConversationFound;
};

export const shouldCloseInvalidSdlcConversationDeepLink = (input: {
  repoQueryComplete: boolean;
  discussionOpen: boolean;
  selectedConversationId: string | null;
  discussionContextResolved: boolean;
}): boolean =>
  input.repoQueryComplete &&
  input.discussionOpen &&
  Boolean(input.selectedConversationId) &&
  !input.discussionContextResolved;

export const escapeSdlcConversationTitle = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const sdlcConversationTitleFromHtml = (value: string): string => {
  const title = decodeHtmlEntities(
    value
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|blockquote)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return title || 'Untitled';
};

export const shouldShowSdlcRelatedLink = (input: {
  relationType: SdlcRelationType;
  entityType: SdlcEntityType;
  entityChannelId?: string | null;
  repositoryChannelId?: string | null;
}): boolean => {
  if (input.relationType === 'DISCUSSION') return false;
  if (input.entityType !== 'CONVERSATION') return true;
  return Boolean(input.entityChannelId && input.entityChannelId !== input.repositoryChannelId);
};
