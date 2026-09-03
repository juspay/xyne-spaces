import { ReactElement } from 'react';
import type { DailyBriefPayload } from '../../api/dailyBriefApi';

const PRE_CLASS =
  'overflow-x-auto whitespace-pre-wrap break-words rounded-[10px] border border-border ' +
  'bg-foreground/[0.03] p-4 font-mono text-[12px] leading-[1.6] text-foreground';

const HEADING_CLASS = 'mb-2 text-[13px] font-medium tracking-[-0.1px] text-muted-foreground';

interface RawBriefViewProps {
  date: string | undefined;
  status: string;
  content: string;
  data: DailyBriefPayload | null;
}

export function RawBriefView({ date, status, content, data }: RawBriefViewProps): ReactElement {
  return (
    <div className='flex w-full flex-col gap-6'>
      <p className='font-mono text-[12px] text-muted-foreground'>
        dateBucket={date ?? '—'} · status={status} · data=
        {data ? 'present' : 'null'} · content={content.length} chars
      </p>

      <section>
        <p className={HEADING_CLASS}>content — rendered markdown, citation tokens intact</p>
        <pre className={PRE_CLASS}>{content || '(empty)'}</pre>
      </section>

      <section>
        <p className={HEADING_CLASS}>data — the emit_brief payload</p>
        <pre className={PRE_CLASS}>
          {data ? JSON.stringify(data, null, 2) : '(no structured payload on this row)'}
        </pre>
      </section>
    </div>
  );
}
