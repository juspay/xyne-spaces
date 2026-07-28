import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Hashtag, UserTwo } from '@xyne/icons';
import { ChannelScopeType, ChannelVisibility, type User, type Channel } from '@xyne/shared';
import { InputBox } from '../../../ui/InputBox';
import { useAuth } from '../../../../hooks/useAuth';
import { useZero } from '../../../../hooks/useZero';
import { useActiveUserSearch } from '../../../../hooks/useUsers';
import { useChannelSearch } from '../../../../hooks/useChannels';
import { channelService } from '../../../../services/Chat/channelService';
import { mutators } from '../../../../zero/mutators';
import { sendConversationWithAttachments } from '../../AddDmForm/useExistingDmChannel';
import Avatar from '../../../ui/Avatar/Avatar';
import { OverlayZIndexContext } from '../../../../contexts/OverlayZIndexContext';
import { getUserDisplayName, userToMentionResult } from '../../../../utils/userDisplayName';

/**
 * A slash-command target: a 1:1 user or an existing channel. Shared with ChannelCommandMenu.
 * A group DM is a channel under the hood; `isDm` makes it read like a DM (friendly participant
 * label, no `#`) and `displayName` carries that label so callers don't re-resolve it.
 */
export type CommandTarget =
  | { type: 'user'; user: User }
  | { type: 'channel'; channel: Channel; displayName?: string; isDm?: boolean };

// Result limits for the in-composer `@`/`#` mention pickers.
const MENTION_USER_LIMIT = 20;
const MENTION_CHANNEL_LIMIT = 10;

interface QuickDmComposerProps {
  target: CommandTarget;
  /** Called after the message is sent successfully. */
  onSent: () => void;
  /** Called to go back to the target picker. */
  onBack: () => void;
}

/**
 * The `/chat` compose step. Reuses the real message composer (InputBox) so `@`/`#`
 * mentions, formatting and attachments all work, and sends through the same path as
 * ComposeDmPanel. A user target creates/reuses the DM first; a channel target posts
 * straight to the channel. No navigation.
 */
export const QuickDmComposer: React.FC<QuickDmComposerProps> = ({ target, onSent, onBack }) => {
  const { user } = useAuth();
  const zero = useZero();
  const isChannel = target.type === 'channel';
  // A group DM is a channel, but should render like a DM (no `#`, group icon, participant label).
  const isGroupDm = target.type === 'channel' && target.isDm === true;
  const isRealChannel = isChannel && !isGroupDm;
  const targetName =
    target.type === 'channel'
      ? (target.displayName ?? target.channel.name)
      : getUserDisplayName(target.user);
  const targetId = isChannel ? target.channel.id : target.user.id;

  // @-mention users. The channel-scoped useMentionSearch returns nothing without a
  // channel, so build items straight from the workspace user search (any user is
  // mentionable in a new DM message).
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionUsers = useActiveUserSearch(mentionQuery, MENTION_USER_LIMIT);
  const mentionItems = useMemo(
    () => mentionUsers.map(u => userToMentionResult(u, u.id === user?.id)),
    [mentionUsers, user?.id],
  );
  const handleMentionSearch = useCallback((query: string) => setMentionQuery(query), []);

  // #-mention channels.
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const channelResults = useChannelSearch(channelSearchQuery, MENTION_CHANNEL_LIMIT);
  const handleChannelSearch = useCallback((query: string) => setChannelSearchQuery(query), []);

  const channelItems = useMemo(() => {
    if (!channelResults || channelResults.length === 0) return [];
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

  const handleSendMessage = useCallback(
    (_plainText: string, html: string, files: File[]): void => {
      const senderId = user?.id;
      if (!senderId) return;
      // Close immediately and send in the background. InputBox select-alls the message
      // then awaits this callback, so awaiting the API calls here would leave the
      // message sitting selected (grey) with a spinner until they finish. Optimistic
      // send keeps `/chat` snappy; a toast reports failure.
      onSent();
      void (async () => {
        try {
          // Channel: post straight to the channel. User: create/reuse the 1:1 DM first.
          let channelId: string;
          if (target.type === 'channel') {
            channelId = target.channel.id;
          } else {
            const dm = await channelService.createDm({
              participantIds: [senderId, target.user.id],
            });
            channelId = dm.id;
            // The DM may have been closed — reopen it so it reappears in the sender's sidebar
            // (matches ComposeDmPanel's isExisting handling).
            if (dm.isExisting) {
              zero.mutate(mutators.channel.reopenDm({ channelId: dm.id, updatedAt: Date.now() }));
            }
          }
          await sendConversationWithAttachments(channelId, html, files);
          toast.success(`Message sent to ${isRealChannel ? `#${targetName}` : targetName}`);
        } catch (error) {
          toast.error('Failed to send message', {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
        }
      })();
    },
    [user?.id, target, isRealChannel, targetName, onSent, zero],
  );

  return (
    <div className='flex flex-col'>
      {/* Target header */}
      <div className='flex items-center justify-between px-4 py-2.5 border-b border-border'>
        <div className='flex items-center gap-2 text-sm'>
          <span className='text-muted-foreground'>Message to</span>
          <span className='inline-flex items-center gap-1.5 px-1.5 py-1 rounded bg-muted text-xs font-medium text-foreground'>
            {isRealChannel ? (
              <Hashtag className='size-4' />
            ) : isGroupDm ? (
              <UserTwo className='size-4' />
            ) : (
              <Avatar userId={targetId} size='xs' />
            )}
            {targetName}
          </span>
        </div>
        <button
          type='button'
          onClick={onBack}
          className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
          aria-label='Change target'
          data-track-category='CHANNEL_SEARCH'
          data-track-name='QUICK_DM_CHANGE_RECIPIENT'
        >
          <X className='size-4' />
        </button>
      </div>

      {/* Real composer. This lives inside the Cmd+K dialog (z-[9999]), and the mention/
          emoji popovers portal to <body> — raise them above the dialog so they're not
          hidden behind it. Scoped via context so no other InputBox is affected. */}
      <div className='px-3 py-3'>
        <OverlayZIndexContext.Provider value='z-[10000]'>
          <InputBox
            id={`quick-dm-${targetId}`}
            autoFocus='end'
            placeholder={`Message ${isRealChannel ? `#${targetName}` : targetName}...`}
            showTypingIndicator={false}
            mentionItems={mentionItems}
            onMentionSearch={handleMentionSearch}
            channelItems={channelItems}
            onChannelSearch={handleChannelSearch}
            onSendMessage={handleSendMessage}
            disableDraftUpload
            features={{ richText: true, mentions: true, fileAttachments: true, emojiPicker: true }}
          />
        </OverlayZIndexContext.Provider>
      </div>
    </div>
  );
};

export default QuickDmComposer;
