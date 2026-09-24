import type { Message } from '../../../Chat/XyneAISidebar/utils/XyneAITypes';

export interface DesignNodeSelection {
  selector: string;
  tagName: string;
  label: string;
  id?: string;
  classes: string[];
  text: string;
  ancestors: string[];
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
}

export type DesignEditScope = 'element' | 'component' | 'design-system';

export interface DesignManualEdit {
  selector: string;
  oldText?: string;
  newText?: string;
  styles?: Record<string, string>;
  stale?: boolean;
}

export interface AppliedManualEdits {
  html: string;
  edits: DesignManualEdit[];
}

export type DesignPreviewSource =
  | { kind: 'attachment'; attachmentId: string; fileName: string }
  | { kind: 'inline'; html: string; fileName: string };

export interface DesignVersion {
  source: DesignPreviewSource;
  messageId: string;
  messageIndex: number;
  createdAt: string;
  label: string;
}

export const DESIGN_INSPECTOR_EVENT = 'xyne-design-node-selected';
export const DESIGN_INSPECTOR_MODE_EVENT = 'xyne-design-inspector-mode';
export const DESIGN_EDIT_EVENT = 'xyne-design-text-edited';
export const DESIGN_SCROLL_EVENT = 'xyne-design-scroll';
export const DESIGN_SCROLL_RESTORE_EVENT = 'xyne-design-scroll-restore';
export const DESIGN_VERIFY_EVENT = 'xyne-design-verify-selection';
export const DESIGN_VERIFY_RESULT_EVENT = 'xyne-design-verify-selection-result';

export function serializeDesignDocument(document: Document): string {
  const doctype = document.doctype;
  const serializedDoctype = doctype
    ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ''}${
        doctype.systemId ? `${doctype.publicId ? '' : ' SYSTEM'} "${doctype.systemId}"` : ''
      }>`
    : '';
  return `${serializedDoctype}${document.documentElement.outerHTML}`;
}

export function applyManualEdits(html: string, edits: DesignManualEdit[]): AppliedManualEdits {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const appliedEdits = edits.map(edit => {
    let element: Element | null = null;
    try {
      element = document.querySelector(edit.selector);
    } catch {
      element = null;
    }
    if (!element) {
      return { ...edit, stale: true };
    }
    if (edit.styles) {
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
        return { ...edit, stale: true };
      }
      for (const [property, value] of Object.entries(edit.styles)) {
        element.style.setProperty(property, value);
      }
      return { ...edit, stale: false };
    }
    if (
      typeof edit.oldText !== 'string' ||
      typeof edit.newText !== 'string' ||
      (element.textContent ?? '').trim() !== edit.oldText.trim()
    ) {
      return { ...edit, stale: true };
    }
    element.textContent = edit.newText;
    return { ...edit, stale: false };
  });
  return { html: serializeDesignDocument(document), edits: appliedEdits };
}

export function normalizeDesignNodeSelection(input: unknown): DesignNodeSelection | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value['selector'] !== 'string' || typeof value['tagName'] !== 'string') return null;
  const strings = (candidate: unknown, limit: number, itemLimit: number): string[] =>
    Array.isArray(candidate)
      ? candidate
          .filter((item): item is string => typeof item === 'string')
          .slice(0, limit)
          .map(item => item.slice(0, itemLimit))
      : [];
  const styles = Object.fromEntries(
    Object.entries(
      value['styles'] && typeof value['styles'] === 'object'
        ? (value['styles'] as Record<string, unknown>)
        : {},
    )
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .slice(0, 30)
      .map(([key, styleValue]) => [key.slice(0, 80), styleValue.slice(0, 240)]),
  );
  const rawRect =
    value['rect'] && typeof value['rect'] === 'object'
      ? (value['rect'] as Record<string, unknown>)
      : {};
  const number = (candidate: unknown): number =>
    typeof candidate === 'number' && Number.isFinite(candidate) ? Math.round(candidate) : 0;
  const selector = value['selector'].slice(0, 600);
  const tagName = value['tagName'].slice(0, 80);
  return {
    selector,
    tagName,
    label: typeof value['label'] === 'string' ? value['label'].slice(0, 240) : tagName,
    ...(typeof value['id'] === 'string' ? { id: value['id'].slice(0, 160) } : {}),
    classes: strings(value['classes'], 16, 120),
    text: typeof value['text'] === 'string' ? value['text'].slice(0, 1200) : '',
    ancestors: strings(value['ancestors'], 6, 600),
    styles,
    rect: {
      x: number(rawRect['x']),
      y: number(rawRect['y']),
      width: number(rawRect['width']),
      height: number(rawRect['height']),
    },
  };
}

export function withDesignInspector(html: string): string {
  const inspector = String.raw`
