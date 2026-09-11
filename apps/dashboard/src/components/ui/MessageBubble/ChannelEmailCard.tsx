import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Mail } from 'lucide-react';
import { EmailBodyRenderer } from '../../xyne-desk/EmailBody/EmailBodyRenderer';
import { parseFromField } from '../../xyne-desk/EmailComposer/helpers';

interface ChannelEmailCardProps {
  subject: string;
  from: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  body: string;
  emailId: string;
  attachments?: ReadonlyArray<{
    id: string;
    metadata?: unknown;
    mimetype?: string | null;
    originalFilename?: string | null;
    size?: number | null;
  }>;
}

const HeaderRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='grid grid-cols-[68px_1fr] gap-2 text-sm leading-5'>
    <div className='font-semibold text-foreground'>{label}</div>
    <div className='text-muted-foreground break-all'>{value}</div>
  </div>
);

export const ChannelEmailCard: React.FC<ChannelEmailCardProps> = ({
  subject,
  from,
  to,
  cc = [],
  bcc = [],
  body,
  emailId,
  attachments = [],
}) => {
  const [expanded, setExpanded] = useState(false);
  const parsedFrom = parseFromField(from);
  const fromDisplay = parsedFrom.name || parsedFrom.email || from;
  const fromValue = parsedFrom.email ? `${parsedFrom.name} <${parsedFrom.email}>` : parsedFrom.name;

  return (
    <div className='w-full overflow-hidden rounded-2xl border border-border bg-background/90'>
      <button
        type='button'
        onClick={() => setExpanded(prev => !prev)}
        data-track-category='MESSAGE'
        data-track-name='TOGGLE_EMAIL_CARD'
        className='flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors'
      >
        <Mail className='h-4 w-4 shrink-0 text-muted-foreground' />
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium text-foreground'>
            {subject || '(no subject)'}
          </p>
          <p className='truncate text-xs text-muted-foreground'>{fromDisplay}</p>
        </div>
        {expanded ? (
          <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
        ) : (
          <ChevronRight className='h-4 w-4 shrink-0 text-muted-foreground' />
        )}
      </button>

      {expanded && (
        <>
          <div className='border-t border-border px-4 py-3'>
            <div className='space-y-2'>
              <HeaderRow label='Subject:' value={subject || '-'} />
              <HeaderRow label='From:' value={fromValue || '-'} />
              <HeaderRow label='To:' value={to || '-'} />
              {cc.length > 0 && <HeaderRow label='Cc:' value={cc.join(', ')} />}
              {bcc.length > 0 && <HeaderRow label='Bcc:' value={bcc.join(', ')} />}
            </div>
          </div>
          <div className='border-t border-border px-4 py-3'>
            <div className='mb-2 text-sm font-semibold text-foreground'>Body:</div>
            <EmailBodyRenderer body={body} emailId={emailId} attachments={attachments} />
          </div>
        </>
      )}
    </div>
  );
};
