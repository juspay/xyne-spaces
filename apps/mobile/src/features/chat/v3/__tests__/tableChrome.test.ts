import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildTableStyle } from '../model/text/tableChrome';

describe('buildTableStyle', (): void => {
  const dark = {
    foreground: '#f1fff9',
    headerBackground: '#262626',
    borderColor: '#333333',
  };

  it('sets every colour slot so the renderer never uses its light-only defaults', (): void => {
    const style = buildTableStyle(dark);
    assert.equal(style.color, dark.foreground);
    assert.equal(style.headerTextColor, dark.foreground);
    assert.equal(style.headerBackgroundColor, dark.headerBackground);
    assert.equal(style.borderColor, dark.borderColor);
    assert.equal(style.rowEvenBackgroundColor, 'transparent');
    assert.equal(style.rowOddBackgroundColor, 'transparent');
  });

  it('scales font size from the variant size', (): void => {
    assert.equal(buildTableStyle(dark).fontSize, 15);
    assert.equal(buildTableStyle({ ...dark, fontSize: 12 }).fontSize, 12);
  });
});

describe('Flow JSON theme wiring', (): void => {
  const read = (relativePath: string): string =>
    readFileSync(new URL(relativePath, import.meta.url), 'utf8');

  it('uses chat tokens instead of fixed light greys', (): void => {
    const control = read('../rows/parts/FlowJsonControl.tsx');
    const body = read('../rows/parts/FlowJsonMessageBody.tsx');
    assert.match(control, /borderColor: tokens\.tableBorderColor/);
    assert.match(control, /backgroundColor: selected \? 'transparent' : tokens\.tableHeaderBg/);
    assert.match(body, /backgroundColor: tokens\.tableBorderColor/);
    assert.match(body, /borderColor: nativeStyle\.borderColor \?\? tokens\.tableBorderColor/);
    assert.equal(
      /#(?:d1d5db|e5e7eb|1f2937)/i.test(`${control}
${body}`),
      false,
    );
  });
});
