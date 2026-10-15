import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLASSIC_SHELL_SEGMENT,
  SPACES_INITIAL_TAB,
  SPACES_SHELL_SEGMENT,
  overflowTabPath,
  setTabShellResolver,
  tabPath,
} from '@/src/navigation/routes';

describe('tab shell resolution', () => {
  it('builds a classic path by default', () => {
    assert.equal(tabPath('dms'), `/(protected)/${CLASSIC_SHELL_SEGMENT}/dms`);
  });

  it('follows the injected resolver into the spaces shell', () => {
    setTabShellResolver(() => SPACES_SHELL_SEGMENT);
    assert.equal(tabPath('dms'), `/(protected)/${SPACES_SHELL_SEGMENT}/dms`);
    setTabShellResolver(() => CLASSIC_SHELL_SEGMENT);
  });
});

describe('overflowTabPath', () => {
  it('is the More tab in the classic shell, which hosts one', () => {
    setTabShellResolver(() => CLASSIC_SHELL_SEGMENT);
    assert.equal(overflowTabPath(), `/(protected)/${CLASSIC_SHELL_SEGMENT}/more`);
  });

  it('never builds a `more` path in the spaces shell, which has no such route', () => {
    // `(spaces)/more` matches nothing, so anything navigating there — the guide
    // header's back fallback, the "Open the More tab" link — dead-ends.
    setTabShellResolver(() => SPACES_SHELL_SEGMENT);

    assert.equal(overflowTabPath(), `/(protected)/${SPACES_SHELL_SEGMENT}/${SPACES_INITIAL_TAB}`);
    assert.ok(!overflowTabPath().endsWith('/more'));

    setTabShellResolver(() => CLASSIC_SHELL_SEGMENT);
  });

  it('resolves per call, so a shell change is never baked in', () => {
    setTabShellResolver(() => CLASSIC_SHELL_SEGMENT);
    const classic = overflowTabPath();
    setTabShellResolver(() => SPACES_SHELL_SEGMENT);
    const spaces = overflowTabPath();

    assert.notEqual(classic, spaces);
    setTabShellResolver(() => CLASSIC_SHELL_SEGMENT);
  });
});
