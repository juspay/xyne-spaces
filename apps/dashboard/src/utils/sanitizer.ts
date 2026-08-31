export const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'span',
  'div',
  'code',
  'pre',
  'a',
  'blockquote',
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'del',
  's',
  'mark',
  'button',
  'hi',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'colgroup',
  'col',
]);

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  span: ['class', 'data-*', 'data-has-history'],
  div: ['class', 'data-*'],
  code: ['class'],
  pre: ['class'],
  mark: ['class'],
  blockquote: ['class', 'data-slack', 'style'],
  ol: ['start', 'type'],
  ul: ['type'],
  img: ['src', 'alt', 'title', 'class', 'data-emoji', 'data-emoji-id'],
  table: ['class'],
  thead: ['class'],
  tbody: ['class'],
  tr: ['class'],
  td: ['class', 'colspan', 'rowspan'],
  th: ['class', 'colspan', 'rowspan'],
  colgroup: ['class'],
  col: ['class', 'span'],
};

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export const isValidURL = (url: string): boolean => {
  try {
    const u = new URL(url, window.location.origin);
    return SAFE_PROTOCOLS.includes(u.protocol);
  } catch {
    return false;
  }
};

const isInsideSlackBlockquote = (el: HTMLElement): boolean => {
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    if (
      current.tagName.toLowerCase() === 'blockquote' &&
      current.getAttribute('data-slack') === 'true'
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

const sanitizeAttributes = (el: HTMLElement): void => {
  const tag = el.tagName.toLowerCase();
  const allowed = ALLOWED_ATTRS[tag] || [];
  const insideSlackBlockquote = isInsideSlackBlockquote(el);

  [...el.attributes].forEach((attr: Attr) => {
    const name = attr.name.toLowerCase();

    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      return;
    }

    if (tag === 'a' && name === 'href') {
      if (!isValidURL(attr.value)) el.removeAttribute('href');
      return;
    }

    if (name === 'src') {
      const v = (attr.value || '').trim().toLowerCase();
      if (v.startsWith('javascript:') || v.startsWith('data:') || v.startsWith('vbscript:')) {
        el.removeAttribute(attr.name);
      } else if (tag === 'img' && !isValidURL(attr.value)) {
        // For img tags, validate that src is a valid URL
        el.removeAttribute('src');
      }
      return;
    }

    if (['action', 'formaction'].includes(name)) {
      const v = (attr.value || '').trim().toLowerCase();
      if (v.startsWith('javascript:') || v.startsWith('data:') || v.startsWith('vbscript:')) {
        el.removeAttribute(attr.name);
      }
      return;
    }

    // Allow style, src, alt, disabled attributes if inside slack blockquote
    if (insideSlackBlockquote && ['style', 'src', 'alt', 'disabled'].includes(name)) {
      return;
    }

    const isAllowed = allowed.some(a => a === name || (a === 'data-*' && name.startsWith('data-')));
    if (!isAllowed) el.removeAttribute(attr.name);
  });
};

export const sanitizeDomTree = (root: HTMLElement): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;

  while (node) {
    const tag = node.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
      node = walker.nextNode() as Element | null;
      continue;
    }

    sanitizeAttributes(node as HTMLElement);
    node = walker.nextNode() as Element | null;
  }
};

export const sanitizeHtmlString = (html: string): string => {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  sanitizeDomTree(doc.body);
  return doc.body.innerHTML;
};

export const htmlToPlainText = (html: string): string => {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  sanitizeDomTree(doc.body);
  return (doc.body.textContent || '').trim();
};
