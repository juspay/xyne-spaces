import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHAT_LIST_INITIAL_ITEM_SIZE,
  CHAT_PAINT_COLLAPSE_VIEWPORT_HEIGHT_PX,
  CHAT_PAINT_DEFAULT_MEDIA_ASPECT_RATIO,
  CHAT_PAINT_INLINE_EMOJI_RESERVED_WIDTH_PX,
  CHAT_PAINT_MEDIA_GRID_HEIGHT_PX,
  CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX,
  CHAT_PAINT_REACTION_SLOT_HEIGHT_PX,
  CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX,
  getDateRowEstimatedHeight,
  getUnreadDividerRowHeight,
} from '../../v2/paint/chatPaintSizing';
import {
  COLLAPSE_VIEWPORT_HEIGHT_PX,
  INLINE_EMOJI_RESERVED_WIDTH_PX,
  TEXT_CONTAINER_WIDTH_PX,
} from '../model/buildBody';
import { DEFAULT_MEDIA_ASPECT_RATIO, MEDIA_GRID_HEIGHT_PX } from '../model/buildMedia';
import { PARENT_PREVIEW_HEIGHT_PX } from '../model/buildPreviews';
import { ESTIMATED_ROW_HEIGHT } from '../list/legendListProps';
import {
  DATE_ROW_HEIGHT,
  INLINE_EMOJI_ROW_HEIGHT,
  MEDIA_ROW_HEIGHT,
  MESSAGE_CHROME_HEIGHT,
  MESSAGE_REPLY_HEIGHT,
  MESSAGE_SENDER_HEIGHT,
  MESSAGE_TICKET_HEIGHT,
  REACTION_ROW_HEIGHT,
  SHORT_MESSAGE_HEIGHT,
  SYSTEM_CHROME_HEIGHT,
  SYSTEM_ROW_HEIGHT,
  TICKET_ROW_HEIGHT,
  UNREAD_DIVIDER_HEIGHT,
} from '../model/measureRowHeight';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('v3 paint sizing vs v2 (P2 characterisation)', (): void => {
  it('pins overlapping height constants to v2 chatPaintSizing', (): void => {
    assert.equal(DATE_ROW_HEIGHT, getDateRowEstimatedHeight());
    assert.equal(UNREAD_DIVIDER_HEIGHT, getUnreadDividerRowHeight());
    assert.equal(SHORT_MESSAGE_HEIGHT, CHAT_LIST_INITIAL_ITEM_SIZE);
    assert.equal(ESTIMATED_ROW_HEIGHT, CHAT_LIST_INITIAL_ITEM_SIZE);
    assert.equal(TEXT_CONTAINER_WIDTH_PX, CHAT_PAINT_TEXT_CONTAINER_WIDTH_PX);
    assert.equal(COLLAPSE_VIEWPORT_HEIGHT_PX, CHAT_PAINT_COLLAPSE_VIEWPORT_HEIGHT_PX);
    assert.equal(INLINE_EMOJI_RESERVED_WIDTH_PX, CHAT_PAINT_INLINE_EMOJI_RESERVED_WIDTH_PX);
    assert.equal(PARENT_PREVIEW_HEIGHT_PX, CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX);
    assert.equal(REACTION_ROW_HEIGHT, CHAT_PAINT_REACTION_SLOT_HEIGHT_PX);
    assert.equal(DEFAULT_MEDIA_ASPECT_RATIO, CHAT_PAINT_DEFAULT_MEDIA_ASPECT_RATIO);
    assert.equal(MEDIA_GRID_HEIGHT_PX, CHAT_PAINT_MEDIA_GRID_HEIGHT_PX);
    assert.equal(SYSTEM_ROW_HEIGHT, 56);
    assert.equal(SYSTEM_CHROME_HEIGHT, 52);
    assert.equal(TICKET_ROW_HEIGHT, 228);
    assert.equal(MEDIA_ROW_HEIGHT, 220);
    assert.equal(MESSAGE_CHROME_HEIGHT, 52);
    assert.equal(MESSAGE_SENDER_HEIGHT, 26);
    assert.equal(MESSAGE_REPLY_HEIGHT, 34);
    assert.equal(MESSAGE_TICKET_HEIGHT, 176);
    assert.equal(INLINE_EMOJI_ROW_HEIGHT, 26);
  });

  it('keeps v2 row anatomy: avatar sibling, name inside bubble, 24px avatar', (): void => {
    const row = read('../rows/MessageRow.tsx');
    const avatar = read('../rows/MessageRowAvatar.tsx');
    assert.equal(/flex-row items-end gap-2/.test(row), true);
    assert.equal(/className={`py-1 flex-row items-end gap-2/.test(row), true);
    assert.equal(/maxWidth: tokens\.inlineContentMaxWidth/.test(row), true);
    assert.equal(/max-w-\[78%\]/.test(row), false);
    assert.equal(/SenderNameLabel/.test(row), true);
    assert.equal(/MessageRowHeader/.test(row), false);
    assert.equal(/AVATAR_SIZE = 24/.test(avatar), true);
    assert.equal(/h-6 w-6/.test(avatar), true);
  });

  it('uses the v2 ConversationSkeleton on bg-chat-screen, once', (): void => {
    const skeleton = read('../list/ListSkeleton.tsx');
    const list = read('../list/ConversationList.tsx');
    const cover = read('../list/ConversationListChrome.tsx');
    assert.equal(/ConversationSkeleton/.test(skeleton), true);
    assert.equal(/bg-chat-screen/.test(skeleton), true);
    assert.equal(/bg-muted/.test(skeleton), false);
    assert.equal(/open-placeholder-/.test(skeleton), true);
    assert.equal(/skeletonCount=\{surface\.kind === 'channel' \? 4 : 5\}/.test(list), true);
    assert.equal(/showSkeleton=\{showSkeleton\}/.test(list), true);
    assert.equal(/composerReserve=\{composerReserve\}/.test(list), true);
    assert.equal(/style=\{\{ bottom \}\}/.test(cover), true);
    assert.equal(/absolute inset-0/.test(cover), false);
    assert.equal(/paddingBottom/.test(cover), false);
    assert.equal(/bg-muted/.test(list + cover), false);
  });

  it('shows a compact older-page shimmer in the list header', (): void => {
    const list = read('../list/ConversationList.tsx');
    const shimmer = read('../list/useOlderPageShimmer.ts');
    assert.equal(/ListHeaderComponent: ConversationSkeleton/.test(list), true);
    assert.equal(/useOlderPageShimmer/.test(list), true);
    assert.equal(/CLEAR_MS/.test(shimmer), false);
    assert.equal(/setTimeout/.test(shimmer), false);
    assert.equal(/useEffect/.test(shimmer), false);
    assert.equal(
      /hasReachedStart=\{window.hasReachedStart\}/.test(
        read('../screens/ChatConversationView.tsx'),
      ),
      true,
    );
  });
});
