import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('v3 chat render tokens (P1)', (): void => {
  it('resolves tokens once at the list and provides them to rows', (): void => {
    const list = read('../list/ConversationList.tsx');
    assert.equal(/ChatRenderProvider/.test(list), true);
    assert.equal(/useWindowDimensions/.test(list), true);
    assert.equal(/useChatRenderTokens/.test(list), true);
  });

  it('does not subscribe to CSS variables per row on the send path', (): void => {
    const sender = read('../rows/useSenderColor.ts');
    const body = read('../rows/MessageRowBody.tsx');
    assert.equal(/useCSSVariable/.test(sender), false);
    assert.equal(/useCSSVariable/.test(body), false);
    assert.equal(/usernamePalette/.test(sender), true);
  });

  it('paints own-message bubbles from currentUserBubbleBg', (): void => {
    const row = read('../rows/MessageRow.tsx');
    assert.equal(/currentUserBubbleBg/.test(row), true);
    assert.equal(/inlineContentMaxWidth/.test(row), true);
    assert.equal(/w-\[86%\]/.test(row), false);
  });

  it('paints system rows with the v2 composer system pill', (): void => {
    const system = read('../rows/SystemMessageRow.tsx');
    assert.equal(/bg-conversation-composer-system-bg/.test(system), true);
    assert.equal(/text-conversation-composer-system-text/.test(system), true);
    assert.equal(/text-xs font-medium/.test(system), true);
    assert.equal(/tracking-\[-0\.16px\]/.test(system), true);
    assert.equal(/text-\[12\.5px\]/.test(system), false);
    assert.equal(/MessageRowBody/.test(system), false);
  });
});
