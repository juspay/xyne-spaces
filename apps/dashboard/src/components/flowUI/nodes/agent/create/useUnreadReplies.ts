import { useEffect, useState } from 'react';

/**
 * Replies that came in while the chat was folded away, for the folded bar.
 * Opening the chat reads them; a new or cleared thread starts with none.
 */
export function useUnreadReplies(finishedReplies: number, open: boolean): number {
  const [read, setRead] = useState(finishedReplies);
  useEffect(() => {
    if (open || finishedReplies < read) setRead(finishedReplies);
  }, [open, finishedReplies, read]);
  return open ? 0 : Math.max(0, finishedReplies - read);
}
