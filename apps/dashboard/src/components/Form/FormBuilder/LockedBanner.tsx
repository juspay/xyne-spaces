import type { ReactElement } from 'react';
import { Lock } from 'lucide-react';

interface LockedBannerProps {
  reason?: string | undefined;
}

export const LockedBanner = ({ reason }: LockedBannerProps): ReactElement => (
  <div
    role='status'
    className='flex items-start gap-2 rounded-[8px] border border-border bg-muted/40 px-[10px] py-[8px] text-[12px] text-muted-foreground'
  >
    <Lock size={14} className='mt-[1px] shrink-0' />
    <span>
      {reason ?? 'Only the creator of this form or a Forms admin can edit it. You can view it.'}
    </span>
  </div>
);
