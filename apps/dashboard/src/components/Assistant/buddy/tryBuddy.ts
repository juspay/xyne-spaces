import { toast } from 'sonner';
import { VOICE_DEBUG_ENABLED } from '../../../services/VoiceInput/voiceDebug';
import { buddy } from './index';

export type BuddyOutcome = 'done' | 'stopped' | 'missed';

/** Lets Buddy act on a typed request: 'missed' when it is not for Buddy, 'stopped' when cancelled. */
export const tryBuddy = async (text: string): Promise<BuddyOutcome> => {
  const reply = await buddy.answer(text);
  if (reply === '') return 'stopped';
  if (reply === null) return 'missed';
  toast(reply, VOICE_DEBUG_ENABLED ? { description: buddy.explain() } : undefined);
  return 'done';
};
