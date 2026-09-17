import { type ReactElement, useState } from 'react';
import {
  OnboardingLoginLayout,
  OnboardingSpacesMark,
  onboardingContinueButtonClassName,
} from './OnboardingLoginLayout';
import { OnboardingLoginPrototype } from './OnboardingLoginPrototype';
import { OnboardingWizardPrototype } from './OnboardingWizardPrototype';

/**
 * Public /onboarding route: clickable design prototype only.
 * Isolated from AuthScreen so production login on /auth stays real,
 * and from persisted workspace onboarding at /:workspaceId/onboarding.
 */
const OnboardingPrototype = (): ReactElement => {
  const [step, setStep] = useState<'login' | 'wizard' | 'done'>('login');

  if (step === 'login') {
    return <OnboardingLoginPrototype onAdvance={() => setStep('wizard')} />;
  }

  if (step === 'done') {
    return (
      <OnboardingLoginLayout>
        <div
          className='flex w-full max-w-[400px] flex-col items-center gap-10 text-center'
          role='status'
          data-testid='onboarding-prototype-done'
        >
          <OnboardingSpacesMark />
          <div className='flex flex-col gap-3'>
            <p className='text-[22px] font-[550] leading-[1.3] tracking-[-0.6px] text-[#232229]'>
              That&apos;s the Spaces onboarding flow.
            </p>
            <p className='text-[15px] font-[450] leading-[1.5] tracking-[-0.1px] text-[rgba(35,34,41,0.55)]'>
              No account was created. Start over to walk the prototype again, or use Sign in for a
              real session.
            </p>
          </div>
          <button
            type='button'
            onClick={() => setStep('login')}
            className={onboardingContinueButtonClassName}
            data-testid='onboarding-prototype-restart'
            data-track-category='OnboardingPrototype'
            data-track-name='DummyRestart'
          >
            Start over
          </button>
        </div>
      </OnboardingLoginLayout>
    );
  }

  return <OnboardingWizardPrototype onComplete={() => setStep('done')} />;
};

export default OnboardingPrototype;
