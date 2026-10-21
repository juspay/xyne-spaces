import {
  extractTicketRouteTarget,
  normalizeData,
  readNotificationType,
} from './message/messageContext';

function mergeJsonOrObject(target: Record<string, unknown>, raw: unknown): void {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.assign(target, raw as Record<string, unknown>);
    return;
  }
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(target, parsed as Record<string, unknown>);
    }
  } catch {
    // Wrapper leftovers from Bundle.toString() are ignored.
  }
}

function mergeLaunchIntentDataBlob(extras: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const key of ['data', 'payload']) {
    mergeJsonOrObject(merged, extras[key]);
  }
  return { ...merged, ...extras };
}

/** Android tray taps put the payload on MainActivity extras. Call launches are ignored. */
export function launchIntentExtrasToNavData(
  extras: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (extras == null || typeof extras !== 'object') {
    return null;
  }

  const callAction = extras['callAction'];
  const callId = extras['callId'];
  if (
    (typeof callAction === 'string' && callAction.trim().length > 0) ||
    (typeof callId === 'string' && callId.trim().length > 0)
  ) {
    return null;
  }

  const data = normalizeData(mergeLaunchIntentDataBlob(extras));
  if (!readNotificationType(data) && !extractTicketRouteTarget(data)) {
    return null;
  }

  return data;
}
