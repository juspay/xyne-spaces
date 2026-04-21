import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { BaseSelectorPluginState } from '../Selectors';
import { createSelectorPlugin } from '../Selectors';
import type { EmojiSearchResult } from '../../../utils/emojiSearch';

export type EmojiSelectorPluginState = BaseSelectorPluginState<EmojiSearchResult>;

export const emojiSelectorPluginKey = new PluginKey<EmojiSelectorPluginState>('emojiSelector');

export const EmojiSelectorExtension = Extension.create({
  name: 'emojiSelector',

  addProseMirrorPlugins() {
    return [
      createSelectorPlugin({
        pluginKey: emojiSelectorPluginKey,
      }),
    ];
  },
});
