import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { AddMarkStep } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { editorView } from './canvasEditorView';

export interface PastedLink {
  url: string;
  from: number;
  to: number;
}

interface PasteState {
  link: PastedLink | null;
  /** A paste has landed and its autolink has not arrived yet. */
  awaitingLink: boolean;
}

const EMPTY: PasteState = { link: null, awaitingLink: false };

const pastedLinkKey = new PluginKey<PasteState>('canvasPastedLink');

type Listener = (link: PastedLink | null) => void;

/** The TipTap editor, which exists well before its ProseMirror view does. */
export interface PastedLinkHost {
  view: EditorView;
}

const listeners = new WeakMap<object, Set<Listener>>();

/** The link the reader has just pasted and not yet acted on. */
export const getPastedLink = (state: EditorState): PastedLink | null =>
  pastedLinkKey.getState(state)?.link ?? null;

export const clearPastedLink = (host: PastedLinkHost): void => {
  const view = editorView(host);
  view?.dispatch(view.state.tr.setMeta(pastedLinkKey, null));
};

/**
 * Keyed on the editor rather than its view: a child of `BlockNoteView` subscribes
 * before the view it would otherwise key on has been created.
 */
export function subscribeToPastedLink(host: PastedLinkHost, listener: Listener): () => void {
  const forHost = listeners.get(host) ?? new Set<Listener>();
  listeners.set(host, forHost);
  forHost.add(listener);
  const view = editorView(host);
  listener(view ? getPastedLink(view.state) : null);
  return () => {
    forHost.delete(listener);
  };
}

/**
 * The link mark a transaction adds, if it adds one.
 *
 * Pasting a URL takes two transactions: the first inserts plain text, and a
 * second autolinks it. Only the second carries the link, and a mark step moves
 * nothing, so its range has to be read off the step itself rather than from the
 * transaction's mapping.
 */
function linkMarkAddedIn(transaction: Transaction): PastedLink | null {
  const linkMark = transaction.doc.type.schema.marks['link'];
  if (!linkMark) return null;

  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index];
    if (!(step instanceof AddMarkStep) || step.mark.type !== linkMark) continue;

    const href: unknown = step.mark.attrs['href'];
    if (typeof href !== 'string' || !href) continue;

    const rest = transaction.mapping.slice(index + 1);
    return { url: href, from: rest.map(step.from), to: rest.map(step.to) };
  }

  return null;
}

/**
 * Tracks the link a paste just produced, so the link menu can be offered there.
 *
 * Watches for the link a paste created rather than handling the paste itself:
 * BlockNote claims the paste event first in order to autolink the URL, so a
 * handler here would never run. Link marks are not inclusive, so a caret left
 * sitting after the pasted text reports no link and BlockNote's own toolbar
 * stays shut — hence tracking it ourselves.
 */
export const canvasPastedLinkExtension = Extension.create({
  name: 'canvasPastedLink',
  addProseMirrorPlugins() {
    const host = this.editor as unknown as object;
    return [
      new Plugin<PasteState>({
        key: pastedLinkKey,
        state: {
          init: (): PasteState => EMPTY,
          apply: (transaction, current): PasteState => {
            const explicit = transaction.getMeta(pastedLinkKey) as PastedLink | null | undefined;
            if (explicit !== undefined) return { link: explicit, awaitingLink: false };

            const isPaste =
              transaction.getMeta('paste') === true || transaction.getMeta('uiEvent') === 'paste';
            if (isPaste) {
              const immediate = linkMarkAddedIn(transaction);
              return immediate
                ? { link: immediate, awaitingLink: false }
                : { link: null, awaitingLink: true };
            }

            if (current.awaitingLink) {
              const linked = linkMarkAddedIn(transaction);
              if (linked) return { link: linked, awaitingLink: false };
              return transaction.docChanged ? EMPTY : current;
            }

            const { link } = current;
            if (!link) return current;

            // Any edit of the reader's own, or a move away from the link, makes a
            // standing offer stale.
            if (transaction.docChanged) return EMPTY;
            const caret = transaction.selection.from;
            return caret < link.from || caret > link.to ? EMPTY : current;
          },
        },
        view: () => ({
          update: (view, previousState): void => {
            const link = getPastedLink(view.state);
            if (link === getPastedLink(previousState)) return;
            listeners.get(host)?.forEach(listener => listener(link));
          },
        }),
      }),
    ];
  },
});
