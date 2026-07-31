import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Hash } from 'lucide-react';
import { EntityUserAccess, MessageType } from '@xyne/shared';
import { useChannelSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { SearchParticipants } from '../../CallHistoryScreen/SearchParticipants';
import { useActiveUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { channelService } from '../../../services/Chat/channelService';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { logRecordingError } from '../../../utils/recordingUtils';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import type { RecordingDetail } from '../../../services/Recording/recordingService';

export interface PostRecordingToChannelModalProps {
  recording: RecordingDetail;
  onClose?: () => void;
}

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
  const activeUsers = useActiveUsers();
  const shareableOrigin = useShareableOrigin();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);

  const channels = useChannelSearch(searchQuery, 10);

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
    if (note.trim()) {
      parts.push(`<p>${escapeHtml(note.trim())}</p>`);
    }
    parts.push(
      `<p>\uD83C\uDFA5 <strong>${escapeHtml(title)}</strong><br/><a href="${link}">View recording</a></p>`,
    );
    return parts.join('');
  };

  // Grants a VIEW EntityAccess row for a single target (mirrors
  // RecordingShareModal's handleShare). Only the recording owner or a
  // workspace admin can call this successfully — the mutator itself enforces
  // that server-side and throws otherwise.
  const grantEntityAccess = async (
    target: { targetUserId: string } | { targetChannelId: string },
  ): Promise<boolean> => {
    try {
      const result = zero.mutate(
        mutators.calls.shareRecording({
          id: uuidv4(),
          callId: recording.externalId,
          ...target,
          entityUserAccess: EntityUserAccess.VIEW,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error('Failed to grant access', { description: res.error.message });
        return false;
      }
      return true;
    } catch (err) {
      logRecordingError('PostRecordingToChannelModal.grantEntityAccess', err);
      toast.error('Failed to grant access');
      return false;
    }
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

      for (const channelId of channelTargets) {
        const granted = await grantEntityAccess({ targetChannelId: channelId });
        if (!granted) continue;
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
        const grantedUserIds: string[] = [];
        for (const userId of userTargets) {
          const granted = await grantEntityAccess({ targetUserId: userId });
          if (granted) grantedUserIds.push(userId);
        }
        if (grantedUserIds.length > 0) {
          try {
            await channelService.createDm({ participantIds: grantedUserIds, message: content });
            successes += 1;
          } catch (err) {
            logRecordingError('PostRecordingToChannelModal.sendDm', err);
            toast.error('Failed to send message');
          }
        }
      }

      if (successes > 0) {
        toast.success('Recording shared');
        setSelectedValues([]);
        setSearchQuery('');
        setNote('');
        onClose?.();
      }
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
          options={options}
          selectedValues={selectedValues}
          onMultiSelect={setSelectedValues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
      </div>

      <div className='space-y-1.5'>
        <label htmlFor='post-recording-note' className='text-muted-foreground text-[13px]'>
          Add a message (optional)
        </label>
        <textarea
          id='post-recording-note'
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder='Say something about this recording...'
          rows={3}
          className='w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
          data-track-category='RecordingDetailV2'
          data-track-name='post_recording_note_input'
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
