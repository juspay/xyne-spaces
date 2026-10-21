import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const overlayDir = fileURLToPath(new URL('../overlays', import.meta.url));

describe('v3 overlay hosts', (): void => {
  it('do not import frozen v2 chat code', (): void => {
    const files = readdirSync(overlayDir).filter(
      name => name.endsWith('.ts') || name.endsWith('.tsx'),
    );
    assert.ok(files.includes('ForwardHost.tsx'));
    assert.ok(files.includes('ReminderOptionsHost.tsx'));
    assert.ok(files.includes('ReactionsHost.tsx'));
    assert.ok(files.includes('UserProfileActionsHost.tsx'));
    for (const name of files) {
      const source = readFileSync(join(overlayDir, name), 'utf8');
      assert.equal(/features\/chat\/v2/.test(source), false, name);
      assert.equal(/extraData=/.test(source), false, name);
    }
  });

  it('hosts are controlled sheets, not v2-style context providers', (): void => {
    for (const name of [
      'ForwardHost.tsx',
      'ReminderOptionsHost.tsx',
      'ReactionsHost.tsx',
      'UserProfileActionsHost.tsx',
      'MessageActionsHost.tsx',
      'EmojiPickerHost.tsx',
    ]) {
      const source = readFileSync(join(overlayDir, name), 'utf8');
      assert.equal(/createContext/.test(source), false, name);
      assert.equal(/isOpen/.test(source), true, name);
      assert.equal(/onOpenChange/.test(source), true, name);
    }
  });

  it('stops quick-reaction presses from bubbling into the sheet gesture', (): void => {
    const source = readFileSync(join(overlayDir, 'QuickReactionsRail.tsx'), 'utf8');
    assert.equal(
      (source.match(/onPressIn=\{\(event\): void => event\.stopPropagation\(\)\}/g) ?? []).length,
      2,
    );
    assert.equal((source.match(/onPress=\{\(event\)/g) ?? []).length, 2);
    assert.equal((source.match(/event\.stopPropagation\(\)/g) ?? []).length, 4);
  });

  it('does not call useUser until a profile target exists', (): void => {
    const source = readFileSync(join(overlayDir, 'UserProfileActionsHost.tsx'), 'utf8');
    const wrapper = source.split('function Mounted')[0] ?? source;
    assert.equal(/useUser\(/.test(wrapper), false);
    assert.equal(/if \(!target\)/.test(source), true);
  });
});

describe('row press wiring (no UI change)', (): void => {
  it('footer pills open the who-reacted sheet; the quick rail still toggles', (): void => {
    const footer = readFileSync(
      fileURLToPath(new URL('../rows/MessageRowReactions.tsx', import.meta.url)),
      'utf8',
    );
    const host = readFileSync(join(overlayDir, 'MessageActionsHost.tsx'), 'utf8');
    const helper = readFileSync(join(overlayDir, 'toggleReaction.ts'), 'utf8');
    assert.equal(/toggleReaction/.test(footer), false);
    assert.equal(/onOpen/.test(footer), true);
    assert.equal(/toggleReaction/.test(host), true);
    assert.equal(/mutators\.messages\.react/.test(helper), true);
  });

  it('mention and link presses reuse useMentionPress without restyling', (): void => {
    const body = readFileSync(
      fileURLToPath(new URL('../rows/MessageRowBody.tsx', import.meta.url)),
      'utf8',
    );
    const markdown = readFileSync(
      fileURLToPath(new URL('../rows/BlockMarkdown.tsx', import.meta.url)),
      'utf8',
    );
    const inline = readFileSync(
      fileURLToPath(new URL('../rows/InlineRichText.tsx', import.meta.url)),
      'utf8',
    );
    assert.equal(/useMentionPress/.test(body), true);
    assert.equal(/useMentionPress/.test(inline), true);
    assert.equal(/onLinkPress/.test(markdown), true);
    assert.equal(/font-semibold text-brand/.test(body), false);
    assert.equal(/font-medium text-brand/.test(body), false);
    assert.equal(/text-brand underline/.test(body), true);
    assert.equal(/resolveMentionColors/.test(body), true);
    assert.equal(/resolveMentionColors/.test(inline), true);
  });
});
