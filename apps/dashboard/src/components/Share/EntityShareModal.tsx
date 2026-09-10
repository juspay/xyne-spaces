import React, { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Hash, Users, X } from 'lucide-react';
import { LinkChainSlant } from '@xyne/icons';
import type { MentionResult } from '@xyne/shared';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { useUserGroupSearch, useChannelSearch } from '@xyne/shared/hooks';
import Avatar from '../ui/Avatar/Avatar';
import { Button } from '../ui/Button/Button';
import { InputBox } from '../ui/InputBox';
import { UnifiedParticipantSearch } from '../ui/UnifiedParticipantSearch/UnifiedParticipantSearch';
import type { InputBoxHandle } from '../../hooks/useDragAndDropAreaRef';
import { useActiveUserSearch } from '../../hooks/useUsers';
import { useAuth } from '../../hooks/useAuth';
import { useMentionSearch } from '../../hooks/useMentionSearch';
import { userToMentionResult } from '../../utils/userDisplayName';
import { getApiErrorMessage } from '../../utils/apiError';

const MENTION_USER_LIMIT = 20;
const MENTION_GROUP_LIMIT = 10;

export type EntityShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

/**
 * One live share, flattened by the caller so this component never touches the
 * Zero row shapes — the recordings and calls queries return different tables.
 */
export interface EntityShareEntry {
  id: string;
  /** Who or what the entity is shared with, as shown in the access list. */
  label: string;
  /** Set for user shares, to render the avatar. */
  userId: string | null;
  target: EntityShareTarget;
  /** The conversation the share posted into, when it posted one. */
  post: { channelId: string; conversationId: string } | null;
}

export interface EntityShareModalProps {
  /** Excluded from the picker — the owner already has access. */
  ownerId: string | undefined;
  shares: EntityShareEntry[];
  onGrant: (targets: EntityShareTarget[], messageContent: string) => Promise<void>;
  onRevoke: (target: EntityShareTarget) => Promise<void>;
  /** The word the copy uses for what is being shared: 'recording' or 'call'. */
  subject: string;
  /** Analytics namespace of the host screen. */
  trackCategory: string;
  /**
   * Heading over the share list. Defaults to the recordings wording, which is
   * complete there — a recording starts out visible to its creator alone. A call
   * is already visible to its participants and channel, so calls say "Shared with"
   * rather than implying this list is everyone who can see it.
   */
  accessListTitle?: string;
  /** Link-access controls and anything else specific to one entity type. */
  generalAccess?: ReactNode;
  onClose?: () => void;
}

/**
 * Share and post modal shared by recordings and calls: pick people, groups or
 * channels, add an optional note, and see or remove who already has access.
 * Everything entity-specific — which service the grant goes to, and any extra
 * sections — is supplied by the wrapper (RecordingShareModal, CallShareModal).
 */
