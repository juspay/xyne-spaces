import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Hash, Lock } from 'lucide-react';
import { PluginKey } from '@tiptap/pm/state';
import { ChannelVisibility, type MentionResult } from '@xyne/shared';
import type { MentionSelectorProps } from './Selectors.types';
import { detectMentionTrigger, detectChannelTrigger, createVirtualAnchor } from './Selectors.utils';
import { mentionPluginKey, channelMentionPluginKey } from '../TipTapExtensions';
import { BasePopoverSelector, type BaseSelectorPluginState } from './BasePopoverSelector';
import {
  MENTION_MENU_CONTAINER,
  MentionMenu,
  MentionPersonRow,
  type MentionMenuHandle,
  type MentionMenuProps,
  type MentionRow,
} from '../../MentionMenu/MentionMenu';
import { resultTitle } from '../../MentionMenu/MentionMenu.utils';
import { pickFromResult } from '../../Composer/Composer.utils';
import { useUserPreference } from '../../../machines/userPreferencesMachine';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { computeSearchResultPath } from '../../../utils/searchNavigation';

/**
 * The all-context menu, clearing the rows it handed the selector when it
 * closes so the next "@" never starts on the previous one's rows.
 */
const AllContextMenu = React.forwardRef<
  MentionMenuHandle,
  Omit<MentionMenuProps, 'mode' | 'onRowsChange'> & {
    onRowsChange: (rows: MentionRow[]) => void;
  }
>(function AllContextMenu({ onRowsChange, ...props }, ref) {
  const latest = useRef(onRowsChange);
  latest.current = onRowsChange;
  useEffect(() => (): void => latest.current([]), []);
  return (
    <MentionMenu ref={ref} mode='all' onRowsChange={rows => onRowsChange([...rows])} {...props} />
  );
});

