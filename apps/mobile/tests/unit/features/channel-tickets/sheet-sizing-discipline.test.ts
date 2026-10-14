import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Every bottom sheet in the tickets flow must be sized from an explicit snap
 * point, not from gorhom's dynamic content measurement.
 *
 * With dynamic sizing, gorhom derives its only snap point from the height that
 * `BottomSheetView` reports; plain children report nothing, and even a
 * `BottomSheetView` can lose the race against the first `snapToIndex(0)`. Either
 * way the sheet never engages: no onChange, nothing drawn, and (behind a portal)
 * a touch layer left stuck over the screen. These checks read the source so the
 * regression is caught without a device.
 */
const ROOT = process.cwd();
const CHANNEL_TICKETS_COMPONENTS = resolve(ROOT, 'src/features/channel-tickets/components');
const PRIORITY_SHEET = resolve(
  ROOT,
  'src/features/xyne-desks/tickets/components/tickets-priority-filter/tickets-priority-filter-sheet.tsx',
);

const readSource = (file: string): string => readFileSync(file, 'utf8');

/** Source with block and line comments removed, so prose about the bug is not matched. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('tickets-flow bottom sheets are snap-sized', () => {
  it('no channel-tickets component uses AppBottomSheet in dynamic mode', () => {
    const offenders = readdirSync(CHANNEL_TICKETS_COMPONENTS)
      .filter(name => name.endsWith('.tsx'))
      .filter(name =>
        /mode=['"]dynamic['"]/.test(
          withoutComments(readSource(resolve(CHANNEL_TICKETS_COMPONENTS, name))),
        ),
      );
    assert.deepEqual(offenders, []);
  });

  it('the filters drawer declares snap points and wraps content in BottomSheetView', () => {
    const source = readSource(
      resolve(CHANNEL_TICKETS_COMPONENTS, 'channel-tickets-filter-drawer.tsx'),
    );
    assert.match(source, /mode=['"]snap['"]/);
    assert.match(source, /snapPoints=\{snapPoints\}/);
    assert.match(source, /<BottomSheetView\b/);
  });

  it('the reused priority sheet disables dynamic sizing and declares snap points', () => {
    const source = readSource(PRIORITY_SHEET);
    assert.match(source, /enableDynamicSizing=\{false\}/);
    assert.match(source, /snapPoints=\{snapPoints\}/);
    assert.doesNotMatch(source, /maxDynamicContentSize=/);
  });
});
