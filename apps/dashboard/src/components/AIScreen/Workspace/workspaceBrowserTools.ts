import type { ElectronWebviewElement } from '../../../types/electron';
import { wakePage } from '../../InAppBrowser/BrowserWebview';

export interface PageToolResult {
  ok: boolean;
  content: string;
  image?: { data: string; mimeType: string };
}

const SCREENSHOT_MAX_WIDTH = 1280;
/** How long a capture may take before the tool gives up on it. */
const CAPTURE_TIMEOUT_MS = 5000;
/** How long a page out of sight is given to paint before it is captured. */
const CAPTURE_SETTLE_MS = 150;

const NO_PAGE = 'No page is open in the workspace panel. Call open-url first.';
const TABS_TOOL = 'page-tabs';
const MAX_TEXT_CHARS = 20000;
const MAX_ELEMENTS = 300;
const NAVIGATE_TIMEOUT_MS = 15000;
const SETTLE_MS = 500;

/** A page open in the workspace's browser, under its tab's id. */
interface WorkspacePage {
  view: ElectronWebviewElement;
  /** Where its tab opened it: the address the agent asked for, whatever it went on to. */
  url: string;
}

/**
 * The workspace browser's open pages, each kept alive in its tab, and which shows.
 * The agent's page tools reach any of them by its tab; without one, the one shown.
 */
const pages = new Map<string, WorkspacePage>();
let shownTab: string | null = null;
const pageListeners = new Set<() => void>();
const pagesChanged = (): void => pageListeners.forEach(listener => listener());

/** Puts a tab's page within the agent's reach; what it returns takes it out. */
export function registerWorkspacePage(tab: string, page: WorkspacePage): () => void {
  pages.set(tab, page);
  pagesChanged();
  return () => {
    if (pages.get(tab) !== page) return;
    pages.delete(tab);
    pagesChanged();
  };
}

/** Which tab shows; what it returns says it no longer does. */
export function showWorkspaceTab(tab: string): () => void {
  shownTab = tab;
  pagesChanged();
  return () => {
    if (shownTab !== tab) return;
    shownTab = null;
    pagesChanged();
  };
}

/** The page on screen: the one a page tool without a tab acts on. */
export function getWorkspaceWebview(): ElectronWebviewElement | null {
  return (shownTab && pages.get(shownTab)?.view) || null;
}

/** Whether any page is open in the workspace's browser. */
export function hasWorkspacePages(): boolean {
  return pages.size > 0;
}

/** Hears pages open, close, or another show. */
export function subscribeToWorkspacePages(listener: () => void): () => void {
  pageListeners.add(listener);
  return () => pageListeners.delete(listener);
}

const comparable = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return url;
  }
};

/** Where a page is now; where its tab opened it while it hasn't loaded yet. */
function addressOf(page: WorkspacePage): string {
  let now = '';
  try {
    now = page.view.getURL();
  } catch {
    now = '';
  }
  return now && now !== 'about:blank' ? now : page.url;
}

/** The tab showing an address now — or about to, not having loaded yet; null for none. */
export function workspaceTabAt(url: string): string | null {
  const wanted = comparable(url);
  for (const [tab, page] of pages) {
    if (comparable(addressOf(page)) === wanted) return tab;
  }
  return null;
}

/** The tab opened for an address, wherever its page has gone since; null for none. */
export function workspaceTabOpenedFor(url: string): string | null {
  const wanted = comparable(url);
  for (const [tab, page] of pages) {
    if (comparable(page.url) === wanted) return tab;
  }
  return null;
}

