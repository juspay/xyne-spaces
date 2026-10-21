import type { CSSProperties } from 'react';

export const CANVAS_BACKGROUNDS = ['light', 'dark', 'checkerboard'] as const;

export type CanvasBackground = (typeof CANVAS_BACKGROUNDS)[number];

export function nextCanvasBackground(current: CanvasBackground): CanvasBackground {
  const index = CANVAS_BACKGROUNDS.indexOf(current);
  return CANVAS_BACKGROUNDS[(index + 1) % CANVAS_BACKGROUNDS.length] ?? 'light';
}

export function canvasBackgroundStyle(background: CanvasBackground): CSSProperties {
  if (background === 'dark') return { backgroundColor: '#111214' };
  if (background === 'checkerboard') {
    return {
      backgroundColor: '#e9eaec',
      backgroundImage:
        'linear-gradient(45deg, #d7d9dd 25%, transparent 25%), linear-gradient(-45deg, #d7d9dd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d7d9dd 75%), linear-gradient(-45deg, transparent 75%, #d7d9dd 75%)',
      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
      backgroundSize: '16px 16px',
    };
  }
  return {};
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function sandboxedPreviewPage(artifactUrl: string, title: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src blob:; style-src 'unsafe-inline'">
<title>${escapeAttribute(title)}</title>
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{overflow:hidden;background:#fff}</style></head>
<body><iframe title="${escapeAttribute(title)}" sandbox="allow-scripts allow-forms allow-modals" referrerpolicy="no-referrer" src="${escapeAttribute(artifactUrl)}"></iframe></body></html>`;
}

const REVOKE_AFTER_MS = 60_000;

export function openSandboxedPreview(html: string, title: string): boolean {
  const artifactUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const pageUrl = URL.createObjectURL(
    new Blob([sandboxedPreviewPage(artifactUrl, title)], { type: 'text/html' }),
  );
  const opened = window.open(pageUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => {
    URL.revokeObjectURL(pageUrl);
    URL.revokeObjectURL(artifactUrl);
  }, REVOKE_AFTER_MS);
  return opened !== null;
}
