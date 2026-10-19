import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHAT_COMPOSER_FIELD_VERTICAL_PADDING,
  CHAT_COMPOSER_SURFACE_BOTTOM_GAP,
  CHAT_COMPOSER_SURFACE_TOP_PADDING,
  getChatComposerBottomPadding,
  getChatKeyboardGeometry as v2Geometry,
} from '@/src/features/chat/v2/chatKeyboardConfig';

import {
  CHAT_COMPOSER_FIELD_VERTICAL_PADDING as v3FieldVerticalPadding,
  CHAT_COMPOSER_SURFACE_BOTTOM_GAP as v3SurfaceBottomGap,
  CHAT_COMPOSER_SURFACE_TOP_PADDING as v3SurfaceTopPadding,
  getChatComposerBottomPadding as v3ComposerBottomPadding,
  getChatKeyboardGeometry,
} from '../composer/chatKeyboardConfig';

describe('§8.1 chatKeyboardConfig', (): void => {
  it('matches v2 geometry for the screen host (v3 has no embedded dock)', (): void => {
    assert.deepEqual(getChatKeyboardGeometry(24), v2Geometry(24));
  });

  it('clamps an invalid negative safe-area offset to zero', (): void => {
    assert.deepEqual(getChatKeyboardGeometry(-1), v2Geometry(-1));
  });

  it('falls back to zero for an unavailable safe-area offset', (): void => {
    assert.deepEqual(getChatKeyboardGeometry(Number.NaN), v2Geometry(Number.NaN));
  });

  it('keeps the shared composer spacing contract identical to v2', (): void => {
    assert.equal(v3FieldVerticalPadding, CHAT_COMPOSER_FIELD_VERTICAL_PADDING);
    assert.equal(v3SurfaceBottomGap, CHAT_COMPOSER_SURFACE_BOTTOM_GAP);
    assert.equal(v3SurfaceTopPadding, CHAT_COMPOSER_SURFACE_TOP_PADDING);
    assert.equal(v3ComposerBottomPadding(34, true), getChatComposerBottomPadding(34, true));
    assert.equal(v3ComposerBottomPadding(34, false), getChatComposerBottomPadding(34, false));
  });
});

describe('v3 composer send path (C14, B4)', (): void => {
  it('does not read connectivity on the v3 send path', (): void => {
    const dir = join(fileURLToPath(new URL('../composer', import.meta.url)));
    const files = readdirSync(dir).filter(name => name.endsWith('.ts') || name.endsWith('.tsx'));
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      assert.equal(/isOffline/.test(source), false, name);
      assert.equal(/isConnected/.test(source), false, name);
      assert.equal(/NetInfo/.test(source), false, name);
    }
  });

  it('does not early-return from send() when offline', (): void => {
    const path = join(
      fileURLToPath(
        new URL('../../../../components/input-composer/input-composer-root.tsx', import.meta.url),
      ),
    );
    const source = readFileSync(path, 'utf8');
    const sendStart = source.indexOf('const send = useCallback');
    const sendEnd = source.indexOf('const registerSendOverride');
    assert.ok(sendStart >= 0 && sendEnd > sendStart);
    const sendBody = source.slice(sendStart, sendEnd);
    assert.equal(/isOfflineRef\.current/.test(sendBody), false);
    const openScheduleStart = source.indexOf('const openSchedule = useCallback');
    const confirmStart = source.indexOf('const confirmSchedule = useCallback');
    assert.ok(openScheduleStart >= 0 && confirmStart > openScheduleStart);
    assert.equal(/isOfflineRef\.current/.test(source.slice(openScheduleStart, confirmStart)), true);
  });

  it('updates the original message for edit sessions and restores failed edits', (): void => {
    const host = readFileSync(
      join(fileURLToPath(new URL('../screens/ChatConversationView.tsx', import.meta.url))),
      'utf8',
    );
    assert.equal(/overlays\.editing/.test(host), true);
    assert.equal(/mutators\.messages\.update/.test(host), true);
    assert.equal(/subscribeMutationRestore/.test(host), true);
    assert.equal(/type: 'cancelEdit'/.test(host), true);
    const followTail = readFileSync(
      join(fileURLToPath(new URL('../composer/useSendAndFollowTail.ts', import.meta.url))),
      'utf8',
    );
    assert.equal(/if \(isEditing && !isAtTail\)/.test(followTail), true);
    assert.equal(
      /isAtTail: !showJumpToLatest/.test(
        readFileSync(
          join(fileURLToPath(new URL('../list/ConversationList.tsx', import.meta.url))),
          'utf8',
        ),
      ),
      true,
    );
  });
});

