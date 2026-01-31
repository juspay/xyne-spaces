import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { MentionNodeView } from './MentionNodeView';
import type { BaseSelectorPluginState } from '../Selectors';
import { createSelectorPlugin } from '../Selectors';

export interface ChannelMentionOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface ChannelResult {
  id: string;
  name: string;
  isPrivate: boolean;
  description?: string;
}

export type ChannelMentionPluginState = BaseSelectorPluginState<ChannelResult>;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    channelMention: {
      insertChannelMention: (attributes: {
        channelId: string;
        channelName: string;
        isPrivate: boolean;
      }) => ReturnType;
      removeChannelMention: () => ReturnType;
    };
  }
}

const ZWSP = '\u200B'; // Zero-width space
export const channelMentionPluginKey = new PluginKey<ChannelMentionPluginState>(
  'channelMentionSelector',
);

export const ChannelMentionExtension = Node.create<ChannelMentionOptions>({
  name: 'channelMention',

  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
      channelId: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-channel-id'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['channelId']) return {};
          return { 'data-channel-id': attributes['channelId'] as string };
        },
      },
      channelName: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-channel-name'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['channelName']) return {};
          return { 'data-channel-name': attributes['channelName'] as string };
        },
      },
      isPrivate: {
        default: false,
        parseHTML: (element: HTMLElement): boolean =>
          element.getAttribute('data-is-private') === 'true',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          return { 'data-is-private': (attributes['isPrivate'] as boolean).toString() };
        },
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-channel-mention]',
      },
    ];
  },

  // eslint-disable-next-line @typescript-eslint/naming-convention
  renderHTML({ node, HTMLAttributes }): [string, Record<string, string | undefined>, string] {
    const attrs = node.attrs as Record<string, unknown>;
    const channelName = attrs['channelName'] as string;
    const isPrivate = attrs['isPrivate'] as boolean;
    const prefix = isPrivate ? '🔒' : '#';
    const className = 'chat-input-channel-mention';

    /* eslint-disable @typescript-eslint/naming-convention */
    const dataAttributes: Record<string, string> = {
      'data-channel-mention': '',
      'data-channel-id': attrs['channelId'] as string,
      'data-channel-name': channelName,
      'data-is-private': isPrivate.toString(),
    };

    return [
      'span',
      mergeAttributes(
        {
          ...dataAttributes,
          class: className,
          contenteditable: 'false',
          role: 'button',
          'aria-label': `Mention channel ${channelName}`,
          tabindex: '-1',
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `${prefix}${channelName}`,
    ];
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  renderText({ node }): string {
    const attrs = node.attrs as Record<string, unknown>;
    const channelName = attrs['channelName'] as string;
    const isPrivate = attrs['isPrivate'] as boolean;
    const prefix = isPrivate ? '🔒' : '#';
    return `${prefix}${channelName}`;
  },

  addCommands() {
    return {
      insertChannelMention:
        attributes =>
        ({ chain }): boolean => {
          return chain()
            .insertContent([
              { type: 'text', text: ZWSP },
              { type: this.name, attrs: attributes },
              { type: 'text', text: ZWSP },
            ])
            .run();
        },
      removeChannelMention:
        () =>
        ({ tr, state }): boolean => {
          const { selection } = state;
          const { $from } = selection;

          // Find channel mention node at or before cursor
          let foundNode: ProseMirrorNode | undefined;
          let foundPos: number | undefined;

          state.doc.nodesBetween($from.pos - 1, $from.pos + 1, (node, pos): boolean => {
            if (node.type.name === this.name) {
              foundNode = node;
              foundPos = pos;
              return false;
            }
            return true;
          });

          if (foundNode && foundPos !== undefined) {
            const channelName = foundNode.attrs['channelName'] as string;
            const isPrivate = foundNode.attrs['isPrivate'] as boolean;
            const prefix = isPrivate ? '🔒' : '#';
            tr.replaceWith(
              foundPos,
              foundPos + foundNode.nodeSize,
              state.schema.text(`${prefix}${channelName}`),
            );
            return true;
          }

          return false;
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },

  addProseMirrorPlugins() {
    const extensionName = this.name;

    return [
      createSelectorPlugin({
        pluginKey: channelMentionPluginKey,
        customKeyHandler: (view: EditorView, event: KeyboardEvent): boolean => {
          const { state, dispatch } = view;
          const { selection } = state;
          const { $from } = selection;

          // Check if we're at or inside a channel mention
          const mentionBefore = $from.nodeBefore;

          // Handle backspace at right guard (after channel mention)
          if (event.key === 'Backspace') {
            // Check if the character before cursor is ZWSP and before that is a channel mention
            if (
              mentionBefore &&
              mentionBefore.type.name === 'text' &&
              mentionBefore.text === ZWSP
            ) {
              const posBeforeZWSP = $from.pos - 1;
              const $posBeforeZWSP = state.doc.resolve(posBeforeZWSP);
              const nodeBeforeZWSP = $posBeforeZWSP.nodeBefore;

              if (nodeBeforeZWSP && nodeBeforeZWSP.type.name === extensionName) {
                // Delete the right ZWSP guard first
                const tr = state.tr.delete($from.pos - 1, $from.pos);
                dispatch(tr);
                return true;
              }
            }

            // If we're right after a channel mention node, unwrap it
            if (mentionBefore && mentionBefore.type.name === extensionName) {
              const channelName = mentionBefore.attrs['channelName'] as string;
              const isPrivate = mentionBefore.attrs['isPrivate'] as boolean;
              const prefix = isPrivate ? '🔒' : '#';
              const mentionStart = $from.pos - mentionBefore.nodeSize;
              const tr = state.tr.replaceWith(
                mentionStart,
                $from.pos,
                state.schema.text(`${prefix}${channelName}`),
              );
              dispatch(tr);
              return true;
            }
          }

          // Handle typing when cursor intersects a channel mention
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            // Check if cursor is touching a channel mention node
            let foundNode: ProseMirrorNode | undefined;
            let foundPos: number | undefined;

            state.doc.nodesBetween(
              $from.pos - 1,
              $from.pos + 1,
              (node: ProseMirrorNode, pos: number): boolean => {
                if (node.type.name === extensionName) {
                  foundNode = node;
                  foundPos = pos;
                  return false;
                }
                return true;
              },
            );

            if (foundNode && foundPos !== undefined) {
              // Unwrap channel mention to plain text, then insert the character
              const channelName = foundNode.attrs['channelName'] as string;
              const isPrivate = foundNode.attrs['isPrivate'] as boolean;
              const prefix = isPrivate ? '🔒' : '#';
              const tr = state.tr;

              // Replace channel mention with plain text
              tr.replaceWith(
                foundPos,
                foundPos + foundNode.nodeSize,
                state.schema.text(`${prefix}${channelName}`),
              );

              // Insert the typed character
              tr.insertText(event.key, foundPos + prefix.length + channelName.length);

              dispatch(tr);
              return true;
            }

            // Check if we're right after ZWSP guard (typing immediately after channel mention)
            if (
              mentionBefore &&
              mentionBefore.type.name === 'text' &&
              mentionBefore.text === ZWSP
            ) {
              const posBeforeZWSP = $from.pos - 1;
              const $posBeforeZWSP = state.doc.resolve(posBeforeZWSP);
              const nodeBeforeZWSP = $posBeforeZWSP.nodeBefore;

              if (nodeBeforeZWSP && nodeBeforeZWSP.type.name === extensionName) {
                // Delete the right ZWSP guard, then let the character insert normally
                const tr = state.tr.delete($from.pos - 1, $from.pos);
                dispatch(tr);
                // Let the default handler insert the character
                return false;
              }
            }
          }

          return false;
        },
      }),
    ];
  },
});
