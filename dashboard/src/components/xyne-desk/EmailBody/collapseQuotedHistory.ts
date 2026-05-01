const QUOTED_WRAPPER_CLASS = 'xd-quoted-history';

const QUOTE_SELECTORS = [
  '.gmail_quote',
  'div.gmail_quote_container',
  'div.gmail_attr',
  '#divRplyFwdMsg',
  '#appendonsend',
  'div[id="mail-editor-reference-message-container"]',
  'div.OutlookMessageHeader',
  'div.moz-cite-prefix',
  'blockquote[type="cite"]',
];

const ON_WROTE_RE = /^\s*On\s.+\s(?:wrote|a écrit|schrieb|escribió|napisał|scritto)\s*:\s*$/i;

const findEarliestQuoteStart = (root: HTMLElement): Element | null => {
  let earliest: Element | null = null;
  const earliestPosition = Number.POSITIVE_INFINITY;

  const consider = (el: Element): void => {
    if (!earliest) {
      earliest = el;
      return;
    }
    const cmp = earliest.compareDocumentPosition(el);
    if (cmp & Node.DOCUMENT_POSITION_PRECEDING) {
      earliest = el;
    }
  };

  for (const selector of QUOTE_SELECTORS) {
    const matches = root.querySelectorAll(selector);
    matches.forEach(m => consider(m));
  }

  if (!earliest) {
    const candidates = root.querySelectorAll('div, p');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i] as HTMLElement;
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 200 && ON_WROTE_RE.test(text)) {
        return el;
      }
    }
    return null;
  }

  void earliestPosition;
  return earliest;
};

const wrapRangeAsQuoted = (startNode: Element, doc: Document): void => {
  const parent = startNode.parentNode;
  if (!parent) return;
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('data-xd-quote', 'true');
  wrapper.className = QUOTED_WRAPPER_CLASS;
  parent.insertBefore(wrapper, startNode);
  let current: Node | null = startNode;
  while (current) {
    const next: Node | null = current.nextSibling;
    wrapper.appendChild(current);
    current = next;
  }
};

export const collapseQuotedHistory = (root: HTMLElement, doc: Document): boolean => {
  const start = findEarliestQuoteStart(root);
  if (!start) return false;
  if (start.closest(`.${QUOTED_WRAPPER_CLASS}`)) return false;
  wrapRangeAsQuoted(start, doc);
  return true;
};
