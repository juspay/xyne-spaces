import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { RecipientPillNodeView } from './RecipientPillNodeView';
import type { BaseSelectorPluginState } from '../Selectors';
import { createSelectorPlugin } from '../Selectors';

export interface RecipientSelectorItem {
  id: string;
  name: string;
  email: string;
  picture?: string;
  /** Present when email is already in To (informational; selection still allowed). */
  isInTo?: boolean;
}

export type RecipientSelectorPluginState = BaseSelectorPluginState<RecipientSelectorItem>;

export const recipientSelectorPluginKey = new PluginKey<RecipientSelectorPluginState>(
  'recipientSelector',
);

export interface RecipientPillOptions {
  HTMLAttributes: Record<string, unknown>;
  onRemoveRecipient?: (email: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    recipientPill: {
      insertRecipientPill: (attributes: {
        userId: string;
        name: string;
        email: string;
        picture?: string;
      }) => ReturnType;
    };
  }
}

const ZWSP = '\u200B';

const collectRecipientEmails = (doc: ProseMirrorNode, extensionName: string): Set<string> => {
  const emails = new Set<string>();
  doc.descendants(node => {
    if (node.type.name === extensionName) {
      const email = (node.attrs['email'] as string | null)?.toLowerCase().trim();
      if (email) emails.add(email);
    }
  });
  return emails;
};

export const RecipientPillExtension = Node.create<RecipientPillOptions>({
  name: 'recipientPill',

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
      userId: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-user-id'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['userId']) return {};
          return { 'data-user-id': attributes['userId'] as string };
        },
      },
      name: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-recipient-name'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['name']) return {};
          return { 'data-recipient-name': attributes['name'] as string };
        },
      },
      email: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-recipient-email'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['email']) return {};
          return { 'data-recipient-email': attributes['email'] as string };
        },
      },
      picture: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-user-picture'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['picture']) return {};
          return { 'data-user-picture': attributes['picture'] as string };
        },
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  parseHTML() {
    return [{ tag: 'span[data-recipient-pill]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as Record<string, unknown>;
    const name = attrs['name'] as string;
    const email = attrs['email'] as string;

    /* eslint-disable @typescript-eslint/naming-convention */
    const dataAttributes: Record<string, string> = {
      'data-recipient-pill': '',
      'data-recipient-email': email,
      'data-recipient-name': name,
    };
    if (attrs['userId']) dataAttributes['data-user-id'] = attrs['userId'] as string;
    if (attrs['picture']) dataAttributes['data-user-picture'] = attrs['picture'] as string;
    /* eslint-enable @typescript-eslint/naming-convention */

    return [
      'span',
      mergeAttributes(
        {
          ...dataAttributes,
          class: 'email-recipient-pill',
          contenteditable: 'false',
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      [
        'a',
        {
          href: `mailto:${email}`,
          class: 'email-recipient-pill-link',
          target: '_blank',
          rel: 'noopener noreferrer',
          tabindex: '-1',
        },
        ['span', { class: 'email-recipient-pill-label' }, `+${name}`],
      ],
    ];
  },

  renderText({ node }) {
    const name = node.attrs['name'] as string;
    return name || '';
  },

  addCommands() {
    return {
      insertRecipientPill:
        attributes =>
        ({ chain }) =>
          chain()
            .insertContent([
              { type: 'text', text: ZWSP },
              { type: this.name, attrs: attributes },
              { type: 'text', text: ZWSP },
            ])
            .run(),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecipientPillNodeView);
  },

  addProseMirrorPlugins() {
    const extensionName = this.name;
    const onRemoveRecipient = this.options.onRemoveRecipient;

    // Body → To (remove only): when a recipient pill leaves the document, drop that
    // email from To. To-field chip changes never touch the editor; adds via + are
    // handled in RecipientMentionSelector, not here.
    const syncPlugin = new Plugin({
      key: new PluginKey('recipientPillSync'),
      appendTransaction(transactions, oldState, newState) {
        if (!onRemoveRecipient) return null;
        if (!transactions.some(tr => tr.docChanged)) return null;

        const oldEmails = collectRecipientEmails(oldState.doc, extensionName);
        const newEmails = collectRecipientEmails(newState.doc, extensionName);

        for (const email of oldEmails) {
          if (!newEmails.has(email)) {
            onRemoveRecipient(email);
          }
        }
        return null;
      },
    });

    return [
      createSelectorPlugin({
        pluginKey: recipientSelectorPluginKey,
        customKeyHandler: (view: EditorView, event: KeyboardEvent): boolean => {
          const { state, dispatch } = view;
          const { selection } = state;
          const { $from } = selection;
          const mentionBefore = $from.nodeBefore;

          if (event.key === 'Backspace') {
            if (
              mentionBefore &&
              mentionBefore.type.name === 'text' &&
              mentionBefore.text === ZWSP
            ) {
              const posBeforeZWSP = $from.pos - 1;
              const $posBeforeZWSP = state.doc.resolve(posBeforeZWSP);
              const nodeBeforeZWSP = $posBeforeZWSP.nodeBefore;

              if (nodeBeforeZWSP && nodeBeforeZWSP.type.name === extensionName) {
                const tr = state.tr.delete($from.pos - 1, $from.pos);
                dispatch(tr);
                return true;
              }
            }

            if (mentionBefore && mentionBefore.type.name === extensionName) {
              const pillStart = $from.pos - mentionBefore.nodeSize;
              const tr = state.tr.delete(pillStart, $from.pos);
              dispatch(tr);
              return true;
            }
          }

          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
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
              const tr = state.tr.delete(foundPos, foundPos + foundNode.nodeSize);
              tr.insertText(event.key, foundPos);
              dispatch(tr);
              return true;
            }

            if (
              mentionBefore &&
              mentionBefore.type.name === 'text' &&
              mentionBefore.text === ZWSP
            ) {
              const posBeforeZWSP = $from.pos - 1;
              const $posBeforeZWSP = state.doc.resolve(posBeforeZWSP);
              const nodeBeforeZWSP = $posBeforeZWSP.nodeBefore;

              if (nodeBeforeZWSP && nodeBeforeZWSP.type.name === extensionName) {
                const tr = state.tr.delete($from.pos - 1, $from.pos);
                dispatch(tr);
                return false;
              }
            }
          }

          return false;
        },
      }),
      syncPlugin,
    ];
  },
});
