import { type ReactElement } from 'react';
import { SparkleAi01 } from '@xyne/icons';

export function AIComingSoon({ title }: { title: string }): ReactElement {
  return (
    <main className='flex h-full flex-1 items-center justify-center px-6 py-8'>
      <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
        <span className='flex size-12 items-center justify-center rounded-full bg-sidebar-accent'>
          <SparkleAi01 className='size-5 text-sidebar-accent-foreground' aria-hidden />
        </span>
        <h1 className='text-base font-semibold tracking-[-0.32px] text-foreground'>{title}</h1>
        <p className='text-sm text-muted-foreground'>
          This section is coming soon. It will show up here once it&apos;s ready.
        </p>
      </div>
    </main>
  );
}
