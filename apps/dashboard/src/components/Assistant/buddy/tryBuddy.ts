import { toast } from 'sonner';
import { buddy } from './index';

export type BuddyOutcome = 'done' | 'stopped' | 'missed';

/** Lets Buddy act on a typed request: 'missed' when it is not for Buddy, 'stopped' when cancelled. */
export const tryBuddy = async (text: string): Promise<BuddyOutcome> => {
  const reply = await buddy.answer(text);
  if (reply === '') return 'stopped';
  const description = `You typed “${text}” · ${buddy.explain()}`;
  toast(reply ?? 'Sent to Ask AI', { description });
  return reply === null ? 'missed' : 'done';
};
