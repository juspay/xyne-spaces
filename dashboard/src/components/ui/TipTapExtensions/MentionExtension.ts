import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { MentionNodeView } from './MentionNodeView';
import {
  UserMentionAction,
  GroupMentionAction,
  UserMentionActionType,
  GroupMentionActionType,
} from '../MentionText';
import type { MentionResult } from '@xyne/shared';
import type { BaseSelectorPluginState } from '../Selectors';
import { createSelectorPlugin } from '../Selectors';

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  userActions?: UserMentionAction[];
  groupActions?: GroupMentionAction[];
  onUserAction?: (userId: string, action: UserMentionActionType) => void;
  onGroupAction?: (groupId: string, action: GroupMentionActionType) => void;
  preserveThreadRoute?: boolean;
}

export type MentionPluginState = BaseSelectorPluginState<MentionResult>;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mention: {
      insertMention: (attributes: {
        userId: string;
        username: string;
        userEmail?: string;
        userPicture?: string;
      }) => ReturnType;
      insertGroupMention: (attributes: {
        groupId: string;
        groupName: string;
        groupAlias?: string;
        description?: string;
        memberCount?: number;
      }) => ReturnType;
      insertSpecialMention: (attributes: { mentionType: 'channel' | 'here' }) => ReturnType;
      removeMention: () => ReturnType;
    };
  }
}

const ZWSP = '\u200B'; // Zero-width space
export const mentionPluginKey = new PluginKey<MentionPluginState>('mentionSelector');

