export interface AppToolResult {
  ok: boolean;
  content: string;
  image?: { data: string; mimeType: string };
}

export type AppNavigateTarget =
  | 'new-chat'
  | 'conversation'
  | 'dm'
  | 'channel'
  | 'ticket'
  | 'canvas'
  | 'knowledge'
  | 'agents'
  | 'settings';

export interface AppControlHost {
  navigate: (path: string) => void;
  currentPath: () => string;
  workspaceId: () => string;
}

const APP_TOOLS = new Set([
  'app-navigate',
  'app-describe',
  'app-snapshot',
  'app-click',
  'app-type',
  'app-screenshot',
]);

const MAX_ELEMENTS = 200;
const MAX_TEXT_CHARS = 8000;
const SETTLE_MS = 350;
const SCREENSHOT_MAX_WIDTH = 1280;

let host: AppControlHost | null = null;
const refs = new Map<string, HTMLElement>();

export function isAppControlTool(toolName: string): boolean {
  return APP_TOOLS.has(toolName);
}

export function registerAppControlHost(next: AppControlHost | null): void {
  host = next;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pathFor(target: string, id: string): string | null {
  const workspace = host?.workspaceId() ?? '';
  if (!workspace) return null;
  const at = (suffix: string): string => `/${encodeURIComponent(workspace)}/${suffix}`;

  switch (target) {
    case 'new-chat':
      return at('ai/chat/new');
    case 'conversation':
      return id ? at(`ai/chat/${encodeURIComponent(id)}`) : null;
    case 'dm':
      return id ? at(`chat/dm/${encodeURIComponent(id)}`) : null;
    case 'channel':
      return id ? at(`chat/${encodeURIComponent(id)}`) : null;
    case 'ticket':
      return id ? at(`chat/tickets/${encodeURIComponent(id)}`) : null;
    case 'canvas':
      return id ? at(`chat/canvas/${encodeURIComponent(id)}`) : at('chat/canvas');
    case 'knowledge':
      return at('ai/knowledge');
    case 'agents':
      return at('ai/library');
    case 'settings':
      return at('ai/settings');
    default:
      return null;
  }
}

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const title = el.getAttribute('title');
  if (title) return title;
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 80);
}

function visible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

function collect(): Array<{ ref: string; role: string; label: string }> {
  refs.clear();
  const selector =
    'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]';
  const rows: Array<{ ref: string; role: string; label: string }> = [];
  let index = 0;

  for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (rows.length >= MAX_ELEMENTS) break;
    if (node.closest('webview')) continue;
    if (!visible(node)) continue;
    const label = labelOf(node);
    if (!label) continue;
    index += 1;
    const ref = `a${index}`;
    refs.set(ref, node);
    rows.push({
      ref,
      role: node.getAttribute('role') ?? node.tagName.toLowerCase(),
      label,
    });
  }
  return rows;
}

function describe(): string {
  const main = document.querySelector('main') ?? document.body;
  const text = (main.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  return [
    `Screen: ${host?.currentPath() ?? window.location.pathname}`,
    `Title: ${document.title || '(untitled)'}`,
    '',
    text.slice(0, MAX_TEXT_CHARS),
  ].join('\n');
}

async function capture(): Promise<AppToolResult> {
  const capturer = window.electronAPI?.captureAppWindow;
  if (!capturer) {
    return { ok: false, content: 'Screenshots of the Xyne window need the desktop app.' };
  }
  const shot = await capturer(SCREENSHOT_MAX_WIDTH);
  if (!shot?.data) return { ok: false, content: 'Could not capture the Xyne window.' };
  return {
    ok: true,
    content: `Screenshot of the Xyne window at ${host?.currentPath() ?? window.location.pathname}`,
    image: { data: shot.data, mimeType: 'image/png' },
  };
}

export async function executeAppTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<AppToolResult> {
  if (!host) {
    return { ok: false, content: 'The Xyne app is not ready to be driven yet.' };
  }

  try {
    if (toolName === 'app-navigate') {
      const target = asString(args['target']) as AppNavigateTarget;
      const path = pathFor(target, asString(args['id']));
      if (!path) {
        const why = host.workspaceId()
          ? 'that target needs an id, or is not a screen the app has'
          : 'the app has no workspace open yet';
        return { ok: false, content: `Cannot navigate to "${target || '(nothing)'}" — ${why}.` };
      }
      host.navigate(path);
      await delay(SETTLE_MS);
      return { ok: true, content: `Opened ${path} in the Xyne app.` };
    }

    if (toolName === 'app-describe') {
      return { ok: true, content: describe() };
    }

    if (toolName === 'app-snapshot') {
      const rows = collect();
      if (rows.length === 0) return { ok: true, content: 'No interactive elements are visible.' };
      const lines = rows.map(row => `${row.ref} <${row.role}> ${row.label}`);
      return {
        ok: true,
        content: [`Screen: ${host.currentPath()}`, '', ...lines].join('\n'),
      };
    }

    if (toolName === 'app-click') {
      const ref = asString(args['ref']);
      const el = refs.get(ref);
      if (!el) return { ok: false, content: `No element ${ref}. Take an app-snapshot first.` };
      el.scrollIntoView({ block: 'center' });
      el.click();
      await delay(SETTLE_MS);
      return { ok: true, content: `Clicked ${ref} (${labelOf(el)}).` };
    }

    if (toolName === 'app-type') {
      const ref = asString(args['ref']);
      const text = typeof args['text'] === 'string' ? args['text'] : '';
      const el = refs.get(ref);
      if (!el) return { ok: false, content: `No element ${ref}. Take an app-snapshot first.` };
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      el.focus();
      if ('value' in field) {
        const proto =
          field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Reflect.getOwnPropertyDescriptor(proto, 'value') as
          | { set?: (this: HTMLInputElement | HTMLTextAreaElement, value: string) => void }
          | undefined;
        const setValue = descriptor?.set;
        if (setValue) Reflect.apply(setValue, field, [text]);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      await delay(SETTLE_MS);
      return { ok: true, content: `Typed into ${ref}.` };
    }

    if (toolName === 'app-screenshot') {
      return capture();
    }

    return { ok: false, content: `Unknown app tool: ${toolName}` };
  } catch (err) {
    return {
      ok: false,
      content: `App tool ${toolName} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