describe('v3 keyboard wiring', (): void => {
  it('uses the documented list and dock contracts', (): void => {
    const list = readFileSync(
      join(fileURLToPath(new URL('../list/ConversationList.tsx', import.meta.url))),
      'utf8',
    );
    const listDock = readFileSync(
      join(fileURLToPath(new URL('../list/ConversationListChrome.tsx', import.meta.url))),
      'utf8',
    );
    const sendAndFollow = readFileSync(
      join(fileURLToPath(new URL('../composer/useSendAndFollowTail.ts', import.meta.url))),
      'utf8',
    );
    assert.equal(/KeyboardGestureArea/.test(list), true);
    assert.equal(/useKeyboardScrollToEnd/.test(list), true);
    assert.equal(/scrollMessageToEnd/.test(list), true);
    assert.equal(/sendScrollToEndOptions/.test(sendAndFollow), true);
    assert.equal(/anchoredEndSpace/.test(list), false);
    assert.equal(/mode === 'follow-tail'/.test(list), false);
    assert.equal(/useComposerReserve/.test(list), true);
    assert.equal(/onComposerLayout/.test(list), true);
    const helpers = readFileSync(
      join(fileURLToPath(new URL('../list/conversationListHelpers.tsx', import.meta.url))),
      'utf8',
    );
    assert.equal(/cloneElement/.test(list + helpers), false);
    assert.equal(/bindMeasuredChild/.test(list + helpers), false);
    assert.equal(/onPaginate/.test(list), true);
    assert.equal(/ChatComposerDock/.test(list + listDock), true);
    assert.equal(/onDockSend/.test(list), false);
    assert.equal(/isValidElement\(children\)/.test(list), false);
    assert.equal(/keyboardOffset=\{keyboardGeometry.listOffset\}/.test(list), true);
    assert.equal(/contentInsetEndAdjustment=\{composerReserve\}/.test(list), true);
    assert.equal(/paddingBottom/.test(list), false);
    const send = readFileSync(
      join(fileURLToPath(new URL('../composer/sendScroll.ts', import.meta.url))),
      'utf8',
    );
    assert.equal(/CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND/.test(send), true);
    assert.equal(/closeKeyboard: CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND/.test(send), true);
    assert.equal(/closeKeyboard: true/.test(send), false);
    const dock = readFileSync(
      join(fileURLToPath(new URL('../composer/ChatComposerDock.tsx', import.meta.url))),
      'utf8',
    );
    assert.equal(/KeyboardStickyView/.test(dock), true);
    assert.equal(/composerRef/.test(dock), true);
    assert.equal(/key=\{conversationId\}/.test(dock), true);
    assert.equal(/onComposerLayout/.test(dock), true);
    const reserve = readFileSync(
      join(fileURLToPath(new URL('../composer/useComposerReserve.ts', import.meta.url))),
      'utf8',
    );
    assert.equal(/CHAT_COMPOSER_INITIAL_INSET_HEIGHT/.test(reserve), true);
    assert.equal(/initialHeight = 0/.test(reserve), false);
  });

  it('keeps shared composer consumers off the v2 keyboard module', (): void => {
    const consumerPaths = [
      '../../../../components/input-composer/conversation-input.tsx',
      '../../../../features/drafts-sent/edit-scheduled-message-composer.tsx',
      '../../../../features/xyne-desks/detail/components/email-tab/email-tab.tsx',
      '../../../../features/xyne-desks/detail/components/desk-chat-composer/desk-chat-composer.tsx',
    ];
    for (const relativePath of consumerPaths) {
      const source = readFileSync(
        join(fileURLToPath(new URL(relativePath, import.meta.url))),
        'utf8',
      );
      assert.equal(/features\/chat\/v2\/chatKeyboardConfig/.test(source), false);
      assert.equal(/features\/chat\/v3\/composer\/chatKeyboardConfig/.test(source), true);
    }
  });
});
