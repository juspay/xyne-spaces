import type { EditorView } from '@tiptap/pm/view';

interface EditorWithView {
  _tiptapEditor?: { view?: EditorView };
  view?: EditorView;
}

/**
 * The editor's ProseMirror view, or null before it is mounted.
 *
 * TipTap hands back a proxy that throws on any property access until the view
 * exists, so optional chaining is not enough — the throw happens on the reach
 * for `.dom`, not on the view itself.
 */
export function editorView(editor: unknown): EditorView | null {
  const host = editor as EditorWithView | null | undefined;
  const view = host?._tiptapEditor?.view ?? host?.view;
  if (!view) return null;
  try {
    return view.dom ? view : null;
  } catch {
    return null;
  }
}
