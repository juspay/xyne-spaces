import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPrCardViewModel,
  prComponentToMarkdown,
  prDescPreviewText,
  prProviderOpenLabel,
  prStatusLabel,
} from '@/src/utils/flowPrUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

const samplePr: FlowComponentLike = {
  id: 'pr',
  type: 'pr',
  props: {
    status: 'created',
    provider: 'github',
    title: 'fix: reduce profile screen status dot size on mobile',
    desc: '## What\nReduces the online-status dot size.',
    url: 'https://github.com/juspay/xyne-spaces-private/pull/257',
  },
};

describe('flowPrUtils', () => {
  it('builds a PR view model from flow props', () => {
    const viewModel = createPrCardViewModel(samplePr);
    assert.ok(viewModel);
    assert.equal(viewModel.status, 'created');
    assert.equal(viewModel.statusLabel, 'PR Created');
    assert.equal(viewModel.badgeTone, 'created');
    assert.equal(viewModel.openProviderLabel, 'Open in GitHub');
    assert.equal(viewModel.url, 'https://github.com/juspay/xyne-spaces-private/pull/257');
  });

  it('strips trailing backslash / %5C escape artifacts from PR urls', () => {
    const viewModel = createPrCardViewModel({
      type: 'pr',
      props: {
        status: 'created',
        provider: 'github',
        title: 'fix: something',
        url: 'https://github.com/juspay/xyne-spaces-private/pull/329\\',
        detailsUrl: 'https://github.com/juspay/xyne-spaces-private/issues/12%5C ',
      },
    });
    assert.ok(viewModel);
    assert.equal(viewModel.url, 'https://github.com/juspay/xyne-spaces-private/pull/329');
    assert.equal(viewModel.detailsUrl, 'https://github.com/juspay/xyne-spaces-private/issues/12');
    assert.ok(!viewModel.url?.includes('%5C'));
    assert.ok(!viewModel.url?.endsWith('\\'));
  });

  it('keeps already-clean PR urls untouched', () => {
    const viewModel = createPrCardViewModel(samplePr);
    assert.equal(viewModel?.url, 'https://github.com/juspay/xyne-spaces-private/pull/257');
  });

  it('rejects missing title or status', () => {
    assert.equal(createPrCardViewModel({ type: 'pr', props: { status: 'created' } }), null);
    assert.equal(createPrCardViewModel({ type: 'pr', props: { title: 'x' } }), null);
    assert.equal(createPrCardViewModel({ type: 'agent' }), null);
  });

  it('maps status labels and provider open labels', () => {
    assert.equal(prStatusLabel('merged'), 'PR Merged');
    assert.equal(prStatusLabel('declined'), 'PR Declined');
    assert.equal(prProviderOpenLabel('gitlab'), 'Open in GitLab');
    assert.equal(prProviderOpenLabel('other'), 'Open pull request');
  });

  it('flattens desc for compact preview', () => {
    assert.equal(prDescPreviewText('## What\nHello **world**'), 'What Hello world');
  });

  it('projects PR components to markdown', () => {
    const markdown = prComponentToMarkdown(samplePr);
    assert.match(markdown, /\*\*PR Created\*\*/);
    assert.match(markdown, /fix: reduce profile screen status dot size on mobile/);
    assert.match(markdown, /\[Open in GitHub\]\(https:\/\/github\.com/);
  });
});
