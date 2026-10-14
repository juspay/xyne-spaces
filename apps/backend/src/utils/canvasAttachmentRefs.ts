import * as Y from 'yjs';

/**
 * Image, video, audio and file blocks keep the attachment id their upload
 * returned in the `url` prop, which Yjs stores as an attribute of the block's
 * element.
 */
const FILE_URL_ATTRIBUTE = 'url';

/**
 * A `url` the dashboard resolves through /attachments/:id rather than loading
 * directly — the same split as resolveUrl in the dashboard's fileFetchService.
 */
const isAttachmentId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.includes(':');

function forEachElement(node: Y.XmlFragment | Y.XmlElement, visit: (element: Y.XmlElement) => void): void {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      visit(child);
      forEachElement(child, visit);
    }
  }
}

/** The distinct attachment ids the blocks in a canvas fragment point at. */
export function collectAttachmentIds(fragment: Y.XmlFragment): string[] {
  const ids = new Set<string>();
  forEachElement(fragment, element => {
    const value: unknown = element.getAttribute(FILE_URL_ATTRIBUTE);
    if (isAttachmentId(value)) {
      ids.add(value);
    }
  });
  return [...ids];
}

/**
 * Point every block that uses an old attachment id at its replacement, in
 * place, so nothing else in the document changes.
 */
export function replaceAttachmentIds(
  fragment: Y.XmlFragment,
  replacements: ReadonlyMap<string, string>
): void {
  if (replacements.size === 0) {
    return;
  }

  const apply = (): void =>
    forEachElement(fragment, element => {
      const value: unknown = element.getAttribute(FILE_URL_ATTRIBUTE);
      const replacement = typeof value === 'string' ? replacements.get(value) : undefined;
      if (replacement) {
        element.setAttribute(FILE_URL_ATTRIBUTE, replacement);
      }
    });

  if (fragment.doc) {
    fragment.doc.transact(apply);
  } else {
    apply();
  }
}
