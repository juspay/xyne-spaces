import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const blockMarkdownStyleSource = readFileSync(
  new URL('../rows/blockMarkdownStyle.ts', import.meta.url),
  'utf8',
);

import { buildInlineCodeStyle, inlineCodeSurfaceFor } from '../model/text/inlineCodeChrome';

describe('blockMarkdownStyle inline code', (): void => {
  const tokens = {
    embeddedBgUser: 'rgba(255, 255, 255, 0.13)',
    cardBg: '#181818',
  };

  it('uses embedded tint on own bubbles and card surface on others', (): void => {
    assert.deepEqual(inlineCodeSurfaceFor(true, tokens, '#f1fff9'), {
      foreground: '#f1fff9',
      backgroundColor: 'rgba(255, 255, 255, 0.13)',
    });
    assert.deepEqual(inlineCodeSurfaceFor(false, tokens, '#f1fff9'), {
      foreground: '#f1fff9',
      backgroundColor: '#181818',
    });
  });

  it('builds monospace inline code with a background chip', (): void => {
    const style = buildInlineCodeStyle(
      {
        foreground: '#f1fff9',
        backgroundColor: 'rgba(255, 255, 255, 0.13)',
      },
      'Menlo',
    );
    assert.ok(style.fontFamily);
    assert.equal(style.backgroundColor, 'rgba(255, 255, 255, 0.13)');
    assert.equal(style.color, '#f1fff9');
  });
});

describe('blockMarkdownStyle table wiring', (): void => {
  it('maps the required theme inputs into the emitted table style', (): void => {
    assert.match(
      blockMarkdownStyleSource,
      /table:\s*buildTableStyle\(\{\s*foreground,\s*headerBackground: tableHeaderBackground,\s*borderColor: tableBorderColor,\s*fontSize,\s*\}\)/,
    );
  });
});
