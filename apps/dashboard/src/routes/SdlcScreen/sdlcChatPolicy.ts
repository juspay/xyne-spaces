export type SdlcChatTab = 'conversations' | 'ai';
export const shouldUseInlineAssistantDebugger = (embeddedInSdlc: boolean): boolean =>
  !embeddedInSdlc;

export const SDLC_MAIN_PANEL_ID = 'sdlc-main';
export const SDLC_CHAT_PANEL_ID = 'sdlc-chat';

const SDLC_CLOSED_PANEL_IDS = [SDLC_MAIN_PANEL_ID];
const SDLC_OPEN_PANEL_IDS = [SDLC_MAIN_PANEL_ID, SDLC_CHAT_PANEL_ID];

export const sdlcRightPanelIds = (open: boolean): string[] =>
  open ? SDLC_OPEN_PANEL_IDS : SDLC_CLOSED_PANEL_IDS;

export const sdlcChatLayout = (input: {
  chatParam: string | null;
  discussionParam: string | null;
}): { activeTab: SdlcChatTab; panelOpen: boolean; panelIds: string[] } => {
  // 'ai' is a legacy URL tab from when the assistant rendered inside the SDLC
  // side panel. The assistant is the global XyneAI sidebar now, so the param
  // no longer opens the SDLC panel — SdlcScreen migrates old ?chat=ai links by
  // opening the sidebar once and stripping the param.
  const activeTab: SdlcChatTab = input.chatParam === 'ai' ? 'ai' : 'conversations';
  // Open unless the reader closed it. Every surface that can hold a discussion —
  // a track, a folder, an artifact, a link, a file — shows it by default, so the
  // absence of the param means open and only an explicit '0' closes. What the
  // panel is scoped to, and whether there is anything to scope it to at all, is
  // still decided by the screen.
  const panelOpen = input.discussionParam !== '0';
  return {
    activeTab,
    panelOpen,
    panelIds: panelOpen ? SDLC_OPEN_PANEL_IDS : SDLC_CLOSED_PANEL_IDS,
  };
};

export const sdlcChatNavigationSearch = (input: {
  currentSearch: string;
  destinationSearch?: string;
}): string => {
  const current = new URLSearchParams(input.currentSearch);
  const destination = new URLSearchParams(input.destinationSearch ?? '');
  const currentLayout = sdlcChatLayout({
    chatParam: current.get('chat'),
    discussionParam: current.get('discussion'),
  });

  if (!currentLayout.panelOpen) {
    // Closed carries — but a destination that asks for the panel outranks it, so
    // opening a track, folder or artifact still brings its conversations back
    // after the reader has closed the panel somewhere else.
    if (!destination.has('discussion')) destination.set('discussion', '0');
    return `?${destination.toString()}`;
  }

  destination.delete('conversation');
  destination.delete('selectedTab');
  if (currentLayout.activeTab === 'conversations') {
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
  repositoryId: string | null;
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
