import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { PluginKey } from '@tiptap/pm/state';
import { BasePopoverSelector } from './BasePopoverSelector';
import type { BaseSelectorPluginState } from './BasePopoverSelector';
import { emojiSelectorPluginKey } from '../TipTapExtensions/EmojiSelectorExtension';
import { detectEmojiTrigger, createVirtualAnchor } from './Selectors.utils';
import { searchEmojis, emojiUsageToken } from '../../../utils/emojiSearch';
import type { EmojiSearchResult } from '../../../utils/emojiSearch';
import type { EmojiPickerEmoji } from '../../../hooks/useCustomEmojis';
import { useFrequentEmojiScope, useFrequentEmojis } from '../../../hooks/useFrequentEmojis';
import { recordEmojiUse } from '../../../utils/frequentEmojis';
import { FREQUENT_EMOJIS_MAX_TRACKED } from '../../../constants/settings';

interface EmojiSelectorProps {
  editor: Editor | null;
  customEmojis: EmojiPickerEmoji[];
}

export function EmojiSelector({
  editor,
  customEmojis,
}: EmojiSelectorProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');

  const frequentEmojiScope = useFrequentEmojiScope();
  const frequentEmojis = useFrequentEmojis(FREQUENT_EMOJIS_MAX_TRACKED);

  // Token → rank (0 = most used): orders the popover by how often this user actually
  // inserts each emoji, within the existing match tiers.
  const usageRanks = useMemo(() => {
    const ranks = new Map<string, number>();
    frequentEmojis.forEach((token, index) => ranks.set(token, index));
    return ranks;
  }, [frequentEmojis]);

  const detectTriggerWithSearch = useCallback((editorInstance: Editor) => {
    const trigger = detectEmojiTrigger(editorInstance);
    if (trigger) {
      setQuery(trigger.query);
    }
    return trigger;
  }, []);

  const [filteredEmojis, setFilteredEmojis] = useState<EmojiSearchResult[]>([]);

  useEffect(() => {
    if (query.length < 2) {
      setFilteredEmojis([]);
      return;
    }
    let cancelled = false;
    void searchEmojis(query, customEmojis, 8, usageRanks).then(results => {
      if (!cancelled) setFilteredEmojis(results);
    });
    return () => {
      cancelled = true;
    };
  }, [query, customEmojis, usageRanks]);

  const handleSelect = useCallback(
    (emoji: EmojiSearchResult) => {
      if (!editor) return;

      const { state } = editor;
      const { from } = state.selection;
      const { $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');

      const emojiMatch = textBefore.match(/(?:^|[\s\u200B]):(\w{2,})$/);

      if (emojiMatch) {
        const matchStart = from - emojiMatch[0].length;
        // Account for leading whitespace/ZWSP in the match
        const colonStart = matchStart + (emojiMatch[0].length - emojiMatch[1]!.length - 1);
        const matchEnd = from;

        if (emoji.isCustom && emoji.customEmojiId && emoji.customImgUrl) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: colonStart, to: matchEnd })
            .insertContent({
              type: 'inlineEmoji',
              attrs: {
                emojiId: emoji.customEmojiId,
                src: emoji.customImgUrl,
                alt: `:${emoji.shortName}:`,
                title: emoji.shortName,
              },
            })
            .run();
          recordEmojiUse(frequentEmojiScope, emojiUsageToken(emoji));
        } else if (emoji.native) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: colonStart, to: matchEnd })
            .insertContent(emoji.native)
            .run();
          recordEmojiUse(frequentEmojiScope, emojiUsageToken(emoji));
        }
      }
    },
    [editor, frequentEmojiScope],
  );

  const renderItem = useCallback(
    (emoji: EmojiSearchResult, _index: number, isSelected: boolean) => (
      <div
        className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
          isSelected ? 'text-accent-foreground' : 'text-foreground'
        }`}
      >
        <span className='text-lg w-6 text-center flex-shrink-0'>
          {emoji.isCustom && emoji.customImgUrl ? (
            <img
              src={emoji.customImgUrl}
              alt={`:${emoji.shortName}:`}
              className='w-5 h-5 inline-block object-contain'
            />
          ) : (
            emoji.native
          )}
        </span>
        <span className='truncate text-muted-foreground'>:{emoji.shortName}:</span>
      </div>
    ),
    [],
  );

  return (
    <BasePopoverSelector<EmojiSearchResult>
      editor={editor}
      pluginKey={emojiSelectorPluginKey as PluginKey<BaseSelectorPluginState<EmojiSearchResult>>}
      items={filteredEmojis}
      detectTrigger={detectTriggerWithSearch}
      getPosition={createVirtualAnchor}
      onSelect={handleSelect}
      renderItem={renderItem}
      emptyMessage='No emojis found'
      className='w-64'
      triggerChar=':'
    />
  );
}
