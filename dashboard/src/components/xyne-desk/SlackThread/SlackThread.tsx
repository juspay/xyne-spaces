import { ReactElement, useEffect, useMemo, useRef } from 'react';
import SlackMessage, { SlackEmailMessage } from './SlackMessage';

interface SlackThreadProps {
  emails: SlackEmailMessage[];
}

const SlackThread = ({ emails }: SlackThreadProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort oldest-first for chat-style display
  const sorted = useMemo(
    () => [...emails].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [emails],
  );

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
