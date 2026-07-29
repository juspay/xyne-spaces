import type { ReactElement, ReactNode } from 'react';

interface MockFrameProps {
  title: string;
  children: ReactNode;
}

export const MockFrame = ({ title, children }: MockFrameProps): ReactElement => {
  return (
    <div className='rounded-xl border border-border bg-background shadow-sm overflow-hidden'>
      <div className='h-8 border-b border-border bg-muted/50 px-3 flex items-center justify-between'>
        <div className='flex items-center gap-1.5'>
          <span className='h-2 w-2 rounded-full bg-[#ff5f57]' />
          <span className='h-2 w-2 rounded-full bg-[#ffbc2e]' />
          <span className='h-2 w-2 rounded-full bg-[#28c840]' />
        </div>
        <span className='text-[11px] text-muted-foreground font-medium truncate'>{title}</span>
      </div>
      <div className='p-3'>{children}</div>
    </div>
  );
};
