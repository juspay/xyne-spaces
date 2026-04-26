import { ChevronDown, User as UserIcon } from 'lucide-react';
import { JSX, ReactNode, useState } from 'react';
import { cn } from '../../../utils/classNames';
import { useAuth } from '../../../hooks/useAuth';
import { Popover } from '../../ui/Popover/Popover';
import {
  avatarColorFor,
  avatarInitial,
  formatEmailHeaderDate,
  summarizeRecipients,
} from './emailHeaderUtils';

interface EmailThreadHeaderProps {
  fromName: string;
  fromEmail: string | null;
  to: readonly string[];
  cc: readonly string[];
  bcc?: readonly string[];
  createdAt: number | null | undefined;
  isCollapsed: boolean;
  previewText?: string;
  extras?: ReactNode;
  isRead?: boolean;
}

const EmailAvatar = ({ name, email }: { name: string; email: string | null }): JSX.Element => {
  const initial = avatarInitial(name);
  const colorClass = avatarColorFor(email ?? name);

  if (!initial) {
    return (
      <div className='size-8 rounded-full bg-gray-300 flex items-center justify-center text-white shrink-0'>
        <UserIcon size={16} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'size-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0',
        colorClass,
      )}
      aria-hidden='true'
    >
      {initial}
    </div>
  );
};

const DetailRow = ({
  label,
  values,
}: {
  label: string;
  values: readonly string[];
}): JSX.Element | null => {
  if (!values || values.length === 0) return null;
  return (
    <div className='flex gap-3 text-sm items-start'>
      <span className='text-muted-foreground w-14 shrink-0 pt-0.5'>{label}:</span>
      <span className='text-foreground break-words flex-1 min-w-0'>{values.join(', ')}</span>
    </div>
  );
};

export const EmailThreadHeader = ({
  fromName,
  fromEmail,
  to,
  cc,
  bcc,
  createdAt,
  isCollapsed,
  previewText,
  extras,
  isRead = true,
}: EmailThreadHeaderProps): JSX.Element => {
  const { user } = useAuth();
  const currentUserEmail = user?.email ?? null;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const recipientSummary = summarizeRecipients(to, cc, currentUserEmail);
  const date = formatEmailHeaderDate(createdAt);

  const fromValues: string[] = [];
  if (fromName && fromEmail) fromValues.push(`${fromName} <${fromEmail}>`);
  else if (fromEmail) fromValues.push(fromEmail);
  else if (fromName) fromValues.push(fromName);

  const detailsContent = (
    <div className='space-y-2 min-w-[18rem] max-w-[28rem]'>
      <DetailRow label='from' values={fromValues} />
      <DetailRow label='to' values={to} />
      {cc && cc.length > 0 && <DetailRow label='cc' values={cc} />}
      {bcc && bcc.length > 0 && <DetailRow label='bcc' values={bcc} />}
      <DetailRow label='date' values={[date.full]} />
    </div>
  );

  const trigger = (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      className='inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-0.5'
      aria-label={detailsOpen ? 'Hide recipient details' : 'Show recipient details'}
      data-track-category='Support'
      data-track-name={detailsOpen ? 'HideEmailDetails' : 'ShowEmailDetails'}
    >
      <span>{recipientSummary.label}</span>
      <ChevronDown size={12} className={cn('transition-transform', detailsOpen && 'rotate-180')} />
    </button>
  );

  return (
    <div className='w-full flex items-start gap-3'>
      <EmailAvatar name={fromName} email={fromEmail} />
      <div className='flex-1 min-w-0'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-1.5 flex-wrap'>
              {!isRead && (
                <span className='size-2 rounded-full bg-blue-500 shrink-0' aria-label='Unread' />
              )}
              <span
                className={cn('text-sm text-foreground', isRead ? 'font-semibold' : 'font-bold')}
              >
                {fromName}
              </span>
              {fromEmail && (
                <span className='text-xs text-muted-foreground font-normal truncate'>
                  {`<${fromEmail}>`}
                </span>
              )}
              {extras}
            </div>
            {isCollapsed ? (
              <div className='text-xs text-muted-foreground truncate mt-0.5'>
                {previewText || ''}
              </div>
            ) : (
              <Popover
                trigger={trigger}
                open={detailsOpen}
                onOpenChange={setDetailsOpen}
                side='bottom'
                align='start'
                sideOffset={6}
                className='p-4 shadow-lg'
              >
                {detailsContent}
              </Popover>
            )}
          </div>
          <div
            className='text-xs text-muted-foreground shrink-0 whitespace-nowrap'
            title={date.full}
          >
            {date.short}
          </div>
        </div>
      </div>
    </div>
  );
};
