import { useZero } from '../../../hooks/useZero';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import {
  User,
  ChannelVisibility,
  ChannelScopeType,
  validateMessageContentLength,
} from '@xyne/shared';
import { CircleAlert } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { usePlatform } from '../../../hooks/usePlatform';
import { useActiveUsers, useActiveUserSearch, useUser } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import {
  EVENT_PROPERTIES,
  EVENTS,
  mixpanelService,
} from '../../../services/Analytics/mixpanelService';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { InputBox } from '../../ui/InputBox';
import { SearchUserV2, type SearchEntry } from '../../ui/SearchUser/SearchUserV2';
import ChatListV2 from '../ChatList/ChatListV2';
import DragAndDropOverlay from '../DragAndDropOverlay';
import { sendConversationWithAttachments, useExistingDmChannel } from './useExistingDmChannel';
import { useDebouncedDmCreation } from './useDebouncedDmCreation';
import {
  useChannelSearch,
  useAllVisibleChannels,
  useGetChannelUserStatus,
} from '../../../hooks/useChannels';
import { userToMentionResult } from '../../../utils/userDisplayName';
import { useRankedActivePeople } from '../../../hooks/useRankedPeopleSearch';
import { useAffinityCallback } from '../../../hooks/useAffinityCallback';
import { rankChannelsByAffinity } from '../../../utils/rankingUtils';

export interface CreateDmFormData {
  participants: User[];
  message: string;
}

