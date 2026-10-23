import { CallOrigin } from '@xyne/shared';

const MEET_LINK = /(?:https?:\/\/)?meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i;

/** Whether the text contains a Google Meet meeting link. */
export function looksLikeMeetLink(text: string): boolean {
  return MEET_LINK.test(text.trim());
}

type NotetakerCarrier = { callOrigin?: string | null; metadata?: unknown };

export function isMeetNotetakerCall(call: NotetakerCarrier | null | undefined): boolean {
  return call?.callOrigin === CallOrigin.MEET_LINK;
}

function meetBotOf(call: NotetakerCarrier): { status?: string; reason?: string } | null {
  const metadata = call.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const meetBot = (metadata as Record<string, unknown>)['meetBot'];
  return meetBot && typeof meetBot === 'object' ? (meetBot as { status?: string; reason?: string }) : null;
}

// Keyed by the reason codes the bot reports (snake_case).
const FAILURE_REASONS = new Map<string, string>([
  ['sso_failed', "the bot couldn't sign in to Google"],
  ['not_signed_in', "the bot couldn't sign in to Google"],
  ['blocked', 'Google blocked the bot'],
  ['denied', 'the host denied it'],
  ['not_admitted', 'nobody admitted it'],
  ['waiting_room_timeout', 'nobody admitted it'],
  ['meeting_not_found', "the meeting doesn't exist"],
  ['bot_busy', 'all bots were busy'],
  ['bot_unreachable', 'the bot is unavailable'],
  ['bot_restarted', 'the bot restarted'],
]);

/** One-line notetaker progress for a Meet notetaker call, or null for any other call. */
export function meetNotetakerStatusText(call: NotetakerCarrier | null | undefined): string | null {
  if (!call || !isMeetNotetakerCall(call)) return null;
  const meetBot = meetBotOf(call);
  switch (meetBot?.status) {
    case 'requested':
    case 'joining':
      return 'Xyne Automatic is joining…';
    case 'waiting_room':
      return 'Waiting to be admitted';
    case 'in_call':
      return 'Xyne Automatic is taking notes';
    case 'failed': {
      const reason = meetBot.reason ? FAILURE_REASONS.get(meetBot.reason) : undefined;
      return reason ? `Couldn't join: ${reason}` : "Xyne Automatic couldn't join";
    }
    case 'ended':
      return 'Notes taken by Xyne Automatic';
    default:
      return null;
  }
}