/** The page of a tab, for a tool. */
export function workspacePage(tab: string): ElectronWebviewElement | null {
  return pages.get(tab)?.view ?? null;
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

/**
 * A key pressed inside a page, as the page's own script would: for a tab out of
 * sight, which real key presses never reach — Chromium sends keyboard input only to
 * what has focus, and a tab that takes focus takes the reader's keyboard with it.
 * Enter submits the focused field's form, and a character goes into the focused
 * field; a site that answers only real key presses may ignore it.
 */
function scriptKeyScript(key: string): string {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const target = document.activeElement || document.body;
    const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
    const char = key.length === 1;
    const keyCode = codes[key] || (char ? key.toUpperCase().charCodeAt(0) : 0);
    const send = type => {
      const event = new KeyboardEvent(type, { key, code: char ? 'Key' + key.toUpperCase() : key, bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(event, 'keyCode', { get: () => keyCode });
      Object.defineProperty(event, 'which', { get: () => keyCode });
      return target.dispatchEvent(event);
    };
    const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
    if (send('keydown')) {
      if (char) {
        send('keypress');
        if (field) document.execCommand('insertText', false, key);
      } else if (key === 'Enter' && target.form) {
        target.form.requestSubmit();
      } else if (key === 'Backspace' && field) {
        document.execCommand('delete');
      }
    }
    send('keyup');
    return true;
  })()`;
}

/**
 * Presses a key in a page. The tab on screen takes the keyboard to get it, as it
 * always has; one out of sight gets it from its own script, and leaves the
 * reader's keyboard where it is.
 */
async function pressKey(wv: ElectronWebviewElement, key: string, shown: boolean): Promise<void> {
  if (!shown) {
    await wv.executeJavaScript(scriptKeyScript(key));
    return;
  }
  wv.focus();
  await sendKey(wv, key);
}

/**
 * A tab out of sight paints nothing, so a capture of it never comes back. For the
 * capture alone it is made clear and click-through rather than hidden — the reader
 * sees and touches nothing of it — then put back as it was.
 */
type PageImage = Awaited<ReturnType<ElectronWebviewElement['capturePage']>>;

async function captureOutOfSight(wv: ElectronWebviewElement): Promise<PageImage | null> {
  const style = (wv as unknown as HTMLElement).style;
  const was = {
    visibility: style.visibility,
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
  };
  style.opacity = '0';
  style.pointerEvents = 'none';
  style.visibility = 'visible';
  try {
    await delay(CAPTURE_SETTLE_MS);
    return await Promise.race([wv.capturePage(), delay(CAPTURE_TIMEOUT_MS).then(() => null)]);
  } finally {
    style.visibility = was.visibility;
    style.opacity = was.opacity;
    style.pointerEvents = was.pointerEvents;
  }
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

/** The workspace's open tabs, as page-tabs answers. */
function listTabs(): PageToolResult {
  if (pages.size === 0) return { ok: false, content: NO_PAGE };
  const lines = [...pages].map(([tab, page]) => {
    let title = '';
    let url = page.url;
    try {
      title = page.view.getTitle();
      url = page.view.getURL() || url;
    } catch {
      /* not loaded yet: where it was opened */
    }
    return `- ${tab}${tab === shownTab ? ' (shown)' : ''}: ${title || '(untitled)'} — ${url}`;
  });
  return {
    ok: true,
    content:
      'Open tabs in the workspace panel. Page tools act on the shown tab unless given `tab`; ' +
      'every tab stays loaded, so work in the one you need rather than opening its page again.\n' +
      lines.join('\n'),
  };
}

export async function executePageTool(
  toolName: string,
  args: Record<string, unknown>,
  target?: ElectronWebviewElement | null,
): Promise<PageToolResult> {
  if (toolName === TABS_TOOL) {
    // The SDLC browser has one page: the one on screen.
    if (target !== undefined) {
      return target
        ? { ok: true, content: `One tab, shown: ${describe(target)}` }
        : { ok: false, content: NO_PAGE };
    }
    return listTabs();
  }
  const tab = typeof args['tab'] === 'string' ? args['tab'].trim() : '';
  if (target === undefined && tab && !pages.has(tab)) {
    return { ok: false, content: `No open tab ${tab}. Call ${TABS_TOOL} for the open tabs.` };
  }
  const wv = target !== undefined ? target : tab ? workspacePage(tab) : getWorkspaceWebview();
  // Pages are open but none is on screen: say which can be named, not that none is.
  if (!wv && target === undefined && !tab && pages.size > 0) {
    return {
      ok: false,
      content: `No tab is shown in the workspace panel right now. Pass \`tab\` — call ${TABS_TOOL} for the open tabs.`,
    };
  }
  if (!wv) return { ok: false, content: NO_PAGE };
  // A tab out of sight may be frozen; it runs again before it is asked anything.
  await wakePage(wv);
  // On screen: the SDLC browser's page, or the workspace's shown tab.
  const shown = target !== undefined || wv === getWorkspaceWebview();

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
          await pressKey(wv, 'Enter', shown);
          await delay(SETTLE_MS);
          return { ok: true, content: `Typed into ${ref} and pressed Enter.\n${describe(wv)}` };
        }
        return { ok: true, content: `Typed into ${ref}.` };
      }

      case 'page-press': {
        const key = typeof args['key'] === 'string' ? args['key'] : '';
        if (!key) return { ok: false, content: 'page-press needs a key name.' };
        await pressKey(wv, key, shown);
        await delay(SETTLE_MS);
        return { ok: true, content: `Pressed ${key}.\n${describe(wv)}` };
      }

      case 'page-screenshot': {
        // Bounded either way: a page that stops painting must not hold the run.
        const captured = shown
          ? await Promise.race([wv.capturePage(), delay(CAPTURE_TIMEOUT_MS).then(() => null)])
          : await captureOutOfSight(wv);
        if (!captured) return { ok: false, content: 'The page did not produce a picture in time.' };
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
