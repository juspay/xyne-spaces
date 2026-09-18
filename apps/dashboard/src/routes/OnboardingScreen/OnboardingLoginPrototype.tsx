import { type FormEvent, type ReactElement, useState } from 'react';
import GoogleLogo from '../../assets/icons/GoogleLogo';
import { MicrosoftLogo } from '../../assets/icons/MicrosoftLogo';
import {
  OnboardingLoginLayout,
  OnboardingSpacesMark,
  onboardingContinueButtonClassName,
  onboardingEmailInputClassName,
  onboardingOauthButtonClassName,
} from './OnboardingLoginLayout';

/**
 * Design-only login step for /onboarding.
 * Every control advances locally — no OAuth, no email APIs, no auth machine.
 */
export const OnboardingLoginPrototype = ({
  onAdvance,
}: {
  onAdvance: (details: { email: string }) => void;
}): ReactElement => {
  const [email, setEmail] = useState('');

  const advance = (event?: FormEvent): void => {
    event?.preventDefault();
    onAdvance({ email });
  };

  return (
    <OnboardingLoginLayout>
      <div
        className='flex w-full max-w-[400px] flex-col items-center'
        role='main'
        aria-label='Onboarding prototype'
        data-testid='onboarding-prototype-login'
      >
        <div className='flex w-full flex-col items-center gap-16'>
          <div className='flex flex-col items-center gap-4 text-center'>
            <OnboardingSpacesMark />
            <p className='text-[15px] font-medium leading-[1.2] tracking-[-0.6px] text-[#232229]'>
              A unified workspace for (humans + agents) to collab
            </p>
          </div>

          <div className='flex w-full max-w-[350px] flex-col gap-9'>
            <div className='flex w-full flex-col gap-[15px]'>
              <button
                type='button'
                onClick={() => advance()}
                className={onboardingOauthButtonClassName}
                data-testid='onboarding-dummy-google'
                data-track-category='OnboardingPrototype'
                data-track-name='DummyGoogle'
              >
                <GoogleLogo className='h-5 w-5 shrink-0' />
                Continue with Google
              </button>
              <button
                type='button'
                onClick={() => advance()}
                className={onboardingOauthButtonClassName}
                data-testid='onboarding-dummy-microsoft'
                data-track-category='OnboardingPrototype'
                data-track-name='DummyMicrosoft'
              >
                <MicrosoftLogo className='h-5 w-5 shrink-0' />
                Continue with Microsoft
              </button>
            </div>

            <p className='w-full text-center text-[15px] font-[450] leading-[1.5] tracking-[-0.1px] text-[rgba(35,34,41,0.4)]'>
              or
            </p>

            <form onSubmit={advance} className='flex w-full flex-col items-center gap-4'>
              <input
                type='email'
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder='Email address'
                className={onboardingEmailInputClassName}
                data-testid='onboarding-dummy-email'
                data-track-category='OnboardingPrototype'
                data-track-name='DummyEmailInput'
              />
              <button
                type='submit'
                className={onboardingContinueButtonClassName}
                data-testid='onboarding-dummy-continue'
                data-track-category='OnboardingPrototype'
                data-track-name='DummyContinue'
              >
                Continue
              </button>
              <p className='text-[15px] font-[450] leading-[1.5] tracking-[-0.1px] text-[#232229]'>
                Don&apos;t have an account?{' '}
                <button
                  type='button'
                  onClick={() => advance()}
                  className='text-[#fd6b6b] hover:text-[#ff4f4f]'
                  data-testid='onboarding-dummy-signup'
                  data-track-category='OnboardingPrototype'
                  data-track-name='DummySignUp'
                >
                  Sign-up
                </button>
              </p>
            </form>
          </div>
        </div>
      </div>
    </OnboardingLoginLayout>
  );
};
