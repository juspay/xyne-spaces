import {
  createDateSeparatorObservationRecorder,
  type DateSeparatorObservationRecorder,
  type DateSeparatorSurface,
} from '@/src/observability/logging/chat/emitChatDateSeparatorObserved';

import type { OpenSurface } from '../intent/openIntent.types';

type DateSeparatorKind = 'inline' | 'floating';

type DateSeparatorSession = {
  key: string;
  channelId: string;
  conversationId: string | null;
  kind: 'channel' | 'thread';
  screenWidthDp: number;
  fontScale: number;
  didUserScroll: () => boolean;
};

const recorder: DateSeparatorObservationRecorder = createDateSeparatorObservationRecorder();
let session: DateSeparatorSession | null = null;

const surfaceFor = (kind: DateSeparatorKind): DateSeparatorSurface => {
  const thread = session?.kind === 'thread';
  if (kind === 'floating') return thread ? 'thread-floating' : 'channel-floating';
  return thread ? 'thread-inline' : 'channel-inline';
};

/** Fresh recorder window when the open identity changes, before rows layout. */
export const bindDateSeparatorSession = (next: DateSeparatorSession): void => {
  if (session?.key !== next.key) {
    recorder.reset();
  }
  session = next;
};

export const dateSeparatorSessionKey = (surface: OpenSurface, intentKey: string): string => {
  const threadId = surface.kind === 'channel' ? '' : surface.threadId;
  return `${intentKey}:${surface.channelId}:${threadId}`;
};

export const recordDateSeparatorLayout = (
  kind: DateSeparatorKind,
  boundaryId: string | null,
  createdAtMs: number,
  formattedLabel: string,
  layout: { width: number; height: number },
): void => {
  if (!session) return;
  recorder.record({
    surface: surfaceFor(kind),
    phase: session.didUserScroll() ? 'interaction' : 'initial-open',
    channelId: session.channelId,
    conversationId: session.conversationId,
    boundaryId,
    createdAtMs,
    formattedLabel,
    layout,
    screenWidthDp: session.screenWidthDp,
    fontScale: session.fontScale,
  });
};
