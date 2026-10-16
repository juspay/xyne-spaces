import type { ReactNode } from 'react';

/**
 * Shared frame for every lobby screen. Colours match the in-call view
 * (FullCallView / CallControls) so the lobby → call hand-off reads as one surface.
 */
export function LobbyShell({ children }: { children: ReactNode }) {
  return (
    <div className='flex min-h-[100dvh] flex-col bg-[#131314] text-[#e3e3e3]'>
      <header className='flex h-16 shrink-0 items-center px-4 sm:px-6'>
        <span className='text-[17px] font-medium tracking-tight text-[#e3e3e3]'>Xyne Call</span>
      </header>
      <main className='flex flex-1 items-center justify-center px-4 pb-10 sm:px-6'>{children}</main>
    </div>
  );
}

interface StatusCardProps {
  icon: ReactNode;
  tone?: 'neutral' | 'danger';
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}

/** Centered message for terminal / interstitial states (ended, declined, left…). */
export function StatusCard({ icon, tone = 'neutral', title, description, children }: StatusCardProps) {
  return (
    <div className='flex w-full max-w-md flex-col items-center text-center animate-in fade-in-0 zoom-in-95 duration-300'>
      <div
        className={
          tone === 'danger'
            ? 'mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#dc362e]/15 text-[#f2b8b5]'
            : 'mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#333537] text-[#c4c7c5]'
        }
      >
        {icon}
      </div>
      <h1 className='text-[28px] font-normal leading-9 text-[#e3e3e3]'>{title}</h1>
      {description && (
        <p className='mt-3 text-[15px] leading-6 text-[#c4c7c5]'>{description}</p>
      )}
      {children && <div className='mt-8 flex flex-col items-center gap-3'>{children}</div>}
    </div>
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm' ? 'h-4 w-4 border-2' : 'h-9 w-9 border-[3px]';
  return (
    <div
      role='status'
      aria-label='Loading'
      className={`${sizeClasses} animate-spin rounded-full border-[#333537] border-t-[#a8c7fa]`}
    />
  );
}

export const primaryButtonClass =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#a8c7fa] px-7 text-[15px] font-medium text-[#062e6f] transition-colors hover:bg-[#bcd4fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#131314] disabled:cursor-not-allowed disabled:opacity-60';
