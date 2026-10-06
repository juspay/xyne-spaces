import type { FindProvider } from '../../find';

const SEARCH = 'xyne-find';
const RESULT = 'xyne-find-result';
const OPEN = 'xyne-find-open';

/**
 * Find inside a previewed page. The page runs sandboxed, from an origin of its own,
 * so the app can't reach into it: this script goes in with it, searches its text when
 * asked over postMessage, marks matches with the CSS Custom Highlight API under the
 * same names and colours the app's own find uses, and tells the app when ⌘F is
 * pressed inside it, where the app can't hear it.
 */
const PAGE_SCRIPT = `(() => {
  const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;
  const style = document.createElement('style');
  style.textContent = '::highlight(xyne-find){background-color:#fde68a;color:inherit}::highlight(xyne-find-active){background-color:#fb923c;color:inherit}';
  (document.head || document.documentElement).appendChild(style);
  let ranges = [];
  const clear = () => {
    ranges = [];
    if (supported) { CSS.highlights.delete('xyne-find'); CSS.highlights.delete('xyne-find-active'); }
  };
  const search = (query) => {
    clear();
    const needle = String(query || '').toLowerCase();
    if (!needle || !document.body) return 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentNode && node.parentNode.nodeName)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node && ranges.length < 5000; node = walker.nextNode()) {
      const text = (node.textContent || '').toLowerCase();
      for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        ranges.push(range);
      }
    }
    if (supported && ranges.length) CSS.highlights.set('xyne-find', new Highlight(...ranges));
    return ranges.length;
  };
  const reveal = (index) => {
    const range = ranges[index];
    if (!range) return;
    if (supported) { const current = new Highlight(range); current.priority = 1; CSS.highlights.set('xyne-find-active', current); }
    const element = range.startContainer.parentElement;
    if (element) element.scrollIntoView({ block: 'center' });
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== '${SEARCH}') return;
    if (data.action === 'search') window.parent.postMessage({ type: '${RESULT}', id: data.id, count: search(data.query) }, '*');
    else if (data.action === 'reveal') reveal(data.index);
    else clear();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      window.parent.postMessage({ type: '${OPEN}' }, '*');
    }
  });
})();`;

/** The page with the find script in it, at the end of its body. */
export function withPageFind(html: string): string {
  const script = `<script>${PAGE_SCRIPT}</script>`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${script}</body>`)
    : `${html}${script}`;
}

/** How long to wait on a page that never answers — one whose script failed. */
const ANSWER_TIMEOUT_MS = 2000;

const isFrameMessage = (value: unknown): value is { type: string; id?: number; count?: number } =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';

/**
 * The app's side of it: a FindProvider that asks the page to search, and says how
 * many it found when the page answers. `onOpen` is the page's ⌘F. The returned
 * dispose stops listening.
 */
export function createPageFinder(
  page: () => Window | null,
  onOpen: () => void,
): { finder: FindProvider; dispose: () => void } {
  let asked = 0;
  const waiting = new Map<number, (count: number) => void>();
  const onMessage = (event: MessageEvent): void => {
    const frame = page();
    if (!frame || event.source !== frame || !isFrameMessage(event.data)) return;
    if (event.data.type === OPEN) onOpen();
    if (event.data.type === RESULT && typeof event.data.id === 'number') {
      waiting.get(event.data.id)?.(typeof event.data.count === 'number' ? event.data.count : 0);
      waiting.delete(event.data.id);
    }
  };
  window.addEventListener('message', onMessage);
  const send = (message: Record<string, unknown>): void =>
    page()?.postMessage({ type: SEARCH, ...message }, '*');

  return {
    finder: {
      search: query =>
        new Promise(resolve => {
          asked += 1;
          const id = asked;
          waiting.set(id, resolve);
          send({ action: 'search', query, id });
          window.setTimeout(() => {
            if (waiting.delete(id)) resolve(0);
          }, ANSWER_TIMEOUT_MS);
        }),
      reveal: index => send({ action: 'reveal', index }),
      clear: () => send({ action: 'clear' }),
    },
    dispose: () => {
      window.removeEventListener('message', onMessage);
      waiting.forEach(resolve => resolve(0));
      waiting.clear();
    },
  };
}
