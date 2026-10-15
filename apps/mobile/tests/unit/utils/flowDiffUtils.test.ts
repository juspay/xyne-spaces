import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyDiffLine,
  countDiffStats,
  createDiffComponentViewModel,
  diffComponentToMarkdown,
  diffNotificationPreview,
  formatDiffStatsLabel,
  isDiffFlow,
} from '@/src/utils/flowDiffUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

const samplePatch = [
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1,3 +1,4 @@',
  ' context',
  '-removed',
  '+added',
  ' context',
].join('\n');

describe('flowDiffUtils', () => {
  it('classifies unified diff lines', () => {
    assert.equal(classifyDiffLine('--- a/file.ts'), 'meta');
    assert.equal(classifyDiffLine('+++ b/file.ts'), 'meta');
    assert.equal(classifyDiffLine('@@ -1,3 +1,4 @@'), 'hunk');
    assert.equal(classifyDiffLine('+added'), 'add');
    assert.equal(classifyDiffLine('-removed'), 'remove');
    assert.equal(classifyDiffLine(' context'), 'context');
  });

  it('counts added and removed lines', () => {
    assert.deepEqual(countDiffStats(samplePatch), { added: 1, removed: 1 });
  });

  it('ignores file headers and lines before the first hunk', () => {
    const patch = [
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '+should-not-count',
      '-should-not-count',
      '@@ -1,2 +1,2 @@',
      '-removed',
      '+added',
    ].join('\n');
    assert.deepEqual(countDiffStats(patch), { added: 1, removed: 1 });
  });

  it('builds a diff view model from a flow component', () => {
    const component: FlowComponentLike = {
      type: 'diff',
      props: {
        path: 'src/example.ts',
        patch: samplePatch,
      },
    };

    const viewModel = createDiffComponentViewModel(component);
    assert.ok(viewModel);
    assert.equal(viewModel.path, 'src/example.ts');
    assert.equal(viewModel.added, 1);
    assert.equal(viewModel.removed, 1);
    assert.equal(viewModel.lines.length, 7);
  });

  it('returns null when diff props are missing', () => {
    assert.equal(createDiffComponentViewModel({ type: 'diff', props: { path: 'a.ts' } }), null);
    assert.equal(createDiffComponentViewModel({ type: 'plan' }), null);
  });

  it('formats diff stats labels', () => {
    assert.equal(formatDiffStatsLabel(3, 1), '+3 −1');
  });

  it('builds notification preview text', () => {
    assert.equal(diffNotificationPreview('src/a.ts'), '📝 Shared a diff: src/a.ts');
    assert.equal(diffNotificationPreview(''), '📝 Shared a diff');
    assert.equal(diffNotificationPreview(null), '📝 Shared a diff');
  });

  it('detects diff flows', () => {
    assert.equal(
      isDiffFlow({
        data: { kind: 'diff' },
        components: [],
      }),
      true,
    );
    assert.equal(
      isDiffFlow({
        components: [{ type: 'diff' }],
      }),
      true,
    );
    assert.equal(isDiffFlow({ components: [{ type: 'code' }] }), false);
  });

  it('projects diff components to markdown for collapsed previews', () => {
    const markdown = diffComponentToMarkdown({
      type: 'diff',
      props: {
        path: 'src/example.ts',
        patch: samplePatch,
      },
    });

    assert.match(markdown, /\*\*src\/example\.ts\*\* \(\+1 −1\)/);
    assert.match(markdown, /```diff/);
    assert.match(markdown, /\+added/);
    assert.match(markdown, /-removed/);
  });
});
