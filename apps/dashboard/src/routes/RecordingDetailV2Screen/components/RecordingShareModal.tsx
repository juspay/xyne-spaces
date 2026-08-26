import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Globe, Hash, Link2, Lock, Users, X } from 'lucide-react';
import { LinkChainSlant } from '@xyne/icons';
import type { MentionResult } from '@xyne/shared';
import { CallVisibility, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { useUserGroupSearch, useChannelSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { Switch } from '../../../components/ui/Switch';
import { InputBox } from '../../../components/ui/InputBox';
import { UnifiedParticipantSearch } from '../../../components/ui/UnifiedParticipantSearch/UnifiedParticipantSearch';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { useActiveUserSearch } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { queries } from '../../../zero/queries';
import { getUserDisplayName, userToMentionResult } from '../../../utils/userDisplayName';
import {
  recordingService,
  type RecordingDetail,
  type RecordingShareTarget,
  type RecordingTicketLinkState,
} from '../../../services/Recording/recordingService';
import { getApiErrorMessage } from '../../../utils/apiError';
import {
  getRecordingSharePost,
  isRecordingTicketLinkShare,
  logRecordingError,
} from '../../../utils/recordingUtils';

const MENTION_USER_LIMIT = 20;
const MENTION_GROUP_LIMIT = 10;

export interface RecordingShareModalProps {
  recording: Pick<RecordingDetail, 'externalId' | 'createdByUserId'>;
  onClose?: () => void;
  onTicketLinkUpdated?: (ticketLink: RecordingTicketLinkState) => void;
}

/** Unified recording share and post modal. */
export const RecordingShareModal: React.FC<RecordingShareModalProps> = ({
  recording,
  onClose,
  onTicketLinkUpdated,
}) => {
  const { user: currentUser } = useAuth();
  const shareableOrigin = useShareableOrigin();
  const isCreator = currentUser?.id === recording.createdByUserId;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [messageContent, setMessageContent] = useState('');
  const [sharing, setSharing] = useState(false);
  const [locallyRevokedShareIds, setLocallyRevokedShareIds] = useState<Set<string>>(new Set());
  const [visibilityOverride, setVisibilityOverride] = useState<CallVisibility | null>(null);
  const inputBoxRef = useRef<InputBoxHandle>(null);

  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recording.externalId }),
  );
  const visibility = visibilityOverride ?? recordingRow?.visibility ?? CallVisibility.PRIVATE;
  const isPublic = visibility === CallVisibility.PUBLIC;

  const shares = useMemo(
    () =>
      (recordingRow?.shares ?? []).filter(
        share =>
          !locallyRevokedShareIds.has(share.id) && !isRecordingTicketLinkShare(share.metadata),
      ),
    [locallyRevokedShareIds, recordingRow],
  );

  const sharedUserIds = useMemo(
    () => new Set(shares.map(share => share.userId).filter((id): id is string => Boolean(id))),
    [shares],
  );
  const sharedUserGroupIds = useMemo(
    () => new Set(shares.map(share => share.userGroupId).filter((id): id is string => Boolean(id))),
    [shares],
  );
  const sharedChannelIds = useMemo(
    () => new Set(shares.map(share => share.channelId).filter((id): id is string => Boolean(id))),
    [shares],
  );

  const excludedUserIds = useMemo(
    () =>
      new Set(
        [recording.createdByUserId, currentUser?.id, ...sharedUserIds].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    [currentUser?.id, recording.createdByUserId, sharedUserIds],
  );

  // Configure the share message composer.
  const selectedChannelId = useMemo(
    () =>
      selectedValues.find(value => value.startsWith('channel:'))?.replace('channel:', '') ??
      undefined,
    [selectedValues],
  );

  const { results: channelScopedMentions, searchMentions: searchChannelScopedMentions } =
    useMentionSearch(selectedChannelId);

  // Search workspace mentions when no channel is selected.
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

  // Search channel mentions.
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
      const targets: RecordingShareTarget[] = selectedValues.map(value =>
        value.startsWith('user_group:')
          ? { type: 'user_group', id: value.replace('user_group:', '') }
          : value.startsWith('channel:')
            ? { type: 'channel', id: value.replace('channel:', '') }
            : { type: 'user', id: value.replace('user:', '') },
      );
      const result = await recordingService.grantRecordingAccess(
        recording.externalId,
        targets,
        undefined,
        messageContent,
      );
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.delete(share.id));
          return next;
        });
      }
      toast.success(
        selectedValues.length === 1
          ? 'Recording shared'
          : `Shared with ${selectedValues.length} recipients`,
      );
      setSelectedValues([]);
      setSearchQuery('');
      setMessageContent('');
      onClose?.();
    } catch (error) {
      logRecordingError('RecordingShareModal.share', error);
      toast.error('Failed to share', {
        description: getApiErrorMessage(error, 'Unable to share this recording'),
      });
    } finally {
      setSharing(false);
    }
  };

  const handleVisibilityChange = async (next: CallVisibility): Promise<void> => {
    if (next === visibility) return;
    setVisibilityOverride(next);
    try {
      await recordingService.setRecordingVisibility(recording.externalId, next);
      toast.success(
        next === CallVisibility.PUBLIC
          ? 'Anyone in the workspace with the link can now view'
          : 'Link access turned off',
      );
    } catch (error) {
      setVisibilityOverride(null);
      logRecordingError('RecordingShareModal.setVisibility', error);
      toast.error('Failed to update link access', {
        description: getApiErrorMessage(error, 'Unable to update recording link access'),
      });
    }
  };

  const handleCopyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${shareableOrigin}/recordings/${recording.externalId}`);
      toast.success('Link copied');
    } catch (error) {
      logRecordingError('RecordingShareModal.handleCopyLink', error);
      toast.error('Failed to copy link');
    }
  };

  const handleAccessChange = async (
    target: { targetUserId: string } | { targetUserGroupId: string } | { targetChannelId: string },
  ): Promise<void> => {
    const apiTarget: RecordingShareTarget =
      'targetUserId' in target
        ? { type: 'user', id: target.targetUserId }
        : 'targetUserGroupId' in target
          ? { type: 'user_group', id: target.targetUserGroupId }
          : { type: 'channel', id: target.targetChannelId };
    try {
      const result = await recordingService.revokeRecordingAccess(recording.externalId, [
        apiTarget,
      ]);
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.add(share.id));
          return next;
        });
      }
      if (result.linkedTicketId === null) {
        onTicketLinkUpdated?.({ linkedTicketId: null, linkedTicketMessageId: null });
      }
    } catch (error) {
      logRecordingError('RecordingShareModal.revoke', error);
      toast.error('Failed to remove access', {
        description: getApiErrorMessage(error, 'Unable to remove recording access'),
      });
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
        data-track-category='RecordingDetailV2'
        data-track-name='share_recording_message_input'
        onKeyDownCapture={event => {
          if (event.key === 'Enter' && !event.shiftKey && selectedValues.length > 0) {
            if (inputBoxRef.current?.isSuggestionOpen()) return;
            event.preventDefault();
            event.stopPropagation();
            void handleShare();
          }
        }}
      >
        <label htmlFor='share-recording-message' className='text-muted-foreground text-[13px]'>
          Add a message (optional)
        </label>
        <InputBox
          ref={inputBoxRef}
          id='share-recording-message'
          placeholder='Say something about this recording...'
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
          data-track-category='RecordingDetailV2'
          data-track-name='share_recording_confirm'
        >
          {sharing ? 'Sharing...' : 'Share'}
        </Button>
      </div>

      {shares.length > 0 && (
        <div className='space-y-2 border-t border-border pt-3'>
          <p className='text-muted-foreground text-[13px]'>People with access</p>
          <div className='space-y-3.5 max-h-60 overflow-y-auto pr-1'>
            {shares.map(share => {
              const target = share.userGroupId
                ? { targetUserGroupId: share.userGroupId }
                : share.channelId
                  ? { targetChannelId: share.channelId }
                  : { targetUserId: share.userId! };
              const label = share.userGroupId
                ? (share.userGroup?.name ?? share.userGroupId)
                : share.channelId
                  ? `${share.channel?.name ?? share.channelId}`
                  : share.user
                    ? getUserDisplayName(share.user)
                    : share.userId;
              const icon = share.userGroupId ? (
                <Users className='size-4 text-muted-foreground shrink-0' />
              ) : share.channelId ? (
                <Hash className='size-4 text-muted-foreground shrink-0' />
              ) : (
                <Avatar userId={share.userId ?? null} size='sm' showActiveStatus={false} />
              );
              // Link to the posted conversation.
              const post = getRecordingSharePost(share.metadata);

              return (
                <div key={share.id} className='group flex items-center justify-between gap-2'>
                  <div className='flex items-center gap-2 min-w-0'>
                    {icon}
                    <span className='text-sm truncate'>{label}</span>
                    {post && (
                      <Link
                        to={`/chat/dir/${post.channelId}/${post.conversationId}`}
                        className='shrink-0 text-muted-foreground transition-colors hover:text-foreground'
                        aria-label='Open shared conversation'
                        data-track-category='RecordingDetailV2'
                        data-track-name='open_recording_share_conversation'
                      >
                        <LinkChainSlant className='size-3.5' aria-hidden='true' />
                      </Link>
                    )}
                  </div>
                  <button
                    type='button'
                    onClick={() => void handleAccessChange(target)}
                    className='shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
                    aria-label='Remove access'
                    data-track-category='RecordingDetailV2'
                    data-track-name='revoke_recording_share'
                  >
                    <X className='size-3.5' />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className='space-y-2 border-t border-border pt-3'>
        <p className='text-muted-foreground text-[13px]'>General access</p>
        <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5'>
          <span className='w-9 h-9 rounded-full bg-background border border-border grid place-items-center shrink-0 text-muted-foreground'>
            {isPublic ? <Globe className='w-4 h-4' /> : <Lock className='w-4 h-4' />}
          </span>
          <div className='min-w-0 flex-1'>
            <div className='text-sm font-medium'>
              {isPublic ? 'Anyone with the link' : 'Restricted'}
            </div>
            <div className='text-xs text-muted-foreground mt-0.5'>
              {isPublic
                ? 'Anyone in the workspace with the link can view'
                : 'Only people with access can open'}
            </div>
          </div>
          {isCreator && (
            <Switch
              checked={isPublic}
              onCheckedChange={checked =>
                void handleVisibilityChange(
                  checked ? CallVisibility.PUBLIC : CallVisibility.PRIVATE,
                )
              }
              aria-label='Anyone with the link'
              id='recording-visibility-toggle'
            />
          )}
        </div>
        {isPublic && (
          <div className='flex justify-end'>
            <button
              type='button'
              onClick={() => void handleCopyLink()}
              className='inline-flex items-center gap-2 text-sm font-medium text-foreground rounded-md px-2.5 py-1.5 -mr-2.5 transition-colors hover:bg-accent hover:text-primary'
              data-testid='recording-copy-link-button'
              data-track-category='RecordingDetailV2'
              data-track-name='copy_recording_link'
            >
              <Link2 className='w-4 h-4' />
              Copy link
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordingShareModal;
