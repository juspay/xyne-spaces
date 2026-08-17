import React from 'react';
import { formatFullTimestamp, formatRelativeTimestamp } from '../../../utils/dateUtils';
import { LogLevelBadge } from '../LogLevelBadge/LogLevelBadge';

interface LogIssueHighlightsProps {
  levelSourceText: string;
  occurrenceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

function HighlightRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex items-center justify-between py-2 border-b border-border last:border-b-0'>
      <span className='text-sm text-muted-foreground'>{label}</span>
      <span className='text-sm font-medium text-foreground'>{value}</span>
    </div>
  );
}

export function LogIssueHighlights({
  levelSourceText,
  occurrenceCount,
  firstSeenAt,
  lastSeenAt,
}: LogIssueHighlightsProps): React.ReactElement {
  return (
    <div className='bg-background rounded-lg border border-border p-6'>
      <h2 className='text-lg font-semibold text-foreground mb-3'>Highlights</h2>
      <HighlightRow label='Level' value={<LogLevelBadge text={levelSourceText} />} />
      <HighlightRow label='Events' value={occurrenceCount} />
      <HighlightRow
        label='First seen'
        value={
          <span title={formatFullTimestamp(firstSeenAt)}>
            {formatRelativeTimestamp(firstSeenAt)}
          </span>
        }
      />
      <HighlightRow
        label='Last seen'
        value={
          <span title={formatFullTimestamp(lastSeenAt)}>{formatRelativeTimestamp(lastSeenAt)}</span>
        }
      />
    </div>
  );
}