export const ComposeDmPanel: React.FC = () => {
  const [searchValue, setSearchValue] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isSearchUserOpen, setIsSearchUserOpen] = useState(false);
  const [mentionSearchQuery, setMentionSearchQuery] = useState('');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [preselectedInitialized, setPreselectedInitialized] = useState(false);
  const [createdChannelId, setCreatedChannelId] = useState<string | undefined>(undefined);
  const searchUserRef = useRef<HTMLInputElement>(null);
  const { dragAndDropAreaRef, inputRef: inputBoxRef, isDragging } = useDragAndDropAreaRef();
  const context = useAuthContextValues();
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const preselectedUserId = searchParams.get('userId');
  const zero = useZero();

  // Look up the pre-selected user by ID (from the DM search sidebar)
  const preselectedUser = useUser(preselectedUserId ?? '');

  // Focus search user input
  useEffect(() => {
    if (searchUserRef.current) {
      searchUserRef.current.focus();
      setIsSearchUserOpen(true);
    }
  }, [searchUserRef]);

  // Pre-populate selectedUsers with the user passed via ?userId= search param.
  // KeyedComposeDmPanel (in AppRoot) remounts this component fresh on every sidebar
  // selection, so a simple one-shot boolean is sufficient to avoid an infinite loop
  // when preselectedUser loads asynchronously while still allowing the user to
  // manually remove the pre-selected person via the X badge.
  useEffect(() => {
    if (preselectedInitialized) return;
    if (!preselectedUserId || !preselectedUser) return;
    setSelectedUsers([preselectedUser]);
    setPreselectedInitialized(true);
  }, [preselectedUserId, preselectedUser, preselectedInitialized]);

  const existingDmChannel = useExistingDmChannel(selectedUsers);

  const { cancelAutoCreate, createDm } = useDebouncedDmCreation({
    selectedUsers,
    existingDmChannel,
    onChannelCreated: (channelId: string) => {
      setCreatedChannelId(channelId);
    },
  });

  const effectiveChannelId = existingDmChannel?.id ?? createdChannelId;

  // Clear the auto-created channelId when the recipient list changes
  // so we don't send to a stale channel.
  useEffect(() => {
    setCreatedChannelId(undefined);
  }, [selectedUsers]);

  const navigateToChannel = useCallback(
    (channelId: string) => {
      const targetPath = location.pathname.includes('/chat/dm')
        ? `/chat/dm/${channelId}`
        : `/chat/dir/${channelId}`;
      void navigate(targetPath);
    },
    [location.pathname, navigate],
  );

  const handleSendMessage = useCallback(
    async (_plainText: string, html: string, files: File[]): Promise<void> => {
      // Cancel any pending auto-create debounce — we'll create immediately
      cancelAutoCreate();

      let channelId = effectiveChannelId;

      // Create the DM channel now if it doesn't exist yet
      if (!channelId) {
        try {
          const response = await createDm({
            participantIds: selectedUsers.map(user => user.id),
          });
          channelId = response.id;

          // Track group creation if more than 1 participant (excluding current user)
          const isGroupDm = selectedUsers.length > 1;
          mixpanelService.track(EVENTS.INITIATE_ACTION, {
            type: isGroupDm
              ? EVENT_PROPERTIES.ACTION_TYPES.NEW_GROUP_DM
              : EVENT_PROPERTIES.ACTION_TYPES.NEW_DM,
            hasInitialMessage: false,
          });

          // If existing DM was returned (might have been closed), reopen it
          if (response.isExisting) {
            zero.mutate(
              mutators.channel.reopenDm({ channelId: response.id, updatedAt: Date.now() }),
            );
          }
        } catch (error) {
          toast.error('Failed to create DM channel', {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
          throw error;
        }
      }

      // Send the message (with or without attachments)
      try {
        await sendConversationWithAttachments(channelId, html, files);
        navigateToChannel(channelId);
      } catch (error) {
        toast.error('Failed to send message', {
          description: error instanceof Error ? error.message : 'Please try again.',
        });
        throw error;
      }
    },
    [selectedUsers, effectiveChannelId, cancelAutoCreate, createDm, navigateToChannel, zero],
  );

  const form = useForm({
    defaultValues: {
      message: '',
    },
    onSubmit: () => {},
  });

  const handleUsersChange = (users: User[]): void => {
    setSelectedUsers(users);
  };

  // Channel search for # mentions
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const channelResults = useChannelSearch(channelSearchQuery, 10);

  const handleMentionSearch = useCallback((query: string) => {
    setMentionSearchQuery(query);
  }, []);

  const handleChannelSearch = useCallback((query: string) => {
    setChannelSearchQuery(query);
  }, []);

  const channelItems = useMemo(() => {
    if (!channelResults || channelResults.length === 0) return [];

    // Filter channels to only show DEFAULT scope (exclude DM, GROUP_DM, TICKET, DOCUMENT)
    return channelResults
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        ...(channel.description && { description: channel.description }),
        hasAccess: true,
      }));
  }, [channelResults]);

  const mentionUserResults = useActiveUserSearch(mentionSearchQuery, 10);

  const composeMentionItems = useMemo(() => {
    const query = mentionSearchQuery.trim().toLowerCase();
    const isSelfDm = selectedUsers.length === 1 && selectedUsers[0]?.id === context.userID;

    const matchesQuery = (candidate: User): boolean => {
      if (!query) return true;

      const emailLocalPart = candidate.email.split('@')[0] ?? '';
      return [candidate.displayName, candidate.name, candidate.email, emailLocalPart].some(
        value => value?.toLowerCase().includes(query) ?? false,
      );
    };

    const recipients = selectedUsers
      .filter(selectedUser => isSelfDm || selectedUser.id !== context.userID)
      .filter(matchesQuery);
    const recipientIds = new Set(recipients.map(selectedUser => selectedUser.id));

    const workspaceUsers = mentionUserResults.filter(
      candidate => !recipientIds.has(candidate.id) && (isSelfDm || candidate.id !== context.userID),
    );

    const userMentions = [
      ...recipients.map(selectedUser =>
        userToMentionResult(selectedUser, selectedUser.id === context.userID, true),
      ),
      ...workspaceUsers.map(candidate =>
        userToMentionResult(candidate, candidate.id === context.userID),
      ),
    ];

    if (selectedUsers.length <= 1) return userMentions;

    // Offer @channel and @here for group DMs, matching useMentionSearch's special
    // mentions. The backend (sendInitialMessage) handles both in the initial message.
    const specialMentions = [
      {
        id: 'special-channel',
        name: 'channel',
        type: 'channel' as const,
        isSpecial: true,
        description: 'Notify everyone in this group DM',
      },
      {
        id: 'special-here',
        name: 'here',
        type: 'here' as const,
        isSpecial: true,
        description: 'Notify online members of this group DM',
      },
    ].filter(mention => !query || mention.name.includes(query));

    if (specialMentions.length === 0) return userMentions;

    return [...specialMentions, ...userMentions];
  }, [mentionSearchQuery, selectedUsers, context.userID, mentionUserResults]);

  const channelParticipation = useGetChannelUserStatus(existingDmChannel?.id || '');
  const [latestMessage] = useCachedQuery(
    queries.channelLatestConversation({
      channelId: existingDmChannel?.id ?? '',
      isMember: !!channelParticipation,
    }),
    { enabled: !!existingDmChannel },
  );

  // Active people ranked by matchesAllTokens + MFU affinity + DM recency (seeds recent partners at rest).
  const rankedPeople = useRankedActivePeople(searchValue, 10);
  const affinityVersion = useAffinityCallback();

  const recipientChannelResults = useChannelSearch(searchValue, 10);

  // All active workspace users and visible channels – used for conversation-history ordering
  const allWorkspaceUsers = useActiveUsers();
  const visibleChannels = useAllVisibleChannels();

  // Build a lookup map for quick access by id
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allWorkspaceUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allWorkspaceUsers]);

  // Rank people by matchesAllTokens + MFU affinity + DM recency (useRankedActivePeople seeds recent
  // DM partners at rest). Preserve the self rules: drop self, then prepend it only for a query that
  // is "self" or matches the current user's name (self is never shown in the empty browse state).
  const filteredUsers = useMemo(() => {
    const currentUserId = context.userID;
    const others = rankedPeople.filter(u => u.id !== currentUserId).slice(0, 10);

    const trimmed = searchValue.trim();
    const currentUser = usersById.get(currentUserId);
    if (trimmed && currentUser) {
      const isSelfSearch = trimmed.toLowerCase() === 'self';
      const nameMatches = rankedPeople.some(u => u.id === currentUserId);
      if (isSelfSearch || nameMatches) {
        return [currentUser, ...others].slice(0, 10);
      }
    }
    return others;
  }, [rankedPeople, searchValue, context.userID, usersById]);

  const mergedSearchItems = useMemo<SearchEntry[]>(() => {
    // Re-read channel affinity once weights load (rankChannelsByAffinity reads it imperatively).
    void affinityVersion;

    // People keep the order the hook already produced: relevance (incl. raw-name + full-name token
    // matches) → MFU affinity → DM recency. Do NOT re-rank them here — a coarse displayName-only tier
    // would bury a high-affinity contact matched via their full name under a stray prefix match.
    const userEntries: SearchEntry[] = filteredUsers.map(u => ({ type: 'user', user: u }));

    // Channels: query → relevance-ranked search hits, browse → all visible; then float by MFU affinity.
    const q = searchValue.trim();
    const channelSource = q ? recipientChannelResults : visibleChannels;
    const channelEntries: SearchEntry[] = rankChannelsByAffinity(
      channelSource.filter(ch => ch.scopeType === ChannelScopeType.DEFAULT),
    ).map(ch => ({
      type: 'channel',
      channel: {
        id: ch.id,
        name: ch.name,
        isPrivate: ch.visibility === ChannelVisibility.PRIVATE,
      },
    }));

    // People first (this is a "message people" picker), then channels; capped.
    return [...userEntries, ...channelEntries].slice(0, 15);
  }, [filteredUsers, recipientChannelResults, visibleChannels, searchValue, affinityVersion]);

  // Build chat list props
  const chatListProps = useMemo(() => {
    if (!existingDmChannel || !latestMessage) return null;
    return {
      channelId: existingDmChannel.id,
      initialItem: {
        conversationId: latestMessage.conversationId,
        createdAt: latestMessage.createdAt,
      },
      latestConversation: {
        conversationId: latestMessage.conversationId,
        createdAt: latestMessage.createdAt,
      },
      channelScopeType: existingDmChannel.scopeType,
    };
  }, [
    existingDmChannel?.id,
    existingDmChannel?.scopeType,
    latestMessage?.conversationId,
    latestMessage?.createdAt,
  ]);

  // dynamic conversation title
  const getConversationTitle = (): string => {
    if (selectedUsers.length === 0) return 'Select people to message';
    if (selectedUsers.length === 1) return `Message ${selectedUsers[0]?.name || 'Unknown'}`;
    if (selectedUsers.length <= 3) {
      return selectedUsers.map(u => u.name).join(', ');
    }
    const firstTwo = selectedUsers
      .slice(0, 2)
      .map(u => u.name)
      .join(', ');
    const remaining = selectedUsers.length - 2;
    return `${firstTwo} + ${remaining} others`;
  };

  return (
    <div ref={dragAndDropAreaRef} className='pt-4 pb-2 relative h-full'>
      <DragAndDropOverlay isVisible={isDragging} />
      <form
        className='h-full'
        onSubmit={e => {
          e.preventDefault();
          e.stopPropagation();
          setHasAttemptedSubmit(true);
          void form.handleSubmit();
        }}
      >
        <div className='mx-auto bg-background h-full flex flex-col'>
          {/* Conversation Preview */}
          <div className='px-4'>
            <div className='text-base font-semibold text-foreground'>
              {existingDmChannel && latestMessage ? 'Existing Conversation' : 'New Message'}
            </div>
            {selectedUsers.length > 0 ? (
              <div className='flex items-center gap-2 justify-between text-xs text-muted-foreground'>
                <div className='flex justify-between items-center gap-2 w-full'>
                  <span className='py-1'>{getConversationTitle()}</span>
                  {!isMobile && selectedUsers.length > 9 && (
                    <div className='px-3 py-0.5 flex items-center gap-1.5 w-fix bg-muted border border-border rounded-lg text-destructive'>
                      <CircleAlert className='size-3' strokeWidth={2.6} />
                      <span className='text-[10px]'>
                        Maximum 9 recipients allowed. Create a channel to add more.
                      </span>
                    </div>
                  )}
                </div>
                {/* Selected users as badges */}
                <span className='text-muted-foreground/70'>{selectedUsers.length}/9</span>
              </div>
            ) : (
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span className='py-1'>Select people to message</span>
                <span className='text-muted-foreground/70'>0/9</span>
              </div>
            )}
          </div>

          {/* User Search */}
          <div className='flex flex-col gap-1.5 flex-1'>
            <div className='space-y-1 px-2'>
              <SearchUserV2
                options={filteredUsers}
                selectedUsers={selectedUsers}
                onSelect={handleUsersChange}
                inputRef={searchUserRef}
                isOpen={isSearchUserOpen}
                setIsOpen={setIsSearchUserOpen}
                searchQuery={searchValue}
                onSearchChange={setSearchValue}
                currentUserId={context.userID}
                mergedItems={mergedSearchItems}
                onSelectChannel={(channelId: string) => {
                  void navigate(`/chat/dir/${channelId}`);
                }}
                // className='p-0'
              />
              {/* Validation errors */}
              {hasAttemptedSubmit && selectedUsers.length === 0 && (
                <div className='text-sm text-destructive'>
                  Please select at least one person to message
                </div>
              )}
              {isMobile && selectedUsers.length > 9 && (
                <div className='px-4 py-1.5 flex items-center gap-1.5 w-full bg-muted border border-border rounded-lg text-destructive'>
                  <CircleAlert className='size-3' strokeWidth={2.6} />
                  <span className='text-[10px]'>
                    Maximum 9 recipients allowed. Create a channel to add more.
                  </span>
                </div>
              )}
            </div>

            <div className='w-full border-b' />

            {chatListProps ? (
              <ChatListV2
                channelId={chatListProps.channelId}
                initialItem={chatListProps.initialItem}
                latestConversation={chatListProps.latestConversation}
                lastViewedAt={null}
                channelScopeType={chatListProps.channelScopeType}
              />
            ) : (
              <div className='flex-1' />
            )}

            {/* Message Input */}
            <form.Field
              name='message'
              validators={{
                onChange: ({ value }) => validateMessageContentLength(value),
              }}
            >
              {field => (
                <div className='space-y-1.5 px-4'>
                  <InputBox
                    ref={inputBoxRef}
                    id='dm-message'
                    value={field.state.value}
                    placeholder='Say something to start the conversation...'
                    showTypingIndicator={false}
                    mentionItems={composeMentionItems}
                    onMentionSearch={handleMentionSearch}
                    channelItems={channelItems}
                    onChannelSearch={handleChannelSearch}
                    onContentChange={(html: string) => {
                      field.handleChange(html);
                    }}
                    disabled={selectedUsers.length > 9}
                    disableDraftUpload
                    onSendMessage={handleSendMessage}
                    features={{
                      richText: true,
                      mentions: true,
                      fileAttachments: true,
                      emojiPicker: true,
                    }}
                    sendDisabled={field.state.meta.errors.length > 0 || selectedUsers.length === 0}
                    className={cn(
                      field.state.meta.errors.length > 0 &&
                        'border-destructive aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
                    )}
                  />
                  <div className='h-2 px-1'>
                    {field.state.meta.errors.length > 0 && field.state.meta.errors[0] && (
                      <p className='text-[12px] text-destructive text-nowrap'>
                        {field.state.meta.errors[0]}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </form.Field>
          </div>
        </div>
      </form>
    </div>
  );
};

// Wrapper that forces ComposeDmPanel to fully remount each time a user is selected from
// the DM sidebar search. DmsPage.handleUserSelect embeds a unique timestamp in
// location.state so every click — even on the same user after removing them via X —
// gets a fresh composePanelKey.
export const KeyedComposeDmPanel = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('userId') ?? '';
  // location.state carries { composePanelKey: Date.now() } from DmsPage.handleUserSelect.
  // Fall back to userId so direct navigation to ?userId=X still mounts a keyed instance.
  const location = useLocation();
  const composePanelKey =
    (location.state as { composePanelKey?: number } | null)?.composePanelKey ?? userId;
  return <ComposeDmPanel key={composePanelKey} />;
};

export default ComposeDmPanel;
