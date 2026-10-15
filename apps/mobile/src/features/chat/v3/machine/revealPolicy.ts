import type { OpenIntent } from '../intent/openIntent.types';
import type { ResolvedLocation } from '../intent/resolvedLocation';
import { landingKeyForLocation } from '../intent/resolvedLocation';
import type { LandingTarget, ListMetrics } from './openState';

export const landingTargetFrom = (location: ResolvedLocation): LandingTarget => {
  if (location.anchor) {
    return {
      kind: 'anchor',
      conversationId: location.anchor.conversationId,
      messageId: location.anchor.messageId,
      createdAt: location.anchor.createdAt,
    };
  }
  return { kind: 'tail' };
};

/** Conversation to land around after resolution — never a parent timestamp. */
export const landingConversationIdFor = (intent: OpenIntent): string | undefined =>
  intent.hint.conversationId ?? intent.hint.threadId;

/**
 * Hint-only location for tests, pre-resolve keys, and a read-channel tail
 * open that must not wait on `resolveLocation` to pack at the last message.
 */
export const locationFromHint = (intent: OpenIntent): ResolvedLocation => {
  const messageId = intent.hint.messageId;
  const unreadAt = intent.hint.unreadBoundaryAt;
  return {
    surface: intent.surface,
    anchor: messageId
      ? {
          conversationId: landingConversationIdFor(intent) ?? messageId,
          messageId,
          createdAt: 0,
        }
      : null,
    unreadBoundary:
      unreadAt === undefined
        ? null
        : {
            at: unreadAt,
            ...(intent.hint.unreadBoundaryConversationId !== undefined
              ? { conversationId: intent.hint.unreadBoundaryConversationId }
              : {}),
          },
  };
};

export const classifyOpen = (intent: OpenIntent): LandingTarget =>
  landingTargetFrom(locationFromHint(intent));

/** Tail is on the hint. Thread identity is too. Channel anchors need the message query. */
export const canLandFromHint = (intent: OpenIntent): boolean =>
  classifyOpen(intent).kind !== 'anchor' || intent.surface.kind !== 'channel';

export const resolvedLocationForOpen = (
  intent: OpenIntent,
  location: { ok: true; value: ResolvedLocation } | { ok: false } | null,
): ResolvedLocation | null => {
  if (location?.ok === true) {
    return location.value;
  }
  return canLandFromHint(intent) ? locationFromHint(intent) : null;
};

/**
 * A named message must not become a tail pack.
 */
export const isWeakerLanding = (current: LandingTarget, next: LandingTarget): boolean =>
  current.kind === 'anchor' && next.kind === 'tail';

export const landingKeyFor = (intent: OpenIntent, location?: ResolvedLocation | null): string => {
  if (location) {
    return landingKeyForLocation(location);
  }
  if (intent.hint.conversationId && !intent.hint.threadId && !intent.hint.messageId) {
    return `anchor:${intent.hint.conversationId}:pending`;
  }
  return landingKeyForLocation(locationFromHint(intent));
};

export const isLandingConfirmed = (_target: LandingTarget, metrics: ListMetrics): boolean =>
  metrics.targetPlaced;
