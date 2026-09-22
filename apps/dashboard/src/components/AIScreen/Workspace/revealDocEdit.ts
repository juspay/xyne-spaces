import { getWorkspaceWebview } from './workspaceBrowserTools';

const MIN_ANCHOR_CHARS = 12;
const MAX_ANCHOR_CHARS = 60;
const RELOAD_SETTLE_MS = 2600;
const KEY_STEP_MS = 90;
const DIALOG_SETTLE_MS = 700;

const EDIT_TOOLS = ['google-docs-edit', 'google-docs-append', 'google-docs-format'];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isDocEditTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return EDIT_TOOLS.some(tool => normalized.includes(tool));
}

export function anchorFromArgs(args: Record<string, unknown>): string {
  const candidates = ['replaceText', 'replacementText', 'text', 'insertText', 'content'];
  for (const key of candidates) {
    const value = args[key];
    if (typeof value !== 'string') continue;
    const firstLine = value
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length >= MIN_ANCHOR_CHARS);
    if (firstLine) return firstLine.slice(0, MAX_ANCHOR_CHARS);
  }
  return '';
}

export function documentIdFromArgs(args: Record<string, unknown>): string {
  for (const key of ['documentId', 'docId', 'fileId', 'id']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function sendKey(
  view: ReturnType<typeof getWorkspaceWebview>,
  keyCode: string,
  modifiers: string[] = [],
): void {
  if (!view) return;
  void view.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  void view.sendInputEvent({ type: 'char', keyCode, modifiers });
  void view.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

async function typeText(view: ReturnType<typeof getWorkspaceWebview>, text: string): Promise<void> {
  for (const character of text) {
    sendKey(view, character);
    await delay(12);
  }
}

export async function revealDocEdit(documentId: string, anchor: string): Promise<boolean> {
  const view = getWorkspaceWebview();
  if (!view || !anchor || anchor.length < MIN_ANCHOR_CHARS) return false;

  let currentUrl = '';
  let parsedUrl: URL;
  try {
    currentUrl = view.getURL();
    parsedUrl = new URL(currentUrl);
  } catch {
    return false;
  }

  const host = parsedUrl.hostname.toLowerCase();
  if (host !== 'docs.google.com' && !host.endsWith('.docs.google.com')) return false;
  if (documentId && !currentUrl.includes(documentId)) return false;

  try {
    view.reload();
    await delay(RELOAD_SETTLE_MS);
    view.focus();

    sendKey(view, 'f', ['meta']);
    await delay(DIALOG_SETTLE_MS);
    await typeText(view, anchor);
    await delay(KEY_STEP_MS);
    sendKey(view, 'Enter');
    await delay(KEY_STEP_MS);
    sendKey(view, 'Escape');
    return true;
  } catch {
    return false;
  }
}