export const MentionSelector: React.FC<MentionSelectorProps> = ({
  editor,
  mentionItems,
  onMentionSearch,
  onMentionSelect,
  triggerChar = '@',
  allowAllMode = false,
}) => {
  const pluginKey = triggerChar === '#' ? channelMentionPluginKey : mentionPluginKey;
  const detectFunc = triggerChar === '#' ? detectChannelTrigger : detectMentionTrigger;
  const menuMode = useUserPreference('mentionMenuMode');
  // Other editors (Slack replies, automation fields) can't hold channel pills or
  // Xyne links, so they keep the people list whatever the setting.
  const allMode = allowAllMode && triggerChar === '@' && menuMode === 'all';
  const shareableOrigin = useShareableOrigin();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<MentionRow[]>([]);
  const menuRef = useRef<MentionMenuHandle>(null);

  const detectTriggerWithSearch = useCallback(
    (ed: typeof editor) => {
      if (!ed) return null;
      const trigger = detectFunc(ed);
      if (trigger) {
        const searchQuery = trigger.query.replace(/[.,!?:;)]*$/, '');
        onMentionSearch?.(searchQuery);
        setQuery(searchQuery);
      }
      return trigger;
    },
    [onMentionSearch, detectFunc],
  );

  /** The typed "@…" / "#…" before the caret, which a pick replaces. */
  const triggerRange = useCallback((): { from: number; to: number } | null => {
    if (!editor) return null;
    const { from, $from } = editor.state.selection;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');

    // Match pattern based on trigger character
    const pattern = triggerChar === '#' ? /#([\w-]*)$/ : /@([\w\s.-]*)$/;
    const mentionMatch = textBefore.match(pattern);
    return mentionMatch ? { from: from - mentionMatch[0].length, to: from } : null;
  }, [editor, triggerChar]);

  const handleSelect = useCallback(
    (mention: MentionResult) => {
      if (!editor) return;

      const range = triggerRange();
      if (range) {
        // Handle channel mentions (triggered by #)
        if (triggerChar === '#' && mention.type === 'channel') {
          editor
            .chain()
            .focus()
            .deleteRange(range)
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
            .deleteRange(range)
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
            .deleteRange(range)
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
            .deleteRange(range)
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
    [editor, onMentionSelect, triggerChar, triggerRange],
  );

  /**
   * A pick from the all-context menu. People keep their mention pills and
   * channels become channel pills; a message, file, canvas or ticket can't be
   * mentioned in chat, so it goes in as a link to it.
   */
  const handleRowSelect = useCallback(
    (row: MentionRow) => {
      if (!editor) return;
      if (row.type === 'person') {
        handleSelect(row.person);
        return;
      }
      const range = triggerRange();
      if (!range || row.type === 'app') return;

      if (row.type === 'channel') {
        // An editor without channel pills has no command to insert one.
        if (!editor.schema.nodes['channelMention']) return;
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertChannelMention({
            channelId: row.channel.id,
            channelName: row.displayName,
            isPrivate: row.channel.visibility === ChannelVisibility.PRIVATE,
          })
          .insertContent(' ')
          .run();
        return;
      }

      const { result } = row;
      const target = computeSearchResultPath(result);
      const href =
        target?.kind === 'internal'
          ? `${shareableOrigin}${target.path}`
          : target?.kind === 'external'
            ? target.url
            : null;
      // The label reads like the AI composer's token ("Emma's message", a file
      // name, a ticket id); with nowhere to point it stays plain text.
      const label = pickFromResult(result)?.mention || resultTitle(result) || 'Link';
      const marks =
        href && editor.schema.marks['link'] ? [{ type: 'link', attrs: { href } }] : undefined;
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          { type: 'text', text: label, ...(marks && { marks }) },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    [editor, handleSelect, triggerRange, shareableOrigin],
  );

  const cycleSection = useCallback(
    (backwards: boolean) => menuRef.current?.cycleSection(backwards),
    [],
  );

  const renderAllList = useCallback(
    ({
      selectedIndex,
      setSelectedIndex,
      select,
    }: {
      selectedIndex: number;
      setSelectedIndex: (index: number) => void;
      select: (row: MentionRow) => void;
    }) => (
      <AllContextMenu
        ref={menuRef}
        query={query}
        defaultSection='people'
        people={mentionItems}
        highlightedIndex={selectedIndex}
        onHighlightedIndexChange={setSelectedIndex}
        onRowsChange={setRows}
        onSelect={select}
        trackCategory='CHAT_INPUT'
      />
    ),
    [query, mentionItems],
  );

  const emptyMessage = triggerChar === '#' ? 'No channels found' : 'No users or groups found';

  const renderItem = useCallback(
    (item: MentionResult, _index: number, isSelected: boolean) => {
      // People, groups and @channel/@here: the same rows as the AI composer's people list.
      if (triggerChar !== '#' || item.type !== 'channel') {
        return <MentionPersonRow item={item} selected={isSelected} />;
      }
      // Channel mentions (triggered by #)
      return (
        <div
          className={`flex items-center transition-[transform,background-color] duration-200 ease-in active:scale-[0.98] h-8 ${
            isSelected ? 'bg-accent' : ''
          }`}
        >
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
        </div>
      );
    },
    [triggerChar],
  );

  if (allMode) {
    return (
      <BasePopoverSelector<MentionRow>
        // Keyed apart from the people list, so a preference switch never
        // carries one's open state and items into the other.
        key='all'
        editor={editor}
        // The plugin only counts and indexes its items, whatever their shape.
        pluginKey={mentionPluginKey as unknown as PluginKey<BaseSelectorPluginState<MentionRow>>}
        items={rows}
        detectTrigger={detectTriggerWithSearch}
        getPosition={createVirtualAnchor}
        onSelect={handleRowSelect}
        renderList={renderAllList}
        onTab={cycleSection}
        contentClassName={MENTION_MENU_CONTAINER.all}
        triggerChar={triggerChar}
      />
    );
  }

  return (
    <BasePopoverSelector<MentionResult>
      key='people'
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
