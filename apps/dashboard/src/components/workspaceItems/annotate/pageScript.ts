const BODY = `(() => {
  const state = { on: false, marks: [], held: null };
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px dashed #4c8bf5;border-radius:6px;background:rgba(76,139,245,0.10);display:none';
  document.documentElement.appendChild(box);

  const style = document.createElement('style');
  style.textContent = '[data-xyne-comment-anchor]{background-color:rgba(245,196,76,0.13);cursor:pointer;transition:background-color 120ms ease}[data-xyne-comment-anchor]:hover,[data-xyne-comment-anchor][data-xyne-active]{background-color:rgba(245,196,76,0.20)}[data-xyne-comment-mark]{position:absolute;z-index:2147483645;width:18px;height:18px;border-radius:999px;background:rgba(245,196,76,0.9);color:#1a1a1a;font:600 10px/18px -apple-system,system-ui,sans-serif;text-align:center;cursor:pointer;opacity:0.75;transition:opacity 120ms ease}[data-xyne-comment-mark]:hover{opacity:1}';
  document.documentElement.appendChild(style);

  // An iframe can talk to its parent directly. A webview or a host-held page
  // has no such parent, so events queue here and the host drains them.
  window.__xyneAnnotateQueue = window.__xyneAnnotateQueue || [];
  const framed = window.parent && window.parent !== window;
  const send = message => {
    const payload = Object.assign({ channel: 'xyne-doc' }, message);
    if (framed) parent.postMessage(payload, '*');
    else window.__xyneAnnotateQueue.push(payload);
  };
  window.__xyneAnnotateApply = data => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  };

  const pickable = el => {
    if (!el || el === document.documentElement || el === document.body) return null;
    let node = el;
    for (let i = 0; i < 4 && node; i += 1) {
      const rect = node.getBoundingClientRect();
      const text = (node.innerText || '').trim();
      if (rect.width > 40 && rect.height > 12 && text.length > 1) return node;
      node = node.parentElement;
    }
    return el;
  };

  const selectorFor = el => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = [].slice.call(parent.children).filter(c => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const findEl = mark => {
    if (mark.selector) {
      try {
        const bySelector = document.querySelector(mark.selector);
        if (bySelector) return bySelector;
      } catch (err) {}
    }
    const needle = (mark.quote || '').trim().slice(0, 80);
    if (!needle) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if ((node.textContent || '').includes(needle)) return node.parentElement;
    }
    return null;
  };

  const paint = () => {
    [].slice.call(document.querySelectorAll('[data-xyne-comment-mark]')).forEach(n => n.remove());
    [].slice.call(document.querySelectorAll('[data-xyne-comment-anchor]')).forEach(n => n.removeAttribute('data-xyne-comment-anchor'));
    const counts = new Map();
    for (const mark of state.marks) {
      const el = findEl(mark);
      if (!el) continue;
      el.setAttribute('data-xyne-comment-anchor', '1');
      const count = (counts.get(el) || 0) + 1;
      counts.set(el, count);
      if (count > 1) {
        if (el.__xyneMark) el.__xyneMark.textContent = String(count);
        continue;
      }
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.setAttribute('data-xyne-comment-mark', '1');
      badge.textContent = '1';
      badge.title = mark.body || 'Comment';
      badge.style.top = (rect.top + window.scrollY + 2) + 'px';
      badge.style.left = Math.max(2, rect.left + window.scrollX - 26) + 'px';
      const open = event => {
        event.preventDefault();
        event.stopPropagation();
        [].slice.call(document.querySelectorAll('[data-xyne-active]')).forEach(n => n.removeAttribute('data-xyne-active'));
        el.setAttribute('data-xyne-active', '1');
        const at = el.getBoundingClientRect();
        send({
          type: 'commentClick',
          id: mark.id,
          rect: { top: at.top, left: at.left, width: at.width, height: at.height },
        });
      };
      badge.addEventListener('click', open);
      el.addEventListener('click', open);
      document.body.appendChild(badge);
      el.__xyneMark = badge;
    }
  };

  document.addEventListener('mousemove', event => {
    if (!state.on) return;
    const el = pickable(event.target);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.top = rect.top + 'px';
    box.style.left = rect.left + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  }, true);

  document.addEventListener('click', event => {
    if (!state.on) return;
    const el = pickable(event.target);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = el.getBoundingClientRect();
    const selection = (window.getSelection && window.getSelection().toString()) || '';
    state.on = false;
    state.held = el;
    box.style.display = 'block';
    box.style.top = rect.top + 'px';
    box.style.left = rect.left + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    box.style.borderStyle = 'solid';
    send({
      type: 'pick',
      selector: selectorFor(el),
      text: (selection.trim() || el.innerText || '').trim().slice(0, 4000),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
  }, true);

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.channel !== 'xyne-doc-host') return;
    if (data.type === 'pick') {
      state.on = !!data.on;
      if (data.on) { state.held = null; box.style.borderStyle = 'dashed'; }
      if (!data.on && !state.held) box.style.display = 'none';
      return;
    }
    if (data.type === 'clearHighlight') { state.held = null; box.style.display = 'none'; return; }
    if (data.type === 'clearActive') {
      [].slice.call(document.querySelectorAll('[data-xyne-active]')).forEach(n => n.removeAttribute('data-xyne-active'));
      return;
    }
    if (data.type === 'marks') { state.marks = data.marks || []; paint(); return; }
    if (data.type === 'reveal') {
      const el = findEl(data);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const previous = el.style.cssText;
      el.style.backgroundColor = 'rgba(76,139,245,0.22)';
      el.style.boxShadow = '0 0 0 3px rgba(76,139,245,0.45)';
      setTimeout(() => { el.style.cssText = previous; }, 2000);
    }
  });

  window.addEventListener('resize', paint);
  send({ type: 'ready' });
})();`;

/** For an iframe we render ourselves: injected into the document's own html. */
export const ANNOTATE_SCRIPT_TAG = `<script>${BODY}</script>`;

/** For a webview or a host-held page: evaluated in the page after it loads. */
export const ANNOTATE_SCRIPT = BODY;
