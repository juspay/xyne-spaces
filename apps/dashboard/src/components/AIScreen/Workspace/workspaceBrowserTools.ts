import type { ElectronWebviewElement } from '../../../types/electron';

export interface PageToolResult {
  ok: boolean;
  content: string;
  image?: { data: string; mimeType: string };
}

const SCREENSHOT_MAX_WIDTH = 1280;

const NO_PAGE = 'No page is open in the workspace panel. Call open-url first.';
const MAX_TEXT_CHARS = 20000;
const MAX_ELEMENTS = 300;
const NAVIGATE_TIMEOUT_MS = 15000;
const SETTLE_MS = 500;

let registeredWebview: ElectronWebviewElement | null = null;

export function registerWorkspaceWebview(el: ElectronWebviewElement | null): void {
  registeredWebview = el;
}

export function getWorkspaceWebview(): ElectronWebviewElement | null {
  return registeredWebview;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function describe(wv: ElectronWebviewElement): string {
  let title = '';
  let url = '';
  try {
    title = wv.getTitle();
  } catch {
    title = '';
  }
  try {
    url = wv.getURL();
  } catch {
    url = '';
  }
  return `Title: ${title || '(untitled)'}\nURL: ${url || '(unknown)'}`;
}

const READ_SCRIPT = `(function () {
  var doc = document;
  var body = doc.body;
  var text = body ? (body.innerText || body.textContent || '') : '';
  return { title: doc.title || '', url: location.href, text: text.replace(/\\n{3,}/g, '\\n\\n').trim() };
})()`;

const SNAPSHOT_SCRIPT = `(function () {
  var MAX = ${MAX_ELEMENTS};
  var selector = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="tab"], [role="menuitem"]';
  var nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
  var prior = document.querySelectorAll('[data-xyne-ref]');
  for (var p = 0; p < prior.length; p++) { prior[p].removeAttribute('data-xyne-ref'); }
  var lines = [];
  var count = 0;
  var truncated = false;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.disabled) continue;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (rect.width === 0 && rect.height === 0) continue;
    if (count >= MAX) { truncated = true; break; }
    count += 1;
    var ref = 'e' + count;
    el.setAttribute('data-xyne-ref', ref);
    var role = el.getAttribute('role') || '';
    var tag = el.tagName.toLowerCase();
    var kind = role ? tag + '/' + role : tag;
    var name = el.getAttribute('aria-label') || '';
    if (!name) { name = (el.innerText || el.textContent || '').trim(); }
    if (!name) { name = el.getAttribute('placeholder') || ''; }
    if (!name && typeof el.value === 'string') { name = el.value; }
    if (!name) { name = el.getAttribute('title') || el.getAttribute('name') || ''; }
    name = String(name).replace(/\\s+/g, ' ').trim().slice(0, 80);
    var href = '';
    if (tag === 'a' && el.getAttribute('href')) {
      try { href = new URL(el.getAttribute('href'), location.href).href; } catch (e) { href = el.getAttribute('href'); }
    }
    lines.push('[' + ref + '] ' + kind + ' "' + name + '"' + (href ? ' ' + href : ''));
  }
  return { title: document.title || '', url: location.href, lines: lines, truncated: truncated };
})()`;

function clickScript(ref: string): string {
  return `(function () {
  var ref = ${JSON.stringify(ref)};
  var el = document.querySelector('[data-xyne-ref="' + ref.replace(/"/g, '') + '"]');
  if (!el) return { found: false };
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  if (el.tagName.toLowerCase() === 'a' && el.target === '_blank' && el.href) {
    var dest = el.href;
    el.target = '_self';
    location.href = dest;
    return { found: true, navigated: true };
  }
  el.click();
  return { found: true, navigated: false };
})()`;
}

function typeScript(ref: string, text: string): string {
  return `(function () {
  var ref = ${JSON.stringify(ref)};
  var value = ${JSON.stringify(text)};
  var el = document.querySelector('[data-xyne-ref="' + ref.replace(/"/g, '') + '"]');
  if (!el) return { found: false };
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  el.focus();
  var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) {
    desc.set.call(el, value);
  } else if ('value' in el) {
    el.value = value;
  } else {
    el.textContent = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { found: true };
})()`;
}

async function sendKey(wv: ElectronWebviewElement, key: string): Promise<void> {
  const isChar = key.length === 1;
  await wv.sendInputEvent({ type: 'keyDown', keyCode: key });
  if (isChar) {
    await wv.sendInputEvent({ type: 'char', keyCode: key });
  }
  await wv.sendInputEvent({ type: 'keyUp', keyCode: key });
}

async function waitForLoad(wv: ElectronWebviewElement): Promise<void> {
  await new Promise<void>(resolve => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      wv.removeEventListener('did-finish-load', done);
      wv.removeEventListener('did-fail-load', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, NAVIGATE_TIMEOUT_MS);
    wv.addEventListener('did-finish-load', done);
    wv.addEventListener('did-fail-load', done);
  });
}

