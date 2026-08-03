import { type ReactElement, type ReactNode } from 'react';
import { VerificationCheck } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Pill } from '../shared/Pill';
import { McpLogo } from './McpLogo';

export const VerifiedTick = (): ReactElement => (
  <VerificationCheck
    variant='Solid'
    className='size-4 shrink-0 text-[color:var(--mention-color)]'
    aria-label='Verified connector'
    role='img'
  />
);

export const EnabledBadge = (): ReactElement => (
  <Pill tone='success' size='sm'>
    Enabled
  </Pill>
);

export const StatusBadge = ({
  tone,
  children,
}: {
  tone: 'positive' | 'neutral';
  children: ReactNode;
}): ReactElement => (
  <Pill tone={tone === 'positive' ? 'success' : 'neutral'} size='sm'>
    {children}
  </Pill>
);

interface McpIdentityProps {
  label: string;
  iconType: string;
  verified: boolean;
  gap?: 'tight' | 'default';
  muted?: boolean;
  weight?: 'medium' | 'semibold';
  trailing?: ReactNode;
}

export function McpIdentity({
  label,
  iconType,
  verified,
  gap = 'default',
  muted = false,
  weight = 'semibold',
  trailing,
}: McpIdentityProps): ReactElement {
  return (
    <span className={cn('flex min-w-0 items-center', gap === 'tight' ? 'gap-1.5' : 'gap-2')}>
      <McpLogo type={iconType} name={label} />
      <span className='flex min-w-0 items-center gap-1'>
        <span
          className={cn(
            'truncate text-sm leading-5',
            weight === 'medium' ? 'font-medium' : 'font-semibold',
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