(function () {
  if (window.__xyneDesignInspector) return;
  window.__xyneDesignInspector = true;
  var enabled = false;
  var editingElement = null;
  var editingOriginalText = '';
  var editingOutline = '';
  var editingOutlineOffset = '';
  var clickTimer = null;
  var overlay = document.createElement('div');
  overlay.setAttribute('data-xyne-design-inspector', 'true');
  overlay.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;border:2px solid #7657ff;background:rgba(118,87,255,.09);box-shadow:0 0 0 1px rgba(255,255,255,.7) inset;border-radius:3px;transition:all 60ms linear';

  function mount() {
    if (!overlay.isConnected && document.body) document.body.appendChild(overlay);
  }
  function esc(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
  function selectorFor(element) {
    if (element.id) return '#' + esc(element.id);
    var dataId = element.getAttribute('data-id');
    if (dataId) return '[data-id="' + String(dataId).replace(/"/g, '\\"') + '"]';
    var parts = [];
    var current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement && parts.length < 6) {
      var part = current.tagName.toLowerCase();
      var classes = Array.prototype.slice.call(current.classList || []).filter(function (name) {
        return name && name.length < 48 && !/^active$|^hover$|^focus$/.test(name);
      }).slice(0, 2);
      if (classes.length) part += '.' + classes.map(esc).join('.');
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (node) { return node.tagName === current.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }
  function shortName(element) {
    var value = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '';
    value = value.replace(/\s+/g, ' ').trim().slice(0, 80);
    return element.tagName.toLowerCase() + (value ? ' · ' + value : '');
  }
  function moveOverlay(element) {
    mount();
    var rect = element.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = Math.max(0, rect.width) + 'px';
    overlay.style.height = Math.max(0, rect.height) + 'px';
  }
  function describe(element) {
    var style = getComputedStyle(element);
    var rect = element.getBoundingClientRect();
    var styleNames = ['display','position','font-family','font-size','font-weight','line-height','color','background-color','fill','stroke','border-radius','border','padding','margin','gap','width','height','max-width','justify-content','align-items','grid-template-columns'];
    var styles = {};
    styleNames.forEach(function (name) {
      var value = style.getPropertyValue(name);
      if (value) styles[name] = value.trim();
    });
    var ancestors = [];
    var parent = element.parentElement;
    while (parent && parent !== document.documentElement && ancestors.length < 4) {
      ancestors.unshift(selectorFor(parent));
      parent = parent.parentElement;
    }
    return {
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      label: shortName(element),
      id: element.id || undefined,
      classes: Array.prototype.slice.call(element.classList || []).slice(0, 12),
      text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      ancestors: ancestors,
      styles: styles,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  }
  function canEditText(element) {
    if (element === overlay || element.isContentEditable) return false;
    var text = String(element.textContent || '');
    if (text.trim().length < 2) return false;
    var allowed = { A: true, B: true, I: true, SPAN: true, STRONG: true, EM: true };
    return Array.prototype.every.call(element.querySelectorAll('*'), function (child) { return allowed[child.tagName] === true; });
  }
  function finishEditing(commit) {
    if (!editingElement) return;
    var element = editingElement;
    var originalText = editingOriginalText;
    var newText = String(element.textContent || '');
    editingElement = null;
    if (!commit) element.textContent = originalText;
    element.removeAttribute('contenteditable');
    element.style.outline = editingOutline;
    element.style.outlineOffset = editingOutlineOffset;
    if (commit && newText !== originalText) {
      window.parent.postMessage({
        type: '${DESIGN_EDIT_EVENT}',
        edit: { selector: selectorFor(element), oldText: originalText, newText: newText }
      }, '*');
    }
  }
  function beginEditing(element) {
    if (!canEditText(element)) return;
    if (editingElement) finishEditing(true);
    editingElement = element;
    editingOriginalText = String(element.textContent || '');
    editingOutline = element.style.outline;
    editingOutlineOffset = element.style.outlineOffset;
    element.setAttribute('contenteditable', 'true');
    element.style.outline = '2px dashed #7657ff';
    element.style.outlineOffset = '2px';
    element.focus();
    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(element);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      window.parent.postMessage({ type: '${DESIGN_SCROLL_EVENT}', y: window.scrollY || 0 }, '*');
    }, 150);
  }, { passive: true });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === '${DESIGN_VERIFY_EVENT}') {
      var sel = String(event.data.selector || '');
      var ok = false;
      try { ok = !!(sel && document.querySelector(sel)); } catch (e) { ok = false; }
      window.parent.postMessage({ type: '${DESIGN_VERIFY_RESULT_EVENT}', ok: ok }, '*');
      return;
    }
    if (event.data && event.data.type === '${DESIGN_SCROLL_RESTORE_EVENT}') {
      var y = Number(event.data.y) || 0;
      if (y > 0) {
        window.scrollTo(0, y);
        setTimeout(function () { window.scrollTo(0, y); }, 120);
      }
      return;
    }
    if (!event.data || event.data.type !== '${DESIGN_INSPECTOR_MODE_EVENT}') return;
    enabled = event.data.enabled === true;
    document.documentElement.style.cursor = enabled ? 'crosshair' : '';
    if (!enabled) {
      if (editingElement) finishEditing(true);
      overlay.style.display = 'none';
    }
  });
  document.addEventListener('mousemove', function (event) {
    if (!enabled || editingElement) return;
    var target = event.target;
    if (!(target instanceof Element) || target === overlay) return;
    moveOverlay(target);
  }, true);
  document.addEventListener('click', function (event) {
    if (!enabled) return;
    var target = event.target;
    if (!(target instanceof Element) || target === overlay) return;
    if (editingElement && editingElement.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    moveOverlay(target);
    if (clickTimer) window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(function () {
      clickTimer = null;
      window.parent.postMessage({ type: '${DESIGN_INSPECTOR_EVENT}', selection: describe(target) }, '*');
    }, 220);
  }, true);
  document.addEventListener('dblclick', function (event) {
    if (!enabled) return;
    var target = event.target;
    if (!(target instanceof Element) || !canEditText(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer) {
      window.clearTimeout(clickTimer);
      clickTimer = null;
    }
    beginEditing(target);
  }, true);
  document.addEventListener('focusout', function (event) {
    if (editingElement && event.target === editingElement) finishEditing(true);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (editingElement && event.target instanceof Node && editingElement.contains(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishEditing(false);
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        finishEditing(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      enabled = false;
      overlay.style.display = 'none';
      document.documentElement.style.cursor = '';
      window.parent.postMessage({ type: '${DESIGN_INSPECTOR_MODE_EVENT}', enabled: false }, '*');
    }
  }, true);
  mount();
})();`;
  const closing = `</${'script'}>`;
  const tag = `<script data-xyne-design-inspector>${inspector}${closing}`;
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${tag}</body>`)
    : `${html}${tag}`;
}

