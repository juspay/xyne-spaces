import type { ReactElement } from 'react';

interface XyneAIOnboardingHeaderProps {
  onClose: () => void;
}

export const XyneAIOnboardingHeader = ({ onClose }: XyneAIOnboardingHeaderProps): ReactElement => {
  return (
    <div className='h-14 p-4 flex items-center justify-between gap-2 self-stretch border-border'>
      <div className="text-foreground text-base font-semibold font-['Inter']">
        Explore Xyne Spaces
      </div>
      <button
        onClick={onClose}
        className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
        title='Skip onboarding'
        data-track-category='AIOnboarding'
        data-track-name='SkipOnboarding'
      >
        <img src='/svgs/icons/close.svg' alt='Close' width='16' height='16' />
      </button>
    </div>
  );
};
