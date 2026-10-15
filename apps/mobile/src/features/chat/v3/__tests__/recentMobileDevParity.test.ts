import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('chat v3 parity with mobile-dev since 2026-09-17', (): void => {
  it('sanitizes flow link and image urls before they are opened or loaded', (): void => {
    const body = read('../rows/parts/FlowJsonMessageBody.tsx');
    const image = read('../rows/parts/FlowImage.tsx');
    assert.match(body, /sanitizeFlowUrl\(getStringProp\(props, 'href'\)\)/);
    assert.match(image, /sanitizeFlowUrl\(getStringProp\(props, 'src'\)\)/);
  });

  it('matches the current v2 external-link handoff contract', (): void => {
    const v2Preview = read('../../v2/components/chat/link-preview-card.tsx');
    const preview = read('../rows/parts/LinkPreviewCard.tsx');
    const pr = read('../rows/parts/FlowPrCard.tsx');
    // Both previews only hand http(s)/mailto/tel links to the OS.
    for (const source of [v2Preview, preview]) {
      assert.match(source, /if \(isSafeExternalUrl\(resolvedPreview\.url\)\) \{/);
      assert.match(source, /Linking\.openURL\(resolvedPreview\.url\)/);
    }
    assert.match(pr, /isSafeFlowLink\(url\)/);
  });

  it('uses the v2 GitHub markdown flavor for table bodies', (): void => {
    const block = read('../rows/BlockMarkdown.tsx');
    assert.match(block, /hasMarkdownTable/);
    assert.match(block, /flavor: 'github'/);
  });

  it('clips tall diffs and exposes read more, matching v2', (): void => {
    const card = read('../rows/parts/FlowDiffCard.tsx');
    assert.match(card, /PREVIEW_MAX_HEIGHT = 220/);
    assert.match(card, /accessibilityLabel=\{expanded \? 'Show less' : 'Read more'\}/);
    assert.match(card, /bg-diff-line-add-bg/);
    assert.match(card, /useRecyclingState/);
  });

  it('connects MCP suggestions instead of rendering a static card', (): void => {
    const card = read('../rows/parts/FlowMcpSuggestCard.tsx');
    const rows = read('../rows/parts/FlowMcpSuggestRows.tsx');
    assert.match(card, /McpConnectSheet/);
    assert.match(card, /startMcpOAuth/);
    assert.match(card, /createMcpConnection/);
    assert.match(rows, /Connect \$\{connector\.name\}/);
    assert.equal(/useMcpSuggestConnect|features\/chat\/v2/.test(card + rows), false);
  });

  it('remounts date pills by label and records separator layout', (): void => {
    const row = read('../rows/DateRow.tsx');
    const floating = read('../list/FloatingDateHeader.tsx');
    const list = read('../list/ConversationList.tsx');
    assert.match(row, /key=\{`date-pill-\$\{dateText\}`\}/);
    assert.match(row, /recordDateSeparatorLayout\('inline'/);
    assert.match(floating, /recordDateSeparatorLayout\('floating'/);
    assert.match(list, /useFloatingDate\(\s*surface/);
  });
});