export function htmlToBase64(html: string): string {
  const bytes = new TextEncoder().encode(html);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function messageText(message: Message): string {
  return message.content || message.streamingContent || '';
}

export function htmlFromMessage(message: Message): string | null {
  const matches = [...messageText(message).matchAll(/```html\s*([\s\S]*?)(?:```|$)/gi)];
  const html = matches.length ? matches[matches.length - 1]?.[1]?.trim() : undefined;
  if (!html || (!/<html[\s>]/i.test(html) && !/<!doctype\s+html/i.test(html))) return null;
  return html;
}

export function hasDesignHtml(content: string): boolean {
  const matches = [...content.matchAll(/```html\s*([\s\S]*?)(?:```|$)/gi)];
  const html = matches.length ? matches[matches.length - 1]?.[1]?.trim() : undefined;
  return !!html && (/<html[\s>]/i.test(html) || /<!doctype\s+html/i.test(html));
}

export function designChatContent(content: string): string {
  const hadHtml = /```html\s*/i.test(content);
  const withoutHtml = content.replace(/```html\s*[\s\S]*?(?:```|$)/gi, '').trim();
  return withoutHtml || (hadHtml ? 'Design updated in preview.' : content);
}

function attachmentFileName(attachment: { originalFilename?: string; filename?: string }): string {
  return attachment.originalFilename || attachment.filename || 'xyne-design.html';
}

export function designVersions(messages: Message[]): DesignVersion[] {
  const versions: DesignVersion[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || message.type !== 'bot') continue;
    const attachment = [...(message.attachments ?? [])]
      .reverse()
      .find(
        item =>
          !!item.id &&
          ((item.mimeType ?? '').toLowerCase().includes('text/html') ||
            attachmentFileName(item).toLowerCase().endsWith('.html')),
      );
    const source: DesignPreviewSource | null = attachment?.id
      ? {
          kind: 'attachment',
          attachmentId: attachment.id,
          fileName: attachmentFileName(attachment),
        }
      : (() => {
          const html = htmlFromMessage(message);
          return html
            ? ({ kind: 'inline', html, fileName: 'xyne-design.html' } as DesignPreviewSource)
            : null;
        })();
    if (!source) continue;
    versions.push({
      source,
      messageId: message.id,
      messageIndex: i,
      createdAt:
        message.timestamp instanceof Date
          ? message.timestamp.toISOString()
          : new Date().toISOString(),
      label: `v${versions.length + 1}`,
    });
  }
  return versions;
}
