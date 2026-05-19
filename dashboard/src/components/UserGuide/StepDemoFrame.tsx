import type { ReactElement, ReactNode } from 'react';

interface StepDemoFrameProps {
  children: ReactNode;
}

export const StepDemoFrame = ({ children }: StepDemoFrameProps): ReactElement => (
  <div className='mt-3 mb-4 rounded-xl border border-border/50 shadow-sm overflow-hidden bg-card'>
    <div className='px-3 py-1.5 border-b border-border/40 bg-muted/30 flex items-center gap-1.5'>
      <span className='h-[7px] w-[7px] rounded-full bg-[#ff5f57]' />
      <span className='h-[7px] w-[7px] rounded-full bg-[#ffbc2e]' />
      <span className='h-[7px] w-[7px] rounded-full bg-[#28c840]' />
      <span className='ml-1 text-[9px] font-medium text-muted-foreground/40 tracking-wide'>
        Xyne Spaces
      </span>
    </div>
    <div className='p-3'>{children}</div>
  </div>
);
