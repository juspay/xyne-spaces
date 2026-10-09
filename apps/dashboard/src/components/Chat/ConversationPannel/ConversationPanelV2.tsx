import { ReactElement, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import {
  useChannel,
  getChannelConversationsSnapshot,
  useGetChannelUserStatus,
} from '../../../hooks/useChannels';
import { useChannelHasBoards } from '../../../hooks/useChannelBoards';
import { ChannelNoBoardsEmptyState } from '../ChannelInformation/ChannelNoBoardsEmptyState';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { useConversationTabs } from './ConversationPannel.utils';
import { appIdOf } from '../../../hooks/barItems';
import { ArtifactAppHost } from '../../ArtifactApp/ArtifactAppHost';
import { useChannelSubscription } from '../../../hooks/useChannelSubscription';
import { useScope, useShortcutById } from '../../../shortcuts';
import { ChannelVisibility, ChannelScopeType } from '@xyne/shared';
import { standaloneNavigate } from '../../../utils/electronApp';
import { ConversationTabContext } from '../ConversationTabContext';
import ConversationHeader from '../ConversationHeader/ConversationHeader';
import DragAndDropOverlay from '../DragAndDropOverlay';
import LoadingAnimation from '../Loader/Loader';
import JoinChannel from '../JoinChannel/JoinChannel';
import { ChatInput } from '../ChatInput';
import FileListV2 from '../FileListV2';
import PinListV2 from '../PinListV2';
import KanbanBoardScreen from '../../../routes/KanbanBoardScreen';
import CanvasTab from '../../Canvas/CanvasTab';
import CanvasScreen from '../../Canvas/CanvasScreen';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { ExpandedTicketView } from '../../Tickets/ExpandedTicketView/ExpandedTicketView';
import ChatListV4 from '../ChatList/ChatListV4';
import LinksTab from '../LinksTab/LinksTab';
import { Archive } from 'lucide-react';
import { useUser } from '../../../hooks/useUsers';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import { parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';

// Stable empty array — an inline `[]` here would be a new reference on every
// render, causing useChannelSubscription's effect to unsubscribe/resubscribe
// the websocket channel on each render (measured as constant subscribe churn).
const NO_CONVERSATION_IDS: string[] = [];

const DeactivatedDmArchiveBanner = (): ReactElement => {
  return (
    <div className='px-4 pt-4 pb-4 bg-background'>
      <div className='flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
        <Archive className='size-4 shrink-0' />
        <span>You are viewing the archives of a deactivated account</span>
      </div>
    </div>
  );
};

// Channel Tickets tab. Boards come from channel_board_mappings — the channel's own
// linked boards, which may span projects. A channel with no linked boards has nothing
// to show and, more importantly, nothing to scope a ticket query by, so render a
// graceful empty state (no board view, no ticket creation) instead of the Kanban
// board. Waiting for isSynced matters: an unsynced empty mapping is indistinguishable
// from a genuinely empty one, and acting early would flash this state over a channel
// that does have boards.
const ChannelTicketsTab = ({ channelId }: { channelId: string }): ReactElement => {
  const { isSynced, hasBoards } = useChannelHasBoards(channelId);

  // KanbanBoardScreen renders the same empty state for hosts that mount it with a
  // channelId directly; this short-circuit just avoids mounting the whole screen.
  if (isSynced && !hasBoards) {
    return <ChannelNoBoardsEmptyState channelId={channelId} />;
  }
  return <KanbanBoardScreen channelId={channelId} />;
};

const ConversationPanelV2 = ({
  channelId,
  previousChannelId,
  linkedConversationIdOverride,
  linkedItemCreatedAtOverride,
  onClose,
  showHeader = true,
  hideComposer = false,
  skipMarkAsRead = false,
  suppressInputAutoFocus = false,
  listLoadingFallback,
  skipSubscription = false,
  conversationIds,
  onOpenThread,
  useLocalTabState = false,
  unreadsOnly,
  onThreadClick,
  onTotalHeightChange,
}: {
  channelId: string;
  previousChannelId: string | null;
  linkedConversationIdOverride?: string | null;
  linkedItemCreatedAtOverride?: number | null;
  onClose?: () => void;
  showHeader?: boolean;
  /** Restrict the feed to these conversations (e.g. the SDLC panel's DISCUSSION-linked set). */
  conversationIds?: string[] | undefined;
  /** Overrides thread-open navigation (e.g. open in-panel instead of routing). */
  onOpenThread?: ((conversationId: string, e?: React.MouseEvent) => void) | undefined;
  // When true, suppress the message composer / join / archive footer entirely.
  // Used by read-only surfaces such as the Unreads inbox.
  hideComposer?: boolean;
  skipMarkAsRead?: boolean;
  // Never take the keyboard on mount.
  //
  // The composer's autofocus is not just a focus: TipTap's focus command runs
  // ProseMirror's `scrollRectIntoView`, which writes `scrollLeft` on every
  // scrollable ancestor to reveal the caret. In a single-panel screen that
  // ancestor is the page and the write is a no-op. Inside a Streams column it is
  // the strip, and the write drags the whole stream sideways by however much of
  // that column the viewport was clipping — hundreds of pixels, once per column,
  // arriving whenever each channel happens to resolve.
  //
  // Streams mounts six of these at once and the user picked none of them, so
  // there is nothing here for the keyboard to claim.
  suppressInputAutoFocus?: boolean;
  /**
   * Placeholder for the message list's first load, passed straight through to
   * `ChatListV4`. For hosts that already painted their own placeholder before
   * this panel mounted — see `loadingFallback` there.
   */
  listLoadingFallback?: React.ReactNode;
  // Skips the websocket channel subscription — messages render via Zero regardless.
  skipSubscription?: boolean;
  // When true (e.g. rendered in the search-results pane, which owns its own `?tab=`
  // for the doc-type filter), keep the active tab in local state instead of the URL —
  // otherwise a foreign `tab=all` matches no conversation tab and blanks the body.
  useLocalTabState?: boolean;
  unreadsOnly?: boolean;
  onThreadClick?: (channelId: string, conversationId: string) => void;
  // Reports the message list's real total content height (px).
  onTotalHeightChange?: (height: number) => void;
}): ReactElement => {
  const { baseRoute } = useRouteContext();
  const channel = useChannel(channelId);
  // Resolved once here and handed down through ConversationTabContext: it is
  // constant per channel, and ChatBubble renders once per message, so subscribing
  // per bubble would put hundreds of identical queries on a long conversation.
  // Only DEFAULT channels can create tickets, so DMs skip the query entirely.
  const { hasBoards: channelHasBoards } = useChannelHasBoards(
    channel?.scopeType === ChannelScopeType.DEFAULT ? channelId : undefined,
  );
  const channelParticipation = useGetChannelUserStatus(channelId);
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(channelId);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const skipInputAutoFocus = suppressInputAutoFocus || searchParams.get('nofocus') === '1';

  // Strip the `nofocus` param from the URL after each channel navigation so it
  // doesn't persist on subsequent interactions (composing, tab switches).
  // Runs on every channel change when the param is present — read the value
  // once at arrival so `skipInputAutoFocus` is already `true` for this render.
  useEffect(() => {
    if (searchParams.get('nofocus') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('nofocus');
    setSearchParams(next, { replace: true });
  }, [channelId, searchParams, setSearchParams]);

  // Get this channel's tabs — its own customized set where allowed, otherwise
  // the built-in list.
  const { availableTabs, getDefaultTab, isValidTab } = useConversationTabs(
    channelId,
    channel?.scopeType,
  );

  const urlHashValue = location.hash.match(/origin=([^&#]+)/);

  const urlCreatedAtMatch = location.hash.match(/createdAt=([^&#]+)/);
  const urlConversationId = linkedConversationIdOverride ?? (urlHashValue ? urlHashValue[1] : null);
  const activityNavigationState = routerLocation.state as {
    linkedItemCreatedAt?: number;
    linkedCutoffCreatedAt?: number | null;
  } | null;
  const stateLinkedItemCreatedAt =
    typeof activityNavigationState?.linkedItemCreatedAt === 'number'
      ? activityNavigationState.linkedItemCreatedAt
      : null;
  const stateLinkedCutoffCreatedAt =
    typeof activityNavigationState?.linkedCutoffCreatedAt === 'number'
      ? activityNavigationState.linkedCutoffCreatedAt
      : null;

  const [localTab, setLocalTab] = useState<string>(getDefaultTab());
  const urlTab = searchParams.get('tab');
  const urlTabOrDefault = urlTab && isValidTab(urlTab) ? urlTab : getDefaultTab();
  const tab = useLocalTabState ? localTab : urlTabOrDefault;
  const ticketId = searchParams.get('ticketId');
  const conversationId = searchParams.get('conversationId');
  const canvasId = searchParams.get('canvasId');

  const participationStatus = useGetChannelUserStatus(channelId);
  // A closed/not-open DM is absent from the status map, so participation is briefly undefined;
  // treat a DM/group-DM as member here too — otherwise the linked-message lookup returns nothing
  // and the panel is stuck on "Messages are loading…". The query's ACL re-verifies real membership.
  const isDmScope =
    channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;
  const [initialMessageById] = useCachedQuery(
    queries.getConversationByIdWithChannel({
      conversationId: urlConversationId || '',
      channelId: channelId || '',
      isMember: !!participationStatus || isDmScope,
    }),
    { enabled: !!urlConversationId && !urlCreatedAtMatch && stateLinkedItemCreatedAt === null },
  );

  const hashLinkedItemCreatedAt =
    urlCreatedAtMatch && urlCreatedAtMatch[1] ? parseInt(urlCreatedAtMatch[1], 10) : null;
  const urlCreatedAt =
    linkedItemCreatedAtOverride ??
    hashLinkedItemCreatedAt ??
    stateLinkedItemCreatedAt ??
    (urlConversationId ? initialMessageById?.createdAt : null);

  // ONE-TIME windowed snapshot, not a subscription. ChatListV3 only reads
  // cachedConversations in its useState initializer (warm-start hydration),
  // but it also writes back into the cache — subscribing here closed a render
  // loop (every cache write → new ref → panel re-render → list re-render).
  // The snapshot is a ~100-item window: newest by default, centered on the
  // linked anchor for deep links. ChatListV3 mounts only after urlCreatedAt
  // has resolved for linked navigation (the loading gate below), so the
  // anchor is available at hydration time. Older/newer pages load through
  // the normal pagination path.
  const cachedConversations = useMemo(() => {
    const snapshot = getChannelConversationsSnapshot(channelId, urlCreatedAt ?? undefined);
    if (!conversationIds) return snapshot;
    const allowed = new Set(conversationIds);
    return snapshot.filter(conversation => allowed.has(conversation.conversationId));
  }, [channelId, urlCreatedAt, conversationIds]);

  // Skip mark as read functionality
  const skipMarkAsReadRef = useRef(skipMarkAsRead || false);
  const setSkipMarkAsRead = useCallback((skip: boolean) => {
    skipMarkAsReadRef.current = skip;
  }, []);

  useChannelSubscription(skipSubscription ? undefined : channelId, NO_CONVERSATION_IDS);
  useScope('channel', !!channelId);
  useShortcutById('global.openCanvasTab', () => {
    handleTabChange('canvas');
  });

  // Check if channel is public and user is not a member
  const isUserMember = !!channelParticipation;
  const shouldShowJoinChannel =
    channel?.visibility === ChannelVisibility.PUBLIC && !isUserMember && !channel?.isArchived;

  const { userID: currentUserId } = useAuthContextValues();
  const dmPartnerId =
    channel?.scopeType === ChannelScopeType.DM
      ? parseDMParticipantIds(channel).find(id => id !== currentUserId)
      : undefined;
  const isDeactivatedDmArchive = isUserDeactivated(useUser(dmPartnerId ?? ''));

  // Safe tab setter with validation. Memoized because it feeds the context
  // value below — an unstable reference re-rendered every visible ChatBubble
  // (context consumers) on each panel render.
  const handleTabChange = useCallback(
    (tab: string, e?: React.MouseEvent): void => {
      if (!isValidTab(tab)) return;
      if (useLocalTabState) {
        setLocalTab(tab);
      } else {
        standaloneNavigate(navigate, `${baseRoute}/${channelId}?tab=${tab}`, { event: e });
      }
    },
    [isValidTab, navigate, baseRoute, channelId, useLocalTabState],
  );

  const conversationTabContextValue = useMemo(
    () => ({
      setActiveTab: handleTabChange,
      setSkipMarkAsRead,
      skipMarkAsReadRef,
      channelHasBoards,
    }),
    [handleTabChange, setSkipMarkAsRead, channelHasBoards],
  );

  return (
    <ConversationTabContext.Provider value={conversationTabContextValue}>
      <div key={`${channelId}-conversation-panel`} className='w-full relative h-full flex flex-col'>
        {showHeader && (
          <ConversationHeader
            channelId={channelId}
            previousChannelId={previousChannelId}
            channelTabs={availableTabs}
            activeTab={tab}
            setActiveTab={handleTabChange}
            {...(onClose && { onClose })}
          />
        )}
        <div
          className={`flex-1 flex flex-col overflow-hidden ${showHeader ? 'pt-16 [@media(min-width:500px)]:pt-0' : ''}`}
        >
          {tab === 'messages' && (
            <div
              ref={dragAndDropAreaRef}
              className='flex-1 flex flex-col overflow-hidden relative bg-background'
            >
              <DragAndDropOverlay isVisible={isDragging} />
              {urlConversationId && !urlCreatedAt ? (
                <div className='absolute inset-0 flex items-center justify-center bg-background z-50'>
                  <LoadingAnimation
                    source='ConversationPannelV2: getLinkedConversation'
                    url={location.pathname}
                    message='Messages are loading...'
                  />
                </div>
              ) : (
                <ChatListV4
                  {...(listLoadingFallback !== undefined && {
                    loadingFallback: listLoadingFallback,
                  })}
                  {...(urlConversationId && { linkedConversationId: urlConversationId })}
                  {...(urlCreatedAt && { linkedItemCreatedAt: { createdAt: urlCreatedAt } })}
                  {...(stateLinkedCutoffCreatedAt && {
                    linkedCutoffCreatedAt: { createdAt: stateLinkedCutoffCreatedAt },
                  })}
                  cachedConversations={cachedConversations}
                  channelId={channelId}
                  projectId={channel?.projectId ?? undefined}
                  channelScopeType={channel?.scopeType}
                  skipMarkAsReadRef={skipMarkAsReadRef}
                  {...(conversationIds && { conversationIds })}
                  {...(onOpenThread && { onOpenThread })}
                  unreadsOnly={unreadsOnly ?? false}
                  {...(onThreadClick && { onThreadClick })}
                  {...(onTotalHeightChange && { onTotalHeightChange })}
                />
              )}
              {hideComposer ? null : shouldShowJoinChannel ? (
                <JoinChannel channelId={channelId} channelTitle={channel?.name} />
              ) : isDeactivatedDmArchive ? (
                <DeactivatedDmArchiveBanner />
              ) : (
                <div className='pb-3 bg-background px-[var(--composer-px)] [--composer-px:0.75rem]'>
                  <ChatInput
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus={skipInputAutoFocus ? null : 'end'}
                    ref={inputRef}
                    channelId={channelId || ''}
                  />
                </div>
              )}
            </div>
          )}

          {tab === 'files' && <FileListV2 channelId={channelId} />}
          {tab === 'pins' && <PinListV2 channelId={channelId} />}
          {tab === 'tickets' &&
            (!!ticketId && !!conversationId ? (
              <ExpandedTicketView
                ticketId={ticketId}
                channelId={channelId}
                conversationId={conversationId}
              />
            ) : (
              <ChannelTicketsTab channelId={channelId} />
            ))}
          {tab === 'canvas' &&
            (canvasId ? <CanvasScreen canvasId={canvasId} /> : <CanvasTab channelId={channelId} />)}
          {tab === 'links' && <LinksTab channelId={channelId} />}
          {appIdOf(tab) !== null && (
            // An artifact app the user added as a tab. Keyed on the app so
            // switching between two app tabs boots a fresh sandbox instead of
            // handing one app's iframe another app's payload.
            <ArtifactAppHost
              key={tab}
              appId={appIdOf(tab) ?? ''}
              placement={{
                surface: 'channel',
                channel: {
                  id: channelId,
                  name: channel?.name ?? '',
                  scopeType: channel?.scopeType ?? '',
                },
              }}
            />
          )}
        </div>
      </div>
    </ConversationTabContext.Provider>
  );
};

export default ConversationPanelV2;
