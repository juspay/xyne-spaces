import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Ensures a URL string has a protocol prefix.
 * If the URL starts with a known protocol, returns it as-is.
 * Otherwise, prepends "https://".
 */
function ensureProtocol(url: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) return url;
  return `https://${url}`;
}

/**
 * LinkSyncPlugin: Keeps link mark href in sync with the visible text.
 *
 * When a user edits an autolinked URL (e.g. backspacing characters),
 * this plugin updates the href to exactly match the current text.
 * Link detection and removal is handled by TipTap.
 */
export const LinkSyncPlugin = Extension.create({
  name: 'linkSync',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkSync'),
        appendTransaction: (_transactions, oldState, newState) => {
          // Only run when the document actually changed
          if (oldState.doc.eq(newState.doc)) return null;

          const { tr } = newState;
          const linkMarkType = newState.schema.marks['link'];
          if (!linkMarkType) return null;

          let hasChanges = false;

          newState.doc.descendants((node, pos) => {
            if (!node.isText) return;

            const linkMark = node.marks.find(m => m.type === linkMarkType);
            if (!linkMark) return;

            const nodeText = node.text || '';
            const currentHref = linkMark.attrs['href'] as string;

            const expectedHref = ensureProtocol(nodeText.trim());
            if (expectedHref !== currentHref) {
              tr.removeMark(pos, pos + node.nodeSize, linkMarkType);
              tr.addMark(
                pos,
                pos + node.nodeSize,
                linkMarkType.create({ ...linkMark.attrs, href: expectedHref }),
              );
              hasChanges = true;
            }
          });

          return hasChanges ? tr : null;
        },
      }),
    ];
  },
});
