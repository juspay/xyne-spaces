import assert from 'node:assert/strict';

import { listChromeFor } from '../list/listChrome';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseOpenIntent } from '../intent/parseOpenIntent';
import { ticketThreadRaw } from '../screens/searchParams';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('v3 screens (Phase 9)', (): void => {
  it('channel and thread screens host ChatConversation, not v2', (): void => {
    const channel = read('../screens/ChatChannelScreen.tsx');
    const thread = read('../screens/ChatThreadScreen.tsx');
    assert.equal(/ChatConversation/.test(channel), true);
    assert.equal(/ChatConversation/.test(thread), true);
    assert.equal(/features\/chat\/v2/.test(channel), false);
    assert.equal(/features\/chat\/v2/.test(thread), false);
    assert.equal(/ChatV3Marker/.test(channel), false);
    assert.equal(/ChatV3Marker/.test(thread), false);
  });

  it('keeps the v2 chat-screen background and header spacer', (): void => {
    const channel = read('../screens/ChatChannelScreen.tsx');
    const thread = read('../screens/ChatThreadScreen.tsx');
    const host =
      read('../screens/ChatConversation.tsx') + read('../screens/ChatConversationView.tsx');
    assert.equal(/bg-chat-screen/.test(channel), true);
    assert.equal(/bg-chat-screen/.test(thread), true);
    assert.equal(/bg-chat-screen/.test(host), true);
    assert.equal(/getChatHeaderCollapsedHeight/.test(channel), true);
    assert.equal(/getThreadHeaderCollapsedHeight/.test(thread), true);
  });

  it('ChatConversation wires list + dock + overlays and does not use extraData', (): void => {
    const host =
      read('../screens/ChatConversation.tsx') + read('../screens/ChatConversationView.tsx');
    assert.equal(/ConversationList/.test(host), true);
    assert.equal(/ChatComposerDock/.test(host), false);
    assert.equal(/composer=\{/.test(host), true);
    assert.equal(/onPaginate/.test(host), true);
    assert.equal(/onRowEvent/.test(host), true);
    assert.equal(/onListEvent/.test(host), true);
    assert.equal(/onDockSend/.test(host), false);
    assert.equal(/ChatOverlays/.test(host), true);
    assert.equal(/onSend\(/.test(host), true);
    assert.equal(/extraData/.test(host), false);
    assert.equal(/inverted/.test(host), false);
    assert.equal(/features\/chat\/v2/.test(host), false);
  });

  it('acquires scoped chat-open deferral from the screen session (B9)', (): void => {
    const open = read('../screens/useChatOpen.ts');
    assert.equal(/acquireDeferral/.test(open), true);
    assert.equal(/token\.release\(\)/.test(open), true);
    assert.equal(/interactionCriticalWindow/.test(open), false);
    assert.equal(/warmWindowAction/.test(open), true);
    assert.equal(/dataFactsChanged/.test(open), true);
    assert.equal(/useChatOpenWindow/.test(open), true);
    assert.equal(/status === 'error'/.test(open), true);
    assert.equal(/factsSeen\.current = null/.test(open), true);
    assert.equal(/status !== 'loading'/.test(open), true);
  });

  it('ticket-thread params parse as a ticket-thread surface', (): void => {
    const parsed = parseOpenIntent(
      ticketThreadRaw({
        channelId: 'ch-1',
        threadId: 'th-1',
        ticketId: 't-1',
        messageId: 'm-9',
      }),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.value.surface.kind, 'ticket-thread');
    if (parsed.value.surface.kind === 'ticket-thread') {
      assert.equal(parsed.value.surface.ticketId, 't-1');
    }
  });

  it('wires avatar press into the profile overlay host', (): void => {
    const host =
      read('../screens/ChatConversation.tsx') + read('../screens/ChatConversationView.tsx');
    const overlays = read('../screens/ChatOverlays.tsx');
    assert.equal(/onRowEvent/.test(host), true);
    assert.equal(/openProfile/.test(host), true);
    assert.equal(/UserProfileActionsHost/.test(overlays), true);
    assert.equal(/target=\{profile\}/.test(overlays), true);
  });

  it('keeps the v2 long-press haptic at the V3 action owner', (): void => {
    const host = read('../screens/ChatConversationView.tsx');
    assert.equal(/haptics\.longPress\(\)/.test(host), true);
    assert.equal(
      /if \(shouldShowJoinChannel\)[\s\S]*?if \(longPressPendingRef\.current\)/.test(host),
      true,
    );
  });
});

describe('open-path wiring after review', (): void => {
  it('dispatches landingConfirmed and userTookOwnership from the conversation host', (): void => {
    const host =
      read('../screens/ChatConversation.tsx') + read('../screens/ChatConversationView.tsx');
    const list = read('../list/ConversationList.tsx');
    assert.equal(/landingConfirmed/.test(host), true);
    assert.equal(/userTookOwnership/.test(host), true);
    assert.equal(/channelThreadOpen/.test(host), true);
    assert.equal(
      /row\.model\.messageId \? \{ messageId: row\.model\.messageId \}/.test(host),
      false,
    );
    assert.equal(/onListEvent/.test(host), true);
    assert.equal(/onRowEvent/.test(host), true);
    assert.equal(/onLoad=\{onListLoad\}/.test(list), true);
    assert.equal(/useListLayoutReadiness/.test(list), true);
    assert.equal(/target \?/.test(list), true);
    assert.equal(/canMountConversationList/.test(list), true);
    assert.equal(/listReadyToMount/.test(list), true);
    assert.equal(/target\?\.kind === 'tail' && surface\.kind === 'channel'/.test(list), true);
    assert.equal(/aroundCursorFor/.test(host), true);
    assert.equal(
      /surface\.kind === 'channel' &&\s*session\.target\.kind === 'anchor' &&\s*aroundCursor <= 0/.test(
        host,
      ),
      true,
    );
    assert.equal(/EMPTY_WINDOW/.test(host), true);
    assert.equal(/ChatConversationSubscribed/.test(host), true);
  });

  it('keeps ChatConversation mounted on activity wait; skeleton is ticket-redirect only', (): void => {
    const thread = read('../screens/ChatThreadScreen.tsx');
    const gate = read('../screens/useThreadSurfaceGate.ts');
    assert.equal(/ticketRedirect && !isResolverHost/.test(thread), true);
    assert.equal(/shouldWaitForSurface/.test(thread + gate), false);
    assert.equal(/shouldWaitForSurface/.test(gate), false);
    assert.equal(/ListSkeleton/.test(thread), true);
    assert.equal(/ChatConversation/.test(thread), true);
  });

  it('passes call transcript mode through the V3 thread screen', (): void => {
    const thread = read('../screens/ChatThreadScreen.tsx');
    const gate = read('../screens/useThreadSurfaceGate.ts');
    const conversation = read('../screens/ChatConversation.tsx');
    const view = read('../screens/ChatConversationView.tsx');
    assert.equal(/params\['isTranscript'\]/.test(gate), true);
    assert.equal(/isTranscript/.test(gate), true);
    assert.equal(/isTranscript=\{isTranscript\}/.test(thread), true);
    assert.equal(/CallTranscriptCard/.test(view), true);
    assert.equal(/callThreadMeta/.test(view), true);
    assert.equal(/callContentFor\(call, firstMessage\.model\.body\)/.test(view), true);
    assert.equal(/isTranscript/.test(conversation), true);
  });

  it('applies surfaceRemountKey on TicketThreadPane', (): void => {
    const pane = read('../screens/TicketThreadPane.tsx');
    assert.equal(/surfaceRemountKey/.test(pane), true);
    assert.equal(/key=\{surfaceRemountKey\(parsed\.value\)\}/.test(pane), true);
    assert.equal(/useOpenIntent/.test(pane), true);
  });

  it('hydrates the persisted window and records warm/live telemetry from the open session', (): void => {
    const open = read('../screens/useChatOpen.ts');
    const trace = read('../observability/openTrace.ts');
    const warm = read('../observability/warmTelemetry.ts');
    assert.equal(/hydratePersistedWindow/.test(open), true);
    assert.equal(/landingKeyForLocation/.test(open), true);
    assert.equal(/reanchor/.test(open), true);
    assert.equal(/status === 'idle'/.test(open), true);
    assert.equal(/status === 'resolving'/.test(open), true);
    assert.equal(/classifyOpen/.test(open), true);
    assert.equal(/resolvedLocationForOpen/.test(open), true);
    assert.equal(/isWeakerLanding/.test(open), true);
    assert.equal(/dataFactsChanged/.test(open), true);
    assert.equal(/recordTransition/.test(open), true);
    assert.equal(/recordWarmDecision/.test(open), true);
    assert.equal(/useOpenTrace/.test(open), false);
    assert.equal((open.match(/\buseEffect\(/g) ?? []).length, 4);
    assert.equal(/recordWarmDecision/.test(trace), true);
    assert.equal(/recordInbound/.test(trace), true);
    assert.equal(/recordLiveSupersede/.test(warm), true);
    assert.equal(/recordStoreBytes/.test(warm), true);
  });

  it('ConversationList keeps the eight-prop contract', (): void => {
    const list = read('../list/conversationList.types.ts');
    const block = list.match(/export type ConversationListProps = \{([^}]+)\}/);
    assert.ok(block);
    const keys = (block[1] ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^[A-Za-z]+:/.test(line));
    assert.equal(keys.length, 8);
  });

  it('ConversationList shows shimmer only with zero rows and waits for native layout', (): void => {
    // Behavioural, not a source regex: the rule lives in `listChromeFor`.
    assert.equal(listChromeFor('loading', 0, false).showSkeleton, true);
    assert.equal(listChromeFor('placing', 3, false).showSkeleton, true, 'rows but not visible');
    assert.equal(listChromeFor('placing', 3, true).showSkeleton, false, 'visible -> rows show');
    assert.equal(listChromeFor('ready', 3, false).showSkeleton, true, 'ready is not paint');
    assert.equal(listChromeFor('ready', 3, true).showSkeleton, false);
    assert.equal(listChromeFor('error', 0, false).showSkeleton, false, 'error owns the surface');
    assert.equal(listChromeFor('ready', 0, true).showEmpty, true);
    assert.equal(listChromeFor('loading', 0, false).showEmpty, false, 'never empty while loading');
  });

  it('remembers the last-open channel from both channel and thread screens', (): void => {
    const channel = read('../screens/ChatChannelScreen.tsx');
    const thread = read('../screens/ChatThreadScreen.tsx');
    const gate = read('../screens/useThreadSurfaceGate.ts');
    const openIntent = read('../screens/useOpenIntent.ts');
    assert.equal(/useRememberLastOpenChannel/.test(channel), true);
    assert.equal(/useReadCursor/.test(channel), true);
    assert.equal(/useReleaseChatOpen/.test(channel), true);
    assert.equal(/useReleaseChatOpen/.test(thread), true);
    assert.equal(/unreadBoundaryConversationId/.test(read('../screens/useChatRows.ts')), true);
    assert.equal(/useRememberLastOpenChannel/.test(gate), true);
    assert.equal(/useOpenIntent/.test(channel), true);
    assert.equal(/useOpenIntent/.test(gate), true);
    assert.equal(/useResolveLocation/.test(channel), true);
    assert.equal(
      (read('../screens/useResolveLocation.ts').match(/\buseEffect\(/g) ?? []).length,
      1,
    );
    assert.equal(/useResolveOpenCursor/.test(channel), false);
    assert.equal(/useResolveOpenCursor/.test(thread), false);
    assert.equal(/getMessageForActivityV2/.test(openIntent), false);
    assert.equal(/getConversationById/.test(openIntent), false);
    const deeplink = readFileSync(
      fileURLToPath(new URL('../../../../../app/(protected)/chat-deeplink.tsx', import.meta.url)),
      'utf8',
    );
    assert.equal(/hasResolvedNotificationCursor/.test(deeplink), false);
    assert.equal(
      /cachedLocation\s*\|\|\s*resolvedInPlaceRef\.current\s*\|\|\s*hasStableNotificationThread/.test(
        deeplink,
      ),
      true,
    );
    assert.equal(/useV3\s*\?\s*hasResolvedNotificationCursor/.test(deeplink), false);
    assert.equal(/function ChatDeeplinkV3/.test(deeplink), true);
    const v3Host = deeplink.slice(
      deeplink.indexOf('function ChatDeeplinkV3'),
      deeplink.indexOf('export default'),
    );
    assert.equal(/resolveChatLink/.test(v3Host), false);
  });
});

describe('TicketDetailsScreen Phase 9a', (): void => {
  it('hosts TicketThreadPane behind the same flag', (): void => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../screens/TicketDetailsScreen.tsx', import.meta.url)),
      'utf8',
    );
    assert.equal(/isChatV3Enabled/.test(source), true);
    assert.equal(/TicketThreadPane/.test(source), true);
    assert.equal(/useRef\(isChatV3Enabled\(\)\)/.test(source), true);
  });
});

describe('chat v3 flag (safe rollout)', (): void => {
  it('reads the CAC-controlled registry flag, which defaults off', (): void => {
    const source = read('../flag.ts');
    assert.equal(/isFlagOn\('chat\.v3'\)/.test(source), true);
    // No local storage key: a stored value must not bypass CAC.
    assert.equal(/getBoolean|setBoolean/.test(source), false);

    const registry = read('../../../../flags/registry.ts');
    assert.equal(/'chat\.v3': \{[^}]*default: false/s.test(registry), true);
  });
});
