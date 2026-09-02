import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * FileReferenceExtension
 *
 * An inline, atomic node that lets a user reference (tag) an EXISTING file
 * from the current thread — the file-equivalent of a channel/user mention.
 *
 * The node's identity is the immutable `attachmentId`; `fileName` and
 * `mimeType` are display-only metadata. The chip serializes to
 *   <span data-file-reference data-attachment-id="..." data-file-name="..." ...>@name</span>
 * which the backend parses (see fileReferenceUtils.extractFileReferenceIds)
 * and RE-AUTHORIZES server-side — the embedded id is never trusted for access.
 *
 * This extension intentionally ships only the node + insert command; the
 * suggestion picker that populates it from the thread's attachments is wired
 * separately in the composer.
 */
export interface FileReferenceOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface FileReferenceAttributes {
  attachmentId: string;
  fileName: string;
  mimeType?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileReference: {
      insertFileReference: (attributes: FileReferenceAttributes) => ReturnType;
      removeFileReference: () => ReturnType;
    };
  }
}

const ZWSP = '\u200B'; // Zero-width space guard, matching other mention nodes

export const FileReferenceExtension = Node.create<FileReferenceOptions>({
  name: 'fileReference',

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
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-attachment-id'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['attachmentId']) return {};
          return { 'data-attachment-id': attributes['attachmentId'] as string };
        },
      },
      fileName: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-file-name'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['fileName']) return {};
          return { 'data-file-name': attributes['fileName'] as string };
        },
      },
      mimeType: {
        default: null,
        parseHTML: (element: HTMLElement): string | null =>
          element.getAttribute('data-mime-type'),
        renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
          if (!attributes['mimeType']) return {};
          return { 'data-mime-type': attributes['mimeType'] as string };
        },
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-file-reference]',
      },
    ];
  },

  // eslint-disable-next-line @typescript-eslint/naming-convention
  renderHTML({ node, HTMLAttributes }): [string, Record<string, string | undefined>, string] {
    const attrs = node.attrs as Record<string, unknown>;
    const fileName = (attrs['fileName'] as string) ?? 'file';

    /* eslint-disable @typescript-eslint/naming-convention */
    const dataAttributes: Record<string, string> = {
      'data-file-reference': '',
      'data-attachment-id': (attrs['attachmentId'] as string) ?? '',
      'data-file-name': fileName,
    };
    if (attrs['mimeType']) {
      dataAttributes['data-mime-type'] = attrs['mimeType'] as string;
    }

    return [
      'span',
      mergeAttributes(
        {
          ...dataAttributes,
          class: 'chat-input-file-reference',
          contenteditable: 'false',
          role: 'button',
          'aria-label': `Reference file ${fileName}`,
          tabindex: '-1',
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `📎${fileName}`,
    ];
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  renderText({ node }): string {
    const attrs = node.attrs as Record<string, unknown>;
    const fileName = (attrs['fileName'] as string) ?? 'file';
    return `📎${fileName}`;
  },

  addCommands() {
    return {
      insertFileReference:
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
      removeFileReference:
        () =>
        ({ tr, state }): boolean => {
          const { selection } = state;
          const { $from } = selection;

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
            const fileName = (foundNode.attrs['fileName'] as string) ?? 'file';
            tr.replaceWith(foundPos, foundPos + foundNode.nodeSize, state.schema.text(`📎${fileName}`));
            return true;
          }

          return false;
        },
    };
  },
});
