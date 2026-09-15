import { type ReactElement } from 'react';
import { ONBOARDING_SAMPLE_THREAD } from './onboardingSample';

const OnboardingSampleThread = (): ReactElement => {
  const sample = ONBOARDING_SAMPLE_THREAD;

  return (
    <div className='flex h-full flex-col bg-background' data-testid='onboarding-sample-thread'>
      <header className='flex items-center gap-2 border-b border-border px-4 py-3'>
        <span className='text-sm font-semibold text-foreground'>#{sample.channelName}</span>
        <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
          {sample.label}
        </span>
      </header>
      <div className='flex-1 space-y-4 overflow-y-auto p-4'>
        {sample.messages.map(message => (
          <div key={message.id} className='flex flex-col gap-1'>
            <span className='text-sm font-semibold text-foreground'>{message.author}</span>
            <p className='text-sm leading-6 text-foreground'>{message.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OnboardingSampleThread;
