import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { linkPreviewSeedFrom } from '../model/linkPreview';

describe('linkPreviewSeedFrom', (): void => {
  it('reads stored link-preview metadata without starting a fetch', (): void => {
    const preview = linkPreviewSeedFrom({
      storedMarkdown: [
        ':::link_preview',
        'url: https://github.com/xyne/spaces',
        'title: Xyne Spaces',
        'description: Collaboration for teams',
        'siteName: GitHub',
        'image: https://github.com/og.png',
        'favicon: https://github.com/favicon.ico',
        ':::',
      ].join('\n'),
    });

    assert.deepEqual(preview, {
      url: 'https://github.com/xyne/spaces',
      title: 'Xyne Spaces',
      description: 'Collaboration for teams',
      siteName: 'GitHub',
      image: 'https://github.com/og.png',
      favicon: 'https://github.com/favicon.ico',
      needsMetadataFetch: false,
      source: 'stored',
      status: 'ready',
    });
  });

  it('accepts the legacy JSON and URL forms', (): void => {
    const json = linkPreviewSeedFrom({
      storedMarkdown: JSON.stringify({
        url: 'https://example.com/docs',
        title: 'Docs',
      }),
    });
    const rawUrl = linkPreviewSeedFrom({ storedMarkdown: 'https://example.com/docs' });

    assert.equal(json?.title, 'Docs');
    assert.equal(json?.source, 'stored');
    assert.equal(rawUrl?.url, 'https://example.com/docs');
    assert.equal(rawUrl?.status, 'ready');
    assert.equal(rawUrl?.description, 'https://example.com/docs');
  });

  it('keeps the URL as the stored-preview description fallback', (): void => {
    const preview = linkPreviewSeedFrom({
      storedMarkdown: [':::link_preview', 'url: https://example.com/docs', ':::'].join('\n'),
    });

    assert.equal(preview?.description, 'https://example.com/docs');
  });

  it('extracts a labeled Markdown link and marks metadata as pending', (): void => {
    const preview = linkPreviewSeedFrom({
      markdown: 'Read the [release notes](https://example.com/releases) before upgrading.',
    });

    assert.equal(preview?.url, 'https://example.com/releases');
    assert.equal(preview?.title, 'release notes');
    assert.equal(preview?.description, 'https://example.com/releases');
    assert.equal(preview?.needsMetadataFetch, true);
    assert.equal(preview?.source, 'extracted');
    assert.equal(preview?.status, 'needsMetadata');
  });

  it('extracts a bare URL without sentence punctuation', (): void => {
    const preview = linkPreviewSeedFrom({ markdown: 'Visit https://example.com/docs.' });

    assert.equal(preview?.url, 'https://example.com/docs');
    assert.equal(preview?.title, 'example.com');
    assert.equal(preview?.description, 'https://example.com/docs');
  });

  it('rejects non-web and malformed URLs', (): void => {
    assert.equal(linkPreviewSeedFrom({ markdown: 'xyne-spaces://call/call-1' }), null);
    assert.equal(linkPreviewSeedFrom({ storedMarkdown: 'https://' }), null);
    assert.equal(
      linkPreviewSeedFrom({ storedMarkdown: JSON.stringify({ url: 'mailto:a@example.com' }) }),
      null,
    );
  });
});