function unknownRef(ref: string): PageToolResult {
  return { ok: false, content: `Unknown ref ${ref} — take a fresh page-snapshot.` };
}

export async function executePageTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<PageToolResult> {
  const wv = registeredWebview;
  if (!wv) return { ok: false, content: NO_PAGE };

  try {
    switch (toolName) {
      case 'page-read': {
        const raw = (await wv.executeJavaScript(READ_SCRIPT)) as {
          title?: string;
          url?: string;
          text?: string;
        };
        const text = asString(raw?.text);
        const clipped = text.length > MAX_TEXT_CHARS;
        const body = clipped ? text.slice(0, MAX_TEXT_CHARS) : text;
        return {
          ok: true,
          content:
            `Title: ${asString(raw?.title) || '(untitled)'}\nURL: ${asString(raw?.url)}\n\n${body}` +
            (clipped ? `\n\n[truncated at ${MAX_TEXT_CHARS} characters]` : ''),
        };
      }

      case 'page-snapshot': {
        const raw = (await wv.executeJavaScript(SNAPSHOT_SCRIPT)) as {
          title?: string;
          url?: string;
          lines?: string[];
          truncated?: boolean;
        };
        const lines = Array.isArray(raw?.lines) ? raw.lines : [];
        return {
          ok: true,
          content:
            `Title: ${asString(raw?.title) || '(untitled)'}\nURL: ${asString(raw?.url)}\n\n` +
            (lines.length ? lines.join('\n') : 'No interactive elements found.') +
            (raw?.truncated ? `\n\n[capped at ${MAX_ELEMENTS} elements]` : ''),
        };
      }

      case 'page-navigate': {
        const url = typeof args['url'] === 'string' ? args['url'].trim() : '';
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { ok: false, content: 'page-navigate needs an absolute http or https URL.' };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { ok: false, content: 'Only http and https URLs can be opened.' };
        }
        const loaded = waitForLoad(wv);
        if (typeof wv.loadURL === 'function') {
          await Promise.resolve(wv.loadURL(parsed.href)).catch(() => undefined);
        } else {
          wv.src = parsed.href;
        }
        await loaded;
        return { ok: true, content: describe(wv) };
      }

      case 'page-click': {
        const ref = typeof args['ref'] === 'string' ? args['ref'] : '';
        if (!ref) return unknownRef('(missing)');
        const raw = (await wv.executeJavaScript(clickScript(ref))) as { found?: boolean };
        if (!raw?.found) return unknownRef(ref);
        await delay(SETTLE_MS);
        return { ok: true, content: `Clicked ${ref}.\n${describe(wv)}` };
      }

      case 'page-type': {
        const ref = typeof args['ref'] === 'string' ? args['ref'] : '';
        const text = typeof args['text'] === 'string' ? args['text'] : '';
        if (!ref) return unknownRef('(missing)');
        const raw = (await wv.executeJavaScript(typeScript(ref, text))) as { found?: boolean };
        if (!raw?.found) return unknownRef(ref);
        if (args['submit'] === true) {
          await sendKey(wv, 'Enter');
          await delay(SETTLE_MS);
          return { ok: true, content: `Typed into ${ref} and pressed Enter.\n${describe(wv)}` };
        }
        return { ok: true, content: `Typed into ${ref}.` };
      }

      case 'page-press': {
        const key = typeof args['key'] === 'string' ? args['key'] : '';
        if (!key) return { ok: false, content: 'page-press needs a key name.' };
        wv.focus();
        await sendKey(wv, key);
        await delay(SETTLE_MS);
        return { ok: true, content: `Pressed ${key}.\n${describe(wv)}` };
      }

      case 'page-screenshot': {
        const captured = await wv.capturePage();
        const size = captured.getSize();
        const scaled =
          size.width > SCREENSHOT_MAX_WIDTH
            ? captured.resize({ width: SCREENSHOT_MAX_WIDTH })
            : captured;
        const dataUrl = scaled.toDataURL();
        const comma = dataUrl.indexOf(',');
        const data = comma >= 0 ? dataUrl.slice(comma + 1) : '';
        if (!data) return { ok: false, content: 'Screenshot capture returned no image.' };
        const finalSize = scaled.getSize();
        return {
          ok: true,
          content: `Screenshot of the open page (${finalSize.width}x${finalSize.height}).\n${describe(wv)}`,
          image: { data, mimeType: 'image/png' },
        };
      }

      default:
        return { ok: false, content: `Unknown workspace browser tool ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workspace browser tool failed';
    return { ok: false, content: message };
  }
}
