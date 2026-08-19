import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Hash } from 'lucide-react';
import { ChannelScopeType, ChannelVisibility, MessageType } from '@xyne/shared';
import type { MentionResult } from '@xyne/shared';
import { useChannelSearch, useUserGroupSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { InputBox } from '../../../components/ui/InputBox';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { SearchParticipants } from '../../CallHistoryScreen/SearchParticipants';
import { useActiveUsers, useActiveUserSearch } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { channelService } from '../../../services/Chat/channelService';
import { getUserDisplayName, userToMentionResult } from '../../../utils/userDisplayName';
import { logRecordingError } from '../../../utils/recordingUtils';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import {
  recordingService,
  type RecordingDetail,
  type RecordingShareTarget,
} from '../../../services/Recording/recordingService';

export interface PostRecordingToChannelModalProps {
  recording: RecordingDetail;
  onClose?: () => void;
}

const MENTION_USER_LIMIT = 20;
const MENTION_GROUP_LIMIT = 10;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * PostRecordingToChannelModal lets the user post a recording — as a custom
 * message with a link back to the recording detail screen — into a channel,
 * or send it directly to one or more people (creating/opening a DM).
 *
 * Mirrors the target-picker UX already used for recording sharing
 * (RecordingShareModal). In addition to composing and sending a real chat
 * message (matching the existing "forward message" post-to-channel pattern),
 * it also grants each target an EntityAccess VIEW row — otherwise recipients
 * would receive a link they can't actually open.
 */
export const PostRecordingToChannelModal: React.FC<PostRecordingToChannelModalProps> = ({
  recording,
  onClose,
}) => {
  const zero = useZero();
  const { user: currentUser } = useAuth();
  const activeUsers = useActiveUsers();
  const shareableOrigin = useShareableOrigin();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [noteHtml, setNoteHtml] = useState('');
  const [noteText, setNoteText] = useState('');
  const [posting, setPosting] = useState(false);
  const inputBoxRef = useRef<InputBoxHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const channels = useChannelSearch(searchQuery, 10);
  const selectedChannelId = useMemo(
    () =>
      selectedValues.find(value => value.startsWith('channel:'))?.replace('channel:', '') ??
      undefined,
    [selectedValues],
  );

  const { results: channelScopedMentions, searchMentions: searchChannelScopedMentions } =
    useMentionSearch(selectedChannelId);

  // Fall back to a plain workspace search for DM targets — the same
  // pattern SendMessageRichTextField uses for a non-concrete channel.
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

  // #-channel search for the optional note.
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

  // Combined target search — active workspace users (for DM) and channels.
  // Selecting a channel is exclusive (SearchParticipants default behavior);
  // selecting users allows multiple (creates a DM/group DM).
  const options = useMemo(() => {
    const userOptions = activeUsers
      .filter(u => u.id !== recording.createdByUserId)
      .map(u => ({
        label: getUserDisplayName(u),
        subtitle: u.email ?? '',
        value: `user:${u.id}`,
        icon: <Avatar userId={u.id} size='sm' showActiveStatus={false} />,
      }));

    const channelOptions = channels.map(channel => ({
      label: channel.name,
      subtitle: 'Channel',
      value: `channel:${channel.id}`,
      icon: <Hash className='size-3.5 text-muted-foreground' />,
    }));

    return [...userOptions, ...channelOptions];
  }, [activeUsers, channels, recording.createdByUserId]);

  const buildMessageContent = (): string => {
    const title = recording.title?.trim() || 'Untitled Recording';
    // Must include the workspace segment (via useShareableOrigin) — a bare
    // window.location.origin link drops `/:workspaceId` and breaks navigation
    // (the /recordings/:id route only exists nested under /:workspaceId).
    const link = `${shareableOrigin}/recordings/${recording.externalId}`;
    const parts: string[] = [];
    // noteHtml is already rich-text markup from InputBox — don't escape it.
    if (noteText.trim()) {
      parts.push(noteHtml);
    }
    parts.push(
      `<p>\uD83C\uDFA5 <strong>${escapeHtml(title)}</strong><br/><a href="${link}">View recording</a></p>`,
    );
    return parts.join('');
  };

  const handlePost = async (): Promise<void> => {
    if (selectedValues.length === 0 || posting) return;

    setPosting(true);
    try {
      const content = buildMessageContent();
      const channelTargets = selectedValues
        .filter(value => value.startsWith('channel:'))
        .map(value => value.replace('channel:', ''));
      const userTargets = selectedValues
        .filter(value => value.startsWith('user:'))
        .map(value => value.replace('user:', ''));

      let successes = 0;

      const accessTargets: RecordingShareTarget[] = [
        ...channelTargets.map(id => ({ type: 'channel' as const, id })),
        ...userTargets.map(id => ({ type: 'user' as const, id })),
      ];
      await recordingService.grantRecordingAccess(recording.externalId, accessTargets);

      for (const channelId of channelTargets) {
        try {
          const result = zero.mutate(
            mutators.conversations.send({
              channelId,
              content,
              conversationId: uuidv4(),
              messageId: uuidv4(),
              timestamp: Date.now(),
              type: MessageType.USER,
            }),
          );
          const res = await result.server;
          if (res.type === 'error') {
            toast.error('Failed to post to channel', { description: res.error.message });
          } else {
            successes += 1;
          }
        } catch (err) {
          logRecordingError('PostRecordingToChannelModal.postToChannel', err);
          toast.error('Failed to post to channel');
        }
      }

      if (userTargets.length > 0) {
        try {
          await channelService.createDm({ participantIds: userTargets, message: content });
          successes += 1;
        } catch (err) {
          logRecordingError('PostRecordingToChannelModal.sendDm', err);
          toast.error('Failed to send message');
        }
      }

      if (successes > 0) {
        toast.success('Recording shared');
        setSelectedValues([]);
        setSearchQuery('');
        setNoteHtml('');
        setNoteText('');
        onClose?.();
      }
    } catch (error) {
      logRecordingError('PostRecordingToChannelModal.grantAccess', error);
      toast.error('Failed to grant recording access', {
        description: getApiErrorMessage(error, 'Unable to share this recording'),
      });
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className='flex flex-col w-full p-5 gap-4'>
      <div className='space-y-2'>
        <p className='text-muted-foreground text-[13px] leading-5'>
          Post this recording to a channel, or send it to people
        </p>
        <SearchParticipants
          ref={searchInputRef}
          options={options}
          selectedValues={selectedValues}
          onMultiSelect={setSelectedValues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
      </div>

      <div
        className='space-y-1.5'
        data-track-category='RecordingDetailV2'
        data-track-name='post_recording_note_input'
        onKeyDownCapture={event => {
          if (event.key === 'Enter' && !event.shiftKey && selectedValues.length > 0) {
            if (inputBoxRef.current?.isSuggestionOpen()) return;
            event.preventDefault();
            event.stopPropagation();
            void handlePost();
          }
        }}
      >
        <label htmlFor='post-recording-note' className='text-muted-foreground text-[13px]'>
          Add a message (optional)
        </label>
        <InputBox
          ref={inputBoxRef}
          id='post-recording-note'
          placeholder='Say something about this recording...'
          onSendMessage={() => {}}
          onContentChange={(html, text) => {
            setNoteHtml(html);
            setNoteText(text);
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
          disabled={posting}
          disableEnterToSend
          hideSendButton
        />
      </div>

      <div className='flex justify-end'>
        <Button
          size='sm'
          onClick={() => void handlePost()}
          disabled={selectedValues.length === 0 || posting}
          data-track-category='RecordingDetailV2'
          data-track-name='post_recording_to_channel_confirm'
        >
          {posting ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
};

export default PostRecordingToChannelModal;
