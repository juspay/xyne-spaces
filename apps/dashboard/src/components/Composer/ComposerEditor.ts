import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ContextRef, PickKind } from './Composer.types';
import { ATOM_PLACEHOLDER, mentionToken } from './Composer.utils';

/**
 * Inline pill for something picked from the @ or # menu. It reads as part of
 * the sentence ("summarize @Prakhar's message for #general") and is what the
 * agent sees in the text — the item itself rides once in the attached context.
 * An atom: Backspace removes the whole pill, which also detaches the item.
 */
export const ContextMention = Node.create({
  name: 'contextMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    // Kept on data-* attributes: a raw `id` attribute would put context ids
    // into the page's element ids.
    const dataAttribute = (
      name: string,
    ): {
      default: null;
      parseHTML: (element: HTMLElement) => string | null;
      renderHTML: (attributes: Record<string, unknown>) => Record<string, string>;
    } => ({
      default: null,
      parseHTML: (element: HTMLElement): string | null => element.getAttribute(`data-ctx-${name}`),
      renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
        const value = attributes[name];
        return typeof value === 'string' && value ? { [`data-ctx-${name}`]: value } : {};
      },
    });
    return {
      kind: dataAttribute('kind'),
      id: dataAttribute('id'),
      mention: dataAttribute('mention'),
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-context-mention]' }];
  },

  renderHTML({ node, HTMLAttributes: htmlAttributes }) {
    const kind = node.attrs['kind'] as PickKind;
    const mention = (node.attrs['mention'] as string | null) ?? '';
    return [
      'span',
      mergeAttributes(htmlAttributes, {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- DOM attribute
        'data-context-mention': '',
        contenteditable: 'false',
        class:
          // One unbroken pill: a long name truncates rather than splitting across lines.
          'inline-block max-w-[260px] truncate align-bottom rounded-[5px] bg-[var(--mention-bg)] px-1 font-medium text-[color:var(--mention-color)]',
      }),
      mentionToken(kind, mention),
    ];
  },

  renderText({ node }) {
    return mentionToken(
      node.attrs['kind'] as PickKind,
      (node.attrs['mention'] as string | null) ?? '',
    );
  },
});

/** Every pick referenced by an inline mention in the document. */
export function mentionRefs(doc: {
  descendants: (
    f: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void,
  ) => void;
}): ContextRef[] {
  const refs: ContextRef[] = [];
  doc.descendants(node => {
    if (node.type.name !== ContextMention.name) return;
    const kind = node.attrs['kind'] as PickKind | null;
    const id = node.attrs['id'] as string | null;
    if (kind && id) refs.push({ kind, id });
  });
  return refs;
}

/** A leading "/command" and the whitespace before it, read from the first line. */
const LEADING_COMMAND = /^(\s*)(\/([^\s@#/]+))/;

/**
 * The slash command a message starts with ("/design …"), painted like a
 * channel pill once it names a real command. Only a decoration: the text
 * stays plain and editable, so the agent still reads "/design" at the start.
 * The negative margin lets the pill's padding bleed out without moving the
 * text as it turns blue.
 */
export const CommandHighlight = Extension.create<{ isCommand: (name: string) => boolean }>({
  name: 'commandHighlight',

  addOptions() {
    return { isCommand: (): boolean => false };
  },

  addProseMirrorPlugins() {
    const { isCommand } = this.options;
    return [
      new Plugin({
        key: new PluginKey('commandHighlight'),
        props: {
          decorations: (state): DecorationSet | null => {
            const first = state.doc.firstChild;
            if (!first?.isTextblock) return null;
            const text = first.textBetween(0, first.content.size, undefined, ATOM_PLACEHOLDER);
            const match = LEADING_COMMAND.exec(text);
            const [, lead = '', token = '', name = ''] = match ?? [];
            if (!match || !isCommand(name)) return null;
            // The first line's text starts at position 1.
            const from = 1 + lead.length;
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, from + token.length, {
                class:
                  '-mx-1 rounded-[5px] bg-[var(--mention-bg)] px-1 font-medium text-[color:var(--mention-color)]',
              }),
            ]);
          },
        },
      }),
    ];
  },
});

/** Interim dictation text, painted with a shimmer until it is final (see VoiceInput). */
export const VoiceShimmerMark = Mark.create({
  name: 'voiceShimmer',
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ['span', { class: 'voice-shimmer' }, 0];
  },
});
