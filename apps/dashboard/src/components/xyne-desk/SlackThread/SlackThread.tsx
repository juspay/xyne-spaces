import { ReactElement, useEffect, useMemo, useRef } from 'react';
import SlackMessage, { SlackEmailMessage } from './SlackMessage';
import { useMarkEmailRead } from '../../../hooks/useMarkEmailRead';
import { CallEntry, isCallEmailBody } from '../CallThread/CallThread';
import { PhoneDefault } from '@xyne/icons';

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
          <div key={email.id} id={`mail-${email.id}`} className='flex gap-3 px-4 py-3'>
            <div className='flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'>
              <PhoneDefault size={14} aria-hidden />
            </div>
            <div className='min-w-0 flex-1'>
              <CallEntry body={email.body} variant='compact' />
            </div>
          </div>
        ) : (
          <SlackMessage key={email.id} email={email} />
        ),
      )}
    </div>
  );
};

export default SlackThread;
