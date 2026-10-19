import { toast } from 'sonner';
import { VOICE_DEBUG_ENABLED } from '../../../services/VoiceInput/voiceDebug';
import { buddy } from './index';

export type BuddyOutcome = 'done' | 'stopped' | 'missed';

/**
 * Lets Buddy act on a typed request: 'missed' when it is not for Buddy, 'stopped' when cancelled.
 * `onReply` gets what Buddy said; `quiet` leaves the saying to the caller (the chat), not a toast.
 */
export const tryBuddy = async (
  text: string,
  { onReply, quiet = false }: { onReply?: (reply: string) => void; quiet?: boolean } = {},
): Promise<BuddyOutcome> => {
  const reply = await buddy.answer(text);
  if (reply === '') return 'stopped';
  if (reply === null) return 'missed';
  if (!quiet) toast(reply, VOICE_DEBUG_ENABLED ? { description: buddy.explain() } : undefined);
  onReply?.(reply);
  return 'done';
};