export const EntityShareModal: React.FC<EntityShareModalProps> = ({
  ownerId,
  shares,
  onGrant,
  onRevoke,
  subject,
  trackCategory,
  accessListTitle = 'People with access',
  generalAccess,
  onClose,
}) => {
  const { user: currentUser } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [messageContent, setMessageContent] = useState('');
  const [sharing, setSharing] = useState(false);
  const inputBoxRef = useRef<InputBoxHandle>(null);

  const sharedUserIds = useMemo(
    () => new Set(shares.map(share => share.userId).filter((id): id is string => Boolean(id))),
    [shares],
  );
  const sharedUserGroupIds = useMemo(
    () =>
      new Set(
        shares.filter(share => share.target.type === 'user_group').map(share => share.target.id),
      ),
    [shares],
  );
  const sharedChannelIds = useMemo(
    () =>
      new Set(
        shares.filter(share => share.target.type === 'channel').map(share => share.target.id),
      ),
    [shares],
  );

  const excludedUserIds = useMemo(
    () =>
      new Set(
        [ownerId, currentUser?.id, ...sharedUserIds].filter((id): id is string => Boolean(id)),
      ),
    [currentUser?.id, ownerId, sharedUserIds],
  );

  // Mentions inside the note resolve against the selected channel when there is
  // one, so they match who will actually see the post.
  const selectedChannelId = useMemo(
    () =>
      selectedValues.find(value => value.startsWith('channel:'))?.replace('channel:', '') ??
      undefined,
    [selectedValues],
  );

  const { results: channelScopedMentions, searchMentions: searchChannelScopedMentions } =
    useMentionSearch(selectedChannelId);

  const [mentionQuery, setMentionQuery] = useState('');
  const mentionUsers = useActiveUserSearch(mentionQuery, MENTION_USER_LIMIT);
  const mentionGroups = useUserGroupSearch(mentionQuery, MENTION_GROUP_LIMIT);
  const workspaceMentions = useMemo<MentionResult[]>(
    () => [
      ...mentionUsers.map(u => userToMentionResult(u, u.id === currentUser?.id)),
      ...mentionGroups.map(
        (g): MentionResult => ({
          id: g.id,
          name: g.name,
          type: 'group',
          ...(g.alias && { alias: g.alias }),
          ...(g.description && { description: g.description }),
          memberCount: 0,
          isDeactivated: g.isActive === false,
        }),
      ),
    ],
    [mentionUsers, mentionGroups, currentUser?.id],
  );

  const mentionResults = selectedChannelId ? channelScopedMentions : workspaceMentions;
  const handleMentionSearch = useCallback(
    (query: string) => {
      if (selectedChannelId) {
        searchChannelScopedMentions(query);
      } else {
        setMentionQuery(query);
      }
    },
    [selectedChannelId, searchChannelScopedMentions],
  );

  const [channelMentionQuery, setChannelMentionQuery] = useState('');
  const channelMentionResults = useChannelSearch(channelMentionQuery, 10);
  const channelMentionItems = useMemo(
    () =>
      channelMentionResults
        .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
          ...(channel.description && { description: channel.description }),
        })),
    [channelMentionResults],
  );

  const handleShare = async (): Promise<void> => {
    if (selectedValues.length === 0) return;

    setSharing(true);
    try {
      const targets: EntityShareTarget[] = selectedValues.map(value =>
        value.startsWith('user_group:')
          ? { type: 'user_group', id: value.replace('user_group:', '') }
          : value.startsWith('channel:')
            ? { type: 'channel', id: value.replace('channel:', '') }
            : { type: 'user', id: value.replace('user:', '') },
      );
      await onGrant(targets, messageContent);
      toast.success(
        selectedValues.length === 1
          ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)} shared`
          : `Shared with ${selectedValues.length} recipients`,
      );
      setSelectedValues([]);
      setSearchQuery('');
      setMessageContent('');
      onClose?.();
    } catch (error) {
      toast.error('Failed to share', {
        description: getApiErrorMessage(error, `Unable to share this ${subject}`),
      });
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className='flex flex-col w-full p-5 gap-4'>
      <div className='space-y-2'>
        <p className='text-muted-foreground text-[13px] leading-5'>
          Share with people, groups, or channels
        </p>
        <UnifiedParticipantSearch
          selectedValues={selectedValues}
          onMultiSelect={setSelectedValues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          excludedUserIds={excludedUserIds}
          excludedUserGroupIds={sharedUserGroupIds}
          excludedChannelIds={sharedChannelIds}
          exclusiveSelection={false}
        />
      </div>

      <div
        className='space-y-1.5'
        data-track-category={trackCategory}
        data-track-name={`share_${subject}_message_input`}
        onKeyDownCapture={event => {
          if (event.key === 'Enter' && !event.shiftKey && selectedValues.length > 0) {
            if (inputBoxRef.current?.isSuggestionOpen()) return;
            event.preventDefault();
            event.stopPropagation();
            void handleShare();
          }
        }}
      >
        <label htmlFor={`share-${subject}-message`} className='text-muted-foreground text-[13px]'>
          Add a message (optional)
        </label>
        <InputBox
          ref={inputBoxRef}
          id={`share-${subject}-message`}
          placeholder={`Say something about this ${subject}...`}
          onSendMessage={() => {}}
          onContentChange={(html, _text) => {
            setMessageContent(html);
          }}
          mentionItems={mentionResults}
          onMentionSearch={handleMentionSearch}
          channelItems={channelMentionItems}
          onChannelSearch={setChannelMentionQuery}
          features={{
            richText: true,
            mentions: true,
            commands: false,
            fileAttachments: false,
            emojiPicker: true,
          }}
          showTypingIndicator={false}
          disabled={sharing}
          disableEnterToSend
          hideSendButton
        />
      </div>

      <div className='flex justify-end'>
        <Button
          size='sm'
          onClick={() => void handleShare()}
          disabled={selectedValues.length === 0 || sharing}
          data-track-category={trackCategory}
          data-track-name={`share_${subject}_confirm`}
        >
          {sharing ? 'Sharing...' : 'Share'}
        </Button>
      </div>

      {shares.length > 0 && (
        <div className='space-y-2 border-t border-border pt-3'>
          <p className='text-muted-foreground text-[13px]'>{accessListTitle}</p>
          <div className='space-y-3.5 max-h-60 overflow-y-auto pr-1'>
            {shares.map(share => {
              const icon =
                share.target.type === 'user_group' ? (
                  <Users className='size-4 text-muted-foreground shrink-0' />
                ) : share.target.type === 'channel' ? (
                  <Hash className='size-4 text-muted-foreground shrink-0' />
                ) : (
                  <Avatar userId={share.userId} size='sm' showActiveStatus={false} />
                );

              return (
                <div key={share.id} className='group flex items-center justify-between gap-2'>
                  <div className='flex items-center gap-2 min-w-0'>
                    {icon}
                    <span className='text-sm truncate'>{share.label}</span>
                    {share.post && (
                      <Link
                        to={`/chat/dir/${share.post.channelId}/${share.post.conversationId}`}
                        className='shrink-0 text-muted-foreground transition-colors hover:text-foreground'
                        aria-label='Open shared conversation'
                        data-track-category={trackCategory}
                        data-track-name={`open_${subject}_share_conversation`}
                      >
                        <LinkChainSlant className='size-3.5' aria-hidden='true' />
                      </Link>
                    )}
                  </div>
                  <button
                    type='button'
                    onClick={() => void onRevoke(share.target)}
                    className='shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
                    aria-label='Remove access'
                    data-track-category={trackCategory}
                    data-track-name={`revoke_${subject}_share`}
                  >
                    <X className='size-3.5' />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {generalAccess}
    </div>
  );
};
