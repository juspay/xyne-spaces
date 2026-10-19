import type { ChatRouteTarget } from '@/src/notifications/types';

export function isChatNotificationIntent(
  intent: ChatRouteTarget | null,
): intent is ChatRouteTarget & { channelId: string } {
  return intent !== null && intent.ticketId === undefined && Boolean(intent.channelId);
}

function notificationIntentKey(intent: ChatRouteTarget): string {
  return [
    intent.channelId ?? '',
    intent.threadId ?? '',
    intent.messageId ?? '',
    intent.notificationId ?? '',
  ].join('|');
}

export type NotificationIntentStartGate = {
  claim(intent: ChatRouteTarget): number;
  isCurrent(token: number, current: ChatRouteTarget | null): boolean;
};

/**
 * Only the latest notification tap may start a journey. Clock reads are async,
 * so an older tap can resume after a newer one and must be dropped.
 */
export function createNotificationIntentStartGate(): NotificationIntentStartGate {
  let generation = 0;
  let claimedKey = '';

  return {
    claim(intent): number {
      generation += 1;
      claimedKey = notificationIntentKey(intent);
      return generation;
    },
    isCurrent(token, current): boolean {
      if (token !== generation) {
        return false;
      }

      // Navigation consumes the intent during the clock read. Null still
      // belongs to this tap. A different live intent belongs to a newer tap.
      if (current === null) {
        return true;
      }

      if (!isChatNotificationIntent(current)) {
        return false;
      }

      return notificationIntentKey(current) === claimedKey;
    },
  };
}

/**
 * Claim this tap, wait for the clock, then commit only if it is still the
 * latest intent.
 */
export async function runLatestNotificationIntentStart<T>(input: {
  gate: NotificationIntentStartGate;
  intent: ChatRouteTarget;
  getCurrentIntent: () => ChatRouteTarget | null;
  prepare: () => Promise<T | null>;
  commit: (prepared: T) => void;
}): Promise<boolean> {
  const token = input.gate.claim(input.intent);
  const prepared = await input.prepare();
  if (!input.gate.isCurrent(token, input.getCurrentIntent())) {
    return false;
  }
  if (prepared === null) {
    return false;
  }

  input.commit(prepared);
  return true;
}
