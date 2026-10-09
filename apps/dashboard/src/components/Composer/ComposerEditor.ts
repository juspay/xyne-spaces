import { Mark, Node, mergeAttributes } from '@tiptap/core';
import type { ContextRef, PickKind } from './Composer.types';
import { mentionToken } from './Composer.utils';

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
