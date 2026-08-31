import type { SdlcEntityType, SdlcRelationType } from '@xyne/shared';

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
  // 'ai' is a legacy URL tab from when the assistant rendered inside the SDLC
  // side panel. The assistant is the global XyneAI sidebar now, so the param
  // no longer opens the SDLC panel — SdlcScreen migrates old ?chat=ai links by
  // opening the sidebar once and stripping the param.
  const activeTab: SdlcChatTab = input.chatParam === 'ai' ? 'ai' : 'conversations';
  const panelOpen = input.discussionParam === '1';
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
    // Destination has no conversations: close the panel. (Previously this fell
    // back to the legacy in-panel 'ai' tab, which force-opened the global
    // assistant sidebar and made its close button appear dead.)
    destination.delete('discussion');
    destination.delete('chat');
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

export const shouldCloseInvalidSdlcConversationDeepLink = (input: {
  /** Both the channel and the entity links, since the context needs both. */
  dataLoaded: boolean;
  discussionOpen: boolean;
  selectedConversationId: string | null;
  discussionContextResolved: boolean;
}): boolean =>
  input.dataLoaded &&
  input.discussionOpen &&
  Boolean(input.selectedConversationId) &&
  !input.discussionContextResolved;

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
