import React, { useCallback } from 'react';
import Avatar from '../Avatar/Avatar';
import { Hash, Lock } from 'lucide-react';
import { PluginKey } from '@tiptap/pm/state';
import { UserStatus } from '@xyne/shared';
import type { MentionSelectorProps, MentionResult } from './Selectors.types';
import { detectMentionTrigger, detectChannelTrigger, createVirtualAnchor } from './Selectors.utils';
import { mentionPluginKey, channelMentionPluginKey } from '../TipTapExtensions';
import { BasePopoverSelector, type BaseSelectorPluginState } from './BasePopoverSelector';
import { useUser } from '../../../hooks/useUsers';
import { isStatusExpired } from '../../../utils/statusUtils';
import { renderEmoji } from '../../../utils/customEmojiUtils';

/**
 * Sub-component to render user avatar with resolved profile picture URL.
 * Hooks must be called at component top level, not inside callbacks.
 */
const UserAvatarItem: React.FC<{ item: MentionResult }> = ({ item }) => {
  const user = useUser(item.id);
  const hasValidStatus =
    user?.statusEmoji && (!user.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));
  const statusText = hasValidStatus && user?.statusContent ? user.statusContent : undefined;
  const isDeactivated = user?.status === UserStatus.INACTIVE || item.isDeactivated;

  return (
    <>
      <Avatar userId={item.id} size='sm' rounded showActiveStatus={false} />
      <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <span
            className={`text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {item.name}
          </span>
          {hasValidStatus && !isDeactivated && (
            <span className='inline-flex flex-shrink-0'>{renderEmoji(user.statusEmoji || '')}</span>
          )}
          {statusText && !isDeactivated && (
            <span className='text-sm text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
              {statusText}
            </span>
          )}
          {item.isChannelMember === false && (
            <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
              Not in channel
            </span>
          )}
          {isDeactivated && (
            <span className='text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0'>
              Deactivated
            </span>
          )}
        </div>
        {item.email && (
          <span className='text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
            {item.email}
          </span>
        )}
      </div>
    </>
  );
};

export const MentionSelector: React.FC<MentionSelectorProps> = ({
  editor,
  mentionItems,
  onMentionSearch,
  onMentionSelect,
  triggerChar = '@',
}) => {
  const pluginKey = triggerChar === '#' ? channelMentionPluginKey : mentionPluginKey;
  const detectFunc = triggerChar === '#' ? detectChannelTrigger : detectMentionTrigger;

  const detectTriggerWithSearch = useCallback(
    (ed: typeof editor) => {
      if (!ed) return null;
      const trigger = detectFunc(ed);
      if (trigger) {
        onMentionSearch?.(trigger.query);
      }
      return trigger;
    },
    [onMentionSearch, detectFunc],
  );

  const handleSelect = useCallback(
    (mention: MentionResult) => {
      if (!editor) return;

      const { state } = editor;
      const { from } = state.selection;
      const { $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');

      // Match pattern based on trigger character
      const pattern = triggerChar === '#' ? /#([\w-]*)$/ : /@([\w\s-]*)$/;
      const mentionMatch = textBefore.match(pattern);

      if (mentionMatch) {
        const mentionStart = from - mentionMatch[0].length;
        const mentionEnd = from;

        // Handle channel mentions (triggered by #)
        if (triggerChar === '#' && mention.type === 'channel') {
          editor
            .chain()
            .focus()
            .deleteRange({ from: mentionStart, to: mentionEnd })
            .insertChannelMention({
              channelId: mention.id,
              channelName: mention.name,
              isPrivate: mention.isPrivate ?? false,
            })
            .insertContent(' ')
            .run();
        }
        // Handle @ special mentions (@channel, @here)
        else if (triggerChar === '@' && (mention.type === 'channel' || mention.type === 'here')) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: mentionStart, to: mentionEnd })
            .insertSpecialMention({
              mentionType: mention.type,
            })
            .insertContent(' ')
            .run();
        }
        // Handle user mentions
        else if (mention.type === 'user') {
          editor
            .chain()
            .focus()
            .deleteRange({ from: mentionStart, to: mentionEnd })
            .insertMention({
              userId: mention.id,
              username: mention.name.replace(/ \(you\)$/, ''),
              ...(mention.email !== undefined && { userEmail: mention.email }),
              ...(mention.picture !== undefined && { userPicture: mention.picture }),
            })
            .insertContent(' ')
            .run();
        }
        // Handle group mentions
        else if (mention.type === 'group') {
          editor
            .chain()
            .focus()
            .deleteRange({ from: mentionStart, to: mentionEnd })
            .insertGroupMention({
              groupId: mention.id,
              groupName: mention.name,
              ...(mention.alias !== undefined && { groupAlias: mention.alias }),
              ...(mention.description !== undefined && { description: mention.description }),
            })
            .insertContent(' ')
            .run();
        }
      }

      onMentionSelect?.(mention);
    },
    [editor, onMentionSelect, triggerChar],
  );

  const mentionBasedClass = triggerChar === '#' ? 'h-8' : 'p-3 gap-3 rounded-xl';
  const emptyMessage = triggerChar === '#' ? 'No channels found' : 'No users or groups found';

  const renderItem = useCallback(
    (item: MentionResult, _index: number, isSelected: boolean) => {
      return (
        <div
          className={`flex items-center transition-all duration-200 ease-in active:scale-[0.98] ${mentionBasedClass} ${
            isSelected ? 'bg-accent' : ''
          }`}
        >
          {/* Channel mentions (triggered by #) */}
          {triggerChar === '#' && item.type === 'channel' ? (
            <>
              <div className='w-8 h-8 flex items-center justify-center flex-shrink-0'>
                {item.isPrivate ? (
                  <Lock className='h-3.5 w-3.5 text-muted-foreground' />
                ) : (
                  <Hash className='h-3.5 w-3.5 text-muted-foreground' />
                )}
              </div>
              <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
                <span className='text-sm font-medium text-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
                  {item.name}
                </span>
              </div>
            </>
          ) : item.isSpecial ? (
            <>
              <div className='w-8 h-8 flex items-center justify-center bg-orange-50 rounded-full border border-orange-200 flex-shrink-0'>
                <span className='text-base leading-none'>
                  {item.type === 'channel' ? '📢' : '👋'}
                </span>
              </div>
              <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
                <span className='text-sm font-medium text-orange-700 whitespace-nowrap overflow-hidden text-ellipsis'>
                  @{item.name}
                </span>
                <span className='text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
                  {item.description}
                </span>
              </div>
            </>
          ) : item.type === 'group' ? (
            <>
              <div
                className={`w-8 h-8 flex items-center justify-center rounded-full border flex-shrink-0 ${
                  item.isDeactivated
                    ? 'bg-muted border-muted-foreground/30'
                    : 'bg-green-50 border-green-200'
                }`}
              >
                <span className='text-base leading-none'>👥</span>
              </div>
              <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
                <span
                  className={`text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis ${
                    item.isDeactivated ? 'text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {item.alias ? `@${item.alias}` : item.name}
                  {item.isDeactivated && ' (Deactivated)'}
                </span>
                <span className='text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
                  {item.alias && item.name !== item.alias ? item.name : ''}
                </span>
              </div>
            </>
          ) : (
            <UserAvatarItem item={item} />
          )}
        </div>
      );
    },
    [triggerChar, mentionBasedClass],
  );

  return (
    <BasePopoverSelector<MentionResult>
      editor={editor}
      pluginKey={pluginKey as PluginKey<BaseSelectorPluginState<MentionResult>>}
      items={mentionItems}
      detectTrigger={detectTriggerWithSearch}
      getPosition={createVirtualAnchor}
      onSelect={handleSelect}
      renderItem={renderItem}
      emptyMessage={emptyMessage}
      className='w-80'
      triggerChar={triggerChar}
    />
  );
};
