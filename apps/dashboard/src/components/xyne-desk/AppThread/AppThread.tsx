import { ReactElement, useMemo } from 'react';
import { useMarkEmailRead } from '../../../hooks/useMarkEmailRead';
import { AppMessageGroup, type AppDeskMessage } from './AppMessageGroup';

interface AppThreadProps {
  messages: AppDeskMessage[];
  ticketId?: string | null | undefined;
}

const GROUP_WINDOW_MS = 10 * 60 * 1000;

const isOutbound = (message: AppDeskMessage): boolean => message.type !== 'DEFAULT';

const senderKey = (message: AppDeskMessage): string =>
  `${message.sentByUserId ?? ''}|${message.from ?? ''}`;

const dayKey = (ms: number): string => new Date(ms).toDateString();

function dayLabel(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const sameYear = date.getFullYear() === today.getFullYear();
  return date
    .toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    })
    .toUpperCase();
}

type ThreadRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'group'; key: string; outbound: boolean; messages: AppDeskMessage[] };

function buildRows(messages: AppDeskMessage[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let current: Extract<ThreadRow, { kind: 'group' }> | null = null;
  let currentDay = '';
  let lastAt = 0;

  for (const message of messages) {
    const at = message.createdAt ?? 0;
    const day = dayKey(at);
    if (day !== currentDay) {
      currentDay = day;
      current = null;
      rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(at) });
    }

    const continues =
      current !== null &&
      current.outbound === isOutbound(message) &&
      senderKey(current.messages[0]!) === senderKey(message) &&
      at - lastAt <= GROUP_WINDOW_MS;

    if (continues && current) {
      current.messages.push(message);
    } else {
      current = {
        kind: 'group',
        key: `group-${message.id}`,
        outbound: isOutbound(message),
        messages: [message],
      };
      rows.push(current);
    }
    lastAt = at;
  }

  return rows;
}

const AppThread = ({ messages, ticketId }: AppThreadProps): ReactElement => {
  const sorted = useMemo(
    () => [...messages].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [messages],
  );
  const rows = useMemo(() => buildRows(sorted), [sorted]);

  useMarkEmailRead(ticketId, sorted[sorted.length - 1]?.id ?? null, true);

  return (
    <div className='flex flex-col gap-7 px-4 py-6'>
      {rows.map(row =>
        row.kind === 'day' ? (
          <div key={row.key} className='flex items-center gap-4' role='separator'>
            <span className='h-px flex-1 bg-border' />
            <span className='font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground'>
              {row.label}
            </span>
            <span className='h-px flex-1 bg-border' />
          </div>
        ) : (
          <AppMessageGroup key={row.key} messages={row.messages} outbound={row.outbound} />
        ),
      )}
    </div>
  );
};

export default AppThread;
