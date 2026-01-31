import { Node, mergeAttributes } from '@tiptap/core';

export const InlineEmoji = Node.create({
  name: 'inlineEmoji',

  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      emojiId: {
        default: null,
        parseHTML: element => element.getAttribute('data-emoji-id'),
      },
      src: {
        default: null,
        parseHTML: element => element.getAttribute('src'),
      },
      alt: {
        default: null,
        parseHTML: element => element.getAttribute('alt'),
      },
      title: {
        default: null,
        parseHTML: element => element.getAttribute('title'),
      },
    };
  },

  renderText({ node }): string {
    return (node.attrs['alt'] as string) || '';
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-emoji="false"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-emoji': 'false',
        'data-emoji-id': HTMLAttributes['emojiId'] as string,
        class: 'inline-emoji',
      }),
    ];
  },
});
