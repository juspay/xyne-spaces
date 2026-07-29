import { ReactElement, useEffect, useMemo, useRef } from 'react';
import SlackMessage, { SlackEmailMessage } from './SlackMessage';
import { useMarkEmailRead } from '../../../hooks/useMarkEmailRead';

interface SlackThreadProps {
  emails: SlackEmailMessage[];
  ticketId?: string | null | undefined;
  lastEmailAt?: number | null | undefined;
  emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }> | undefined;
}

const SlackThread = ({
  emails,
  ticketId,
  lastEmailAt,
  emailReads,
}: SlackThreadProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort oldest-first for chat-style display
  const sorted = useMemo(
    () => [...emails].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [emails],
  );

  // Thread-level: upsert the current user's email_reads row on open, same as
  // EmailThread. Newest message is last in the oldest-first sorted list.
  const latestEmailId = sorted[sorted.length - 1]?.id ?? null;
  useMarkEmailRead(ticketId, latestEmailId, lastEmailAt ?? null, emailReads, true);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sorted.length]);

  return (
    <div ref={containerRef} className='divide-y divide-border overflow-y-auto'>
      {sorted.map(email => (
        <SlackMessage key={email.id} email={email} />
      ))}
    </div>
  );
};

export default SlackThread;
