import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { BaseSelectorPluginState, BaseSelectorItem } from './BasePopoverSelector';

export interface BaseSelectorPluginConfig<T extends BaseSelectorItem> {
  pluginKey: PluginKey<BaseSelectorPluginState<T>>;
  customKeyHandler?: (view: EditorView, event: KeyboardEvent) => boolean;
}

export function createSelectorPlugin<T extends BaseSelectorItem>(
  config: BaseSelectorPluginConfig<T>,
): Plugin {
  const { pluginKey, customKeyHandler } = config;

  return new Plugin({
    key: pluginKey,
    state: {
      init: (): BaseSelectorPluginState<T> => ({
        isOpen: false,
        selectedIndex: 0,
        items: [],
        shouldSelect: false,
      }),
      apply: (tr, value): BaseSelectorPluginState<T> => {
        const meta = tr.getMeta(pluginKey) as Partial<BaseSelectorPluginState<T>> | undefined;
        if (meta) {
          return { ...value, ...meta };
        }
        return value;
      },
    },
    props: {
      handleKeyDown(view, event): boolean {
        const { state, dispatch } = view;
        const pluginState = pluginKey.getState(state);

        if (pluginState && pluginState.isOpen && pluginState.items.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            const newIndex = (pluginState.selectedIndex + 1) % pluginState.items.length;
            dispatch(state.tr.setMeta(pluginKey, { selectedIndex: newIndex }));
            return true;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            const newIndex =
              (pluginState.selectedIndex - 1 + pluginState.items.length) % pluginState.items.length;
            dispatch(state.tr.setMeta(pluginKey, { selectedIndex: newIndex }));
            return true;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            dispatch(state.tr.setMeta(pluginKey, { shouldSelect: true }));
            return true;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            dispatch(state.tr.setMeta(pluginKey, { isOpen: false }));
            return true;
          }
        }

        if (customKeyHandler) {
          return customKeyHandler(view, event);
        }

        return false;
      },
    },
  });
}
