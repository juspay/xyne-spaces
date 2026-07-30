import { type ReactElement, type ReactNode } from 'react';
import { VerificationCheck } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Pill } from '../shared/Pill';
import { McpLogo } from './McpLogo';

export const VerifiedTick = (): ReactElement => (
  <VerificationCheck
    className='size-4 shrink-0 text-[color:var(--mention-color)]'
    aria-label='Verified connector'
    role='img'
  />
);

export const EnabledBadge = (): ReactElement => <Pill tone='success'>Enabled</Pill>;

export const StatusBadge = ({
  tone,
  children,
}: {
  tone: 'positive' | 'neutral';
  children: ReactNode;
}): ReactElement => <Pill tone={tone === 'positive' ? 'success' : 'neutral'}>{children}</Pill>;

interface McpIdentityProps {
  label: string;
  iconType: string;
  verified: boolean;
  gap?: 'tight' | 'default';
  muted?: boolean;
  trailing?: ReactNode;
}

export function McpIdentity({
  label,
  iconType,
  verified,
  gap = 'default',
  muted = false,
  trailing,
}: McpIdentityProps): ReactElement {
  return (
    <span className={cn('flex min-w-0 items-center', gap === 'tight' ? 'gap-1.5' : 'gap-2')}>
      <McpLogo type={iconType} name={label} />
      <span className='flex min-w-0 items-center gap-1'>
        <span
          className={cn(
            'truncate text-sm font-semibold leading-5',
            muted ? 'text-foreground/80' : 'text-foreground',
          )}
        >
          {label}
        </span>
        {verified && <VerifiedTick />}
      </span>
      {trailing}
    </span>
  );
}
