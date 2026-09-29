import { ReactElement, useEffect, useMemo, useRef } from 'react';
import SlackMessage, { SlackEmailMessage } from './SlackMessage';
import { useMarkEmailRead } from '../../../hooks/useMarkEmailRead';
import { CallEmailRow, isCallEmailBody } from '../CallThread/CallThread';

interface SlackThreadProps {
  emails: SlackEmailMessage[];
  ticketId?: string | null | undefined;
}

const SlackThread = ({ emails, ticketId }: SlackThreadProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort oldest-first for chat-style display
  const sorted = useMemo(
    () => [...emails].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [emails],
  );

  // Thread-level: upsert the current user's email_reads row on open, same as
  // EmailThread. Newest message is last in the oldest-first sorted list.
  const latestEmailId = sorted[sorted.length - 1]?.id ?? null;
  useMarkEmailRead(ticketId, latestEmailId, true);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sorted.length]);

  return (
    <div ref={containerRef} className='divide-y divide-border overflow-y-auto'>
      {sorted.map(email =>
        // Call records are JSON that SlackMessage would print raw; same row layout, phone as avatar.
        isCallEmailBody(email.body) ? (
          <CallEmailRow
            key={email.id}
            emailId={email.id}
            body={email.body}
            ticketId={ticketId}
            attachments={email.attachments}
            className='px-4 py-3'
          />
        ) : (
          <SlackMessage key={email.id} email={email} />
        ),
      )}
    </div>
  );
};

export default SlackThread;
