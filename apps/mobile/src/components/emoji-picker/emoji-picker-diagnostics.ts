import { Event, logger } from '@/src/utils/logger';

let nextTraceId = 0;

export function createEmojiPickerTraceId(): string {
  nextTraceId += 1;
  return `emoji-picker-${Date.now()}-${nextTraceId}`;
}

export function logEmojiPickerDiagnostic(
  traceId: string,
  stage: string,
  details: Record<string, unknown> = {},
): void {
  if (!__DEV__) return;

  logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
    diagnostic: 'emoji_picker',
    traceId,
    stage,
    atMs: Date.now(),
    ...details,
  });
}
