const QUOTED_WRAPPER_CLASS = 'xd-quoted-history';

const GMAIL_SELECTORS = ['.gmail_quote', 'div.gmail_quote_container', 'div.gmail_attr'];

const OUTLOOK_SELECTORS = [
  '#divRplyFwdMsg',
  '#appendonsend',
  'div[id="mail-editor-reference-message-container"]',
  'div.OutlookMessageHeader',
  'div.moz-cite-prefix',
];

const GENERIC_SELECTORS = ['blockquote[type="cite"]'];

const ON_WROTE_RE = /^\s*On\s.+\s(?:wrote|a écrit|schrieb|escribió|napisał|scritto)\s*:\s*$/i;

const findHeuristicQuoteStart = (root: HTMLElement): HTMLElement | null => {
  const candidates = root.querySelectorAll('div, p');
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i] as HTMLElement;
    const text = (el.textContent || '').trim();
    if (text.length > 0 && text.length < 200 && ON_WROTE_RE.test(text)) {
      return el;
    }
  }
  return null;
};

const wrapAsQuoted = (node: Element, doc: Document): void => {
  const wrapper = doc.createElement('div');
  wrapper.setAttribute('data-xd-quote', 'true');
  wrapper.className = QUOTED_WRAPPER_CLASS;
  node.parentNode?.insertBefore(wrapper, node);
  wrapper.appendChild(node);
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
  let found = false;

  for (const selector of [...GMAIL_SELECTORS, ...OUTLOOK_SELECTORS, ...GENERIC_SELECTORS]) {
    const matches = root.querySelectorAll(selector);
    matches.forEach(match => {
      if (match.closest(`.${QUOTED_WRAPPER_CLASS}`)) return;
      wrapAsQuoted(match, doc);
      found = true;
    });
  }

  if (!found) {
    const heuristic = findHeuristicQuoteStart(root);
    if (heuristic && !heuristic.closest(`.${QUOTED_WRAPPER_CLASS}`)) {
      wrapRangeAsQuoted(heuristic, doc);
      found = true;
    }
  }

  return found;
};
