import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parsePullRequestUrl,
  pullRequestCardHeight,
  pullRequestCardModel,
} from '@/src/features/conversation/model/pull-request';

describe('parsePullRequestUrl', () => {
  it('reads a pull request link, any tab of it', () => {
    const ref = { owner: 'juspay', repo: 'xyne', number: 5621 };
    assert.deepEqual(parsePullRequestUrl('https://github.com/juspay/xyne/pull/5621'), ref);
    assert.deepEqual(
      parsePullRequestUrl('https://www.github.com/juspay/xyne/pull/5621/files'),
      ref,
    );
  });

  it('ignores other links', () => {
    assert.equal(parsePullRequestUrl('https://github.com/juspay/xyne/issues/12'), null);
    assert.equal(parsePullRequestUrl('https://gitlab.com/a/b/pull/1'), null);
    assert.equal(parsePullRequestUrl('not a url'), null);
  });
});

describe('pullRequestCardModel', () => {
  const ref = { owner: 'juspay', repo: 'xyne', number: 5621 };

  it("keeps only the title from GitHub's page title", () => {
    const model = pullRequestCardModel(ref, {
      title: 'fix: reuse the payment ID by priya · Pull Request #5621 · juspay/xyne',
      host: 'github.com',
    });
    assert.equal(model.title, 'fix: reuse the payment ID');
    assert.equal(model.subtitle, '#5621 · juspay/xyne');
  });

  it('names the pull request by number until the metadata arrives', () => {
    assert.equal(
      pullRequestCardModel(ref, { title: 'github.com', host: 'github.com' }).title,
      'Pull request #5621',
    );
    assert.equal(
      pullRequestCardModel(ref, { title: 'Sign in to GitHub · GitHub', host: 'github.com' }).title,
      'Pull request #5621',
    );
  });

  it('keeps a title that only starts with GitHub', () => {
    assert.equal(
      pullRequestCardModel(ref, { title: 'GitHub Actions: cache pnpm', host: 'github.com' }).title,
      'GitHub Actions: cache pnpm',
    );
  });
});

describe('pullRequestCardHeight', () => {
  it('fits one or two title lines', () => {
    assert.equal(pullRequestCardHeight(1), 72);
    assert.equal(pullRequestCardHeight(2), 92);
    assert.equal(pullRequestCardHeight(4), 92);
  });
});
