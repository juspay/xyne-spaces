// ColonEmojiExtension.ts
import { Extension, InputRule } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { findCustomEmoji, findUnicodeEmoji } from '../../../utils/emojiLookup';
import type { EmojiPickerEmoji } from '../../../hooks/useCustomEmojis';

const EMOJI_NAME_REGEX = /:([a-zA-Z0-9_+-]+):$/;

function createInlineEmojiNode(emojiName: string, customEmoji: EmojiPickerEmoji) {
  return {
    emojiId: customEmoji.id,
    src: customEmoji.imgUrl,
    alt: `:${emojiName}:`,
    title: emojiName,
    'data-emoji': 'true',
  };
}

function unifiedToEmoji(unified: string): string {
  return unified
    .split('-')
    .map(code => String.fromCodePoint(parseInt(code, 16)))
    .join('');
}

/**
 * Insert an emoji (custom or unicode) into the editor
 * Returns true if emoji was inserted, false otherwise
 */
function insertEmoji(
  view: EditorView,
  emojiName: string,
  customEmojis: EmojiPickerEmoji[],
  startPos: number,
  endPos: number,
): boolean {
  const customEmoji = findCustomEmoji(emojiName, customEmojis);

  if (customEmoji) {
    const inlineEmoji = view.state.schema.nodes['inlineEmoji'];
    if (inlineEmoji) {
      view.dispatch(
        view.state.tr
          .delete(startPos, endPos)
          .insert(startPos, inlineEmoji.create(createInlineEmojiNode(emojiName, customEmoji))),
      );
      return true;
    }
  }

  const unicodeEmoji = findUnicodeEmoji(emojiName);
  if (unicodeEmoji) {
    const emojiChar = unifiedToEmoji(unicodeEmoji.unified);
    view.dispatch(view.state.tr.delete(startPos, endPos).insertText(emojiChar, startPos));
    return true;
  }

  return false;
}

export const ColonEmojiExtension = Extension.create<{
  getCustomEmojis: () => EmojiPickerEmoji[];
}>({
  name: 'colonEmoji',

  addInputRules() {
    return [
      new InputRule({
        find: EMOJI_NAME_REGEX,
        handler: ({ state, range, match }) => {
          const emojiName = match[1];
          if (!emojiName) return;

          const customEmojis = this.options.getCustomEmojis();
          const customEmoji = findCustomEmoji(emojiName, customEmojis);

          if (customEmoji) {
            const inlineEmoji = state.schema.nodes['inlineEmoji'];
            if (inlineEmoji) {
              state.tr.replaceWith(
                range.from,
                range.to,
                inlineEmoji.create(createInlineEmojiNode(emojiName, customEmoji)),
              );
            }
            return;
          }

          const unicodeEmoji = findUnicodeEmoji(emojiName);
          if (unicodeEmoji) {
            const emojiChar = unifiedToEmoji(unicodeEmoji.unified);
            state.tr.insertText(emojiChar, range.from, range.to);
          }
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const getCustomEmojis = this.options.getCustomEmojis;

    return [
      new Plugin({
        props: {
          handlePaste(view, event): boolean {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) return false;

            const match = text.match(EMOJI_NAME_REGEX);
            if (!match) return false;

            const emojiName = match[1];
            if (!emojiName) return false;

            const { state } = view;
            const { from, to } = state.selection;

            return insertEmoji(view, emojiName, getCustomEmojis(), from, to);
          },
        },
      }),
    ];
  },
});
