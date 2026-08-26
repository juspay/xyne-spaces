import React from 'react';
import { Lock } from 'lucide-react';

/**
 * Shown in place of an approval card that is addressed to another member of the
 * thread. It reveals no action details (tool, params, diff) — only that a
 * pending approval exists and is not actionable by the current viewer.
 */
export const RestrictedApprovalPlaceholder: React.FC = () => {
  return (
    <div className='my-2 flex items-center gap-2 rounded-[10px] border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
      <Lock className='size-3.5 shrink-0' aria-hidden='true' />
      <span>Approval requested — only the assigned reviewer can action this.</span>
    </div>
  );
};