export const MentionExtension = Node.create<MentionOptions>({
  name: 'mention',

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
      // User mention attributes
      userId: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-user-id'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['userId']) return {};
          return { 'data-user-id': attributes['userId'] as string };
        },
      },
      username: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-username'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['username']) return {};
          return { 'data-username': attributes['username'] as string };
        },
      },
      userEmail: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-user-email'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['userEmail']) return {};
          return { 'data-user-email': attributes['userEmail'] as string };
        },
      },
      userPicture: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-user-picture'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['userPicture']) return {};
          return { 'data-user-picture': attributes['userPicture'] as string };
        },
      },
      // Group mention attributes
      groupId: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-group-id'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['groupId']) return {};
          return { 'data-group-id': attributes['groupId'] as string };
        },
      },
      groupName: {
        default: null,
        parseHTML: (element: HTMLElement): string | null => element.getAttribute('data-group-name'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['groupName']) return {};
          return { 'data-group-name': attributes['groupName'] as string };
        },
      },
      groupAlias: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-group-alias'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['groupAlias']) return {};
          return { 'data-group-alias': attributes['groupAlias'] as string };
        },
      },
      description: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-description'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['description']) return {};
          return { 'data-description': attributes['description'] as string };
        },
      },
      memberCount: {
        default: 0,
        parseHTML: (element: HTMLElement): number =>
          parseInt(element.getAttribute('data-member-count') || '0', 10),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (attributes['memberCount'] === undefined || attributes['memberCount'] === null) {
            return {};
          }
          return { 'data-member-count': (attributes['memberCount'] as number).toString() };
        },
      },
      mentionType: {
        default: 'user',
        parseHTML: (element: HTMLElement): string =>
          element.getAttribute('data-mention-type') || 'user',
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          return { 'data-mention-type': (attributes['mentionType'] as string) || 'user' };
        },
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-mention]',
      },
    ];
  },

  // eslint-disable-next-line @typescript-eslint/naming-convention
  renderHTML({ node, HTMLAttributes }): [string, Record<string, string | undefined>, string] {
    const attrs = node.attrs as Record<string, unknown>;
    const mentionType = attrs['mentionType'] as string;
    const isGroup = mentionType === 'group' || attrs['groupId'];
    const isSpecial = mentionType === 'channel' || mentionType === 'here';

    const displayName = isSpecial
      ? mentionType
      : isGroup
        ? (attrs['groupAlias'] as string) || (attrs['groupName'] as string)
        : (attrs['username'] as string);

    const className = isSpecial
      ? 'chat-input-special-mention'
      : isGroup
        ? 'chat-input-group-mention'
        : 'chat-input-mention';

    const prefix = '@';

    /* eslint-disable @typescript-eslint/naming-convention */
    const dataAttributes: Record<string, string> = {
      'data-mention': '',
      'data-mention-type': mentionType,
    };

    // Define attribute mappings for data attributes
    const groupAttributes = [
      { attr: 'groupId', dataAttr: 'data-group-id', type: 'string' as const },
      { attr: 'groupName', dataAttr: 'data-group-name', type: 'string' as const },
      { attr: 'groupAlias', dataAttr: 'data-group-alias', type: 'string' as const },
      { attr: 'description', dataAttr: 'data-description', type: 'string' as const },
      { attr: 'memberCount', dataAttr: 'data-member-count', type: 'number' as const },
    ];

    const userAttributes = [
      { attr: 'userId', dataAttr: 'data-user-id', type: 'string' as const },
      { attr: 'username', dataAttr: 'data-username', type: 'string' as const },
      { attr: 'userEmail', dataAttr: 'data-user-email', type: 'string' as const },
      { attr: 'userPicture', dataAttr: 'data-user-picture', type: 'string' as const },
    ];

    // Add specific data attributes based on mention type (skip for special mentions)
    if (!isSpecial) {
      const attributesToApply = isGroup ? groupAttributes : userAttributes;
      for (const { attr, dataAttr, type } of attributesToApply) {
        if (attrs[attr]) {
          dataAttributes[dataAttr] =
            type === 'number' ? (attrs[attr] as number).toString() : (attrs[attr] as string);
        }
      }
    }

    return [
      'span',
      mergeAttributes(
        {
          ...dataAttributes,
          class: className,
          contenteditable: 'false',
          role: 'button',
          'aria-label': isGroup ? `Mention group ${displayName}` : `Mention ${displayName}`,
          tabindex: '-1',
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `${prefix}${displayName}`,
    ];
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  renderText({ node }): string {
    const attrs = node.attrs as Record<string, unknown>;
    const mentionType = attrs['mentionType'] as string;

    // Handle special mentions (@channel and @here)
    if (mentionType === 'channel') {
      return '@channel';
    }
    if (mentionType === 'here') {
      return '@here';
    }

    const isGroup = mentionType === 'group' || attrs['groupId'];
    const displayName = isGroup
      ? (attrs['groupAlias'] as string) || (attrs['groupName'] as string)
      : (attrs['username'] as string);
    const prefix = '@';
    return `${prefix}${displayName}`;
  },

  addCommands() {
    return {
      insertMention:
        attributes =>
        ({ chain, editor }) => {
          const isInCode = editor.isActive('codeBlock');

          if (isInCode) {
            // Slack-style mention inside code → plain text only
            return chain().insertContent(`@${attributes.username}`).run();
          }

          // Normal mention node (outside code block)
          return chain()
            .insertContent([
              { type: 'text', text: ZWSP },
              { type: this.name, attrs: { ...attributes, mentionType: 'user' } },
              { type: 'text', text: ZWSP },
            ])
            .run();
        },
      insertGroupMention:
        attributes =>
        ({ chain, editor }) => {
          const isInCode = editor.isActive('codeBlock');

          if (isInCode) {
            return chain().insertContent(`#${attributes.groupName}`).run();
          }

          return chain()
            .insertContent([
              { type: 'text', text: ZWSP },
              { type: this.name, attrs: { ...attributes, mentionType: 'group' } },
              { type: 'text', text: ZWSP },
            ])
            .run();
        },
      insertSpecialMention:
        attributes =>
        ({ chain, editor }) => {
          const isInCode = editor.isActive('codeBlock');

          if (isInCode) {
            return chain().insertContent(`@${attributes.mentionType}`).run();
          }

          return chain()
            .insertContent([
              { type: 'text', text: ZWSP },
              { type: this.name, attrs: { ...attributes } },
              { type: 'text', text: ZWSP },
            ])
            .run();
        },
      removeMention:
        () =>
        ({ tr, state }): boolean => {
          const { selection } = state;
          const { $from } = selection;

          // Find mention node at or before cursor
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
            const username = foundNode.attrs['username'] as string;
            tr.replaceWith(
              foundPos,
              foundPos + foundNode.nodeSize,
              state.schema.text(`@${username}`),
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

  addStorage() {
    return {
      userActions: this.options.userActions,
      groupActions: this.options.groupActions,
      onUserAction: this.options.onUserAction,
      onGroupAction: this.options.onGroupAction,
      preserveThreadRoute: this.options.preserveThreadRoute,
    };
  },

  addProseMirrorPlugins() {
    const extensionName = this.name;

    return [
      createSelectorPlugin({
        pluginKey: mentionPluginKey,
        customKeyHandler: (view: EditorView, event: KeyboardEvent): boolean => {
          const { state, dispatch } = view;
          const { selection } = state;
          const { $from } = selection;

          // Check if we're at or inside a mention
          const mentionBefore = $from.nodeBefore;

          // Handle backspace at right guard (after mention)
          if (event.key === 'Backspace') {
            // Check if the character before cursor is ZWSP and before that is a mention
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

            // If we're right after a mention node, unwrap it
            if (mentionBefore && mentionBefore.type.name === extensionName) {
              const username =
                (mentionBefore.attrs['username'] as string) ||
                (mentionBefore.attrs['groupName'] as string);
              const mentionStart = $from.pos - mentionBefore.nodeSize;
              const tr = state.tr.replaceWith(
                mentionStart,
                $from.pos,
                state.schema.text(`@${username}`),
              );
              dispatch(tr);
              return true;
            }
          }

          // Handle typing when cursor intersects a mention
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (!selection.empty) {
              let foundNode: ProseMirrorNode | undefined;
              let foundPos: number | undefined;

              state.doc.nodesBetween(
                selection.from,
                selection.to,
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
                // Unwrap mention to plain text, then insert the character
                const username =
                  (foundNode.attrs['username'] as string) ||
                  (foundNode.attrs['groupName'] as string);
                const tr = state.tr;

                // Replace mention with plain text
                tr.replaceWith(
                  foundPos,
                  foundPos + foundNode.nodeSize,
                  state.schema.text(`@${username}`),
                );

                // Insert the typed character
                tr.insertText(event.key, foundPos + username.length + 1);

                dispatch(tr);
                return true;
              }
            }

            // Check if we're right after ZWSP guard (typing immediately after mention)
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
