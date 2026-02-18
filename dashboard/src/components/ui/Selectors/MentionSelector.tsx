import React, { useCallback } from 'react';
import { Avatar, AvatarSize, AvatarShape } from '@juspay/blend-design-system';
import { Hash, Lock } from 'lucide-react';
import { PluginKey } from '@tiptap/pm/state';
import type { MentionSelectorProps, MentionResult } from './Selectors.types';
import { detectMentionTrigger, detectChannelTrigger, createVirtualAnchor } from './Selectors.utils';
import { mentionPluginKey, channelMentionPluginKey } from '../TipTapExtensions';
import { BasePopoverSelector, type BaseSelectorPluginState } from './BasePopoverSelector';

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
      const pattern = triggerChar === '#' ? /#([\w-]*)$/ : /@([\w\s]*)$/;
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
              // ...(mention.memberCount !== undefined && { memberCount: mention.memberCount }),
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
    (item: MentionResult, _index: number, isSelected: boolean) => (
      <div
        className={`flex items-center transition-all duration-200 ease-in active:scale-[0.98] ${mentionBasedClass} ${
          isSelected ? 'bg-gray-200' : ''
        }`}
      >
        {/* Channel mentions (triggered by #) */}
        {triggerChar === '#' && item.type === 'channel' ? (
          <>
            <div className='w-8 h-8 flex items-center justify-center flex-shrink-0'>
              {item.isPrivate ? (
                <Lock className='h-3.5 w-3.5 text-gray-600' />
              ) : (
                <Hash className='h-3.5 w-3.5 text-gray-600' />
              )}
            </div>
            <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
              <span className='text-sm font-medium text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis'>
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
              <span className='text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis'>
                {item.description}
              </span>
            </div>
          </>
        ) : item.type === 'group' ? (
          <>
            <div className='w-8 h-8 flex items-center justify-center bg-green-50 rounded-full border border-green-200 flex-shrink-0'>
              <span className='text-base leading-none'>👥</span>
            </div>
            <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
              <span className='text-sm font-medium text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis'>
                {item.alias ? `@${item.alias}` : item.name}
              </span>
              <span className='text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis'>
                {item.alias && item.name !== item.alias ? item.name : ''}
                {/* {item.memberCount} member{item.memberCount !== 1 ? 's' : ''} */}
              </span>
            </div>
          </>
        ) : (
          <>
            <Avatar
              {...(item.picture !== undefined && { src: item.picture })}
              alt={item.name}
              fallback={item.avatar || item.name.charAt(0).toUpperCase()}
              size={AvatarSize.SM}
              shape={AvatarShape.CIRCULAR}
            />
            <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis'>
                  {item.name}
                </span>
                {item.isChannelMember === false && (
                  <span className='text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded'>
                    Not in channel
                  </span>
                )}
              </div>
              {item.email && (
                <span className='text-xs text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis'>
                  {item.email}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    ),
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
