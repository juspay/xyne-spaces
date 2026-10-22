import { describe, expect, it } from 'vitest';
import {
  canvasBackgroundStyle,
  nextCanvasBackground,
  sandboxedPreviewPage,
} from '../designPreviewChrome';

describe('canvas background', () => {
  it('cycles light → dark → checkerboard → light', () => {
    expect(nextCanvasBackground('light')).toBe('dark');
    expect(nextCanvasBackground('dark')).toBe('checkerboard');
    expect(nextCanvasBackground('checkerboard')).toBe('light');
  });

  it('gives each background its own style', () => {
    expect(canvasBackgroundStyle('light')).toEqual({});
    expect(canvasBackgroundStyle('dark')).toEqual({ backgroundColor: '#111214' });
    expect(canvasBackgroundStyle('checkerboard').backgroundImage).toContain('linear-gradient');
  });
});

describe('sandboxed new-tab page', () => {
  const page = sandboxedPreviewPage('blob:http://localhost:5173/abc', 'Bean There');

  it('runs the design in a sandbox with no same-origin access', () => {
    expect(page).toContain('sandbox="allow-scripts allow-forms allow-modals"');
    expect(page).not.toContain('allow-same-origin');
    expect(page).not.toContain('allow-top-navigation');
  });

  it('locks the outer page down to framing a blob and nothing else', () => {
    expect(page).toContain(
      `content="default-src 'none'; frame-src blob:; style-src 'unsafe-inline'"`,
    );
    expect(page).not.toMatch(/<script/i);
  });

  it('points the frame at the design blob', () => {
    expect(page).toContain('src="blob:http://localhost:5173/abc"');
  });

  it('escapes the title and URL', () => {
    const hostile = sandboxedPreviewPage(
      'blob:x"><script>alert(1)</script>',
      '</title><script>x</script>',
    );
    expect(hostile).not.toMatch(/<script/i);
    expect(hostile).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(hostile).toContain('src="blob:x&quot;&gt;&lt;script&gt;');
  });
});
