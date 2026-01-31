import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { CommandItem } from '../Selectors/Selectors.types';
import type { BaseSelectorPluginState } from '../Selectors';
import { createSelectorPlugin } from '../Selectors';

export type CommandPluginState = BaseSelectorPluginState<CommandItem>;

export const commandPluginKey = new PluginKey<CommandPluginState>('commandSelector');

export const CommandsExtension = Extension.create({
  name: 'commandSelector',

  addProseMirrorPlugins() {
    return [
      createSelectorPlugin({
        pluginKey: commandPluginKey,
      }),
    ];
  },
});
