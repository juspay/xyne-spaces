import { type ReactElement, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { OnboardingConnectLogo } from './OnboardingConnectLogos';
import {
  addPrototypeConnectKey,
  ONBOARDING_DOMAINS,
  ONBOARDING_ROLES,
  ONBOARDING_TRY_FIRST,
  PROTOTYPE_CONNECTORS,
  ONBOARDING_TAP_COPY,
  tap4FooterAction,
  type OnboardingDomain,
  type OnboardingPayload,
  type OnboardingRole,
  type OnboardingTap,
  type OnboardingTryFirst,
  type PrototypeConnectKey,
} from './onboardingFlow';

/**
 * Clickable wizard for the public /onboarding prototype.
 * Isolated from the persisted workspace onboarding screen.
 */
export const OnboardingWizardPrototype = ({
  onComplete,
}: {
  onComplete?: () => void;
}): ReactElement => {
  const [tap, setTap] = useState<OnboardingTap>(1);
  const [payload, setPayload] = useState<OnboardingPayload>({});
  const [checkedKeys, setCheckedKeys] = useState<PrototypeConnectKey[]>([]);

  const selectAndAdvance = (patch: OnboardingPayload, nextTap: OnboardingTap): void => {
    setPayload(current => ({ ...current, ...patch }));
    setTap(nextTap);
  };

  const handleRole = (key: OnboardingRole): void => {
    selectAndAdvance({ onboardingRole: key }, 2);
  };

  const handleDomain = (key: OnboardingDomain): void => {
    selectAndAdvance({ onboardingDomain: key }, 3);
  };

  const handleTryFirst = (key: OnboardingTryFirst): void => {
    selectAndAdvance({ onboardingTryFirst: key }, 4);
  };

  const handleConnectClick = (key: PrototypeConnectKey): void => {
    if (checkedKeys.includes(key)) {
      return;
    }
    const nextKeys = addPrototypeConnectKey(checkedKeys, key);
    setCheckedKeys(nextKeys);
    setPayload(current => ({ ...current, onboardingPrototypeConnectKeys: nextKeys }));
  };

  const handleBack = (): void => {
    if (tap <= 1) {
      return;
    }
    setTap((tap - 1) as OnboardingTap);
  };

  const handleComplete = (): void => {
    onComplete?.();
  };

  const footerAction = tap4FooterAction(checkedKeys.length);

  return (
    <div className='relative flex h-[100dvh] w-full flex-col bg-background'>
      <img
        src='/svgs/xyne.svg'
        alt='Xyne'
        className='absolute left-6 top-6 h-7 w-auto sm:left-12 sm:top-8'
      />

      <div className='mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-6 pt-24 sm:px-8'>
        <div className='mb-8 flex items-center gap-2' aria-label={`Step ${tap} of 4`}>
          {([1, 2, 3, 4] as const).map(step => (
            <span
              key={step}
              className={`h-1.5 flex-1 rounded-full ${step <= tap ? 'bg-foreground' : 'bg-muted'}`}
            />
          ))}
        </div>

        {tap > 1 && (
          <button
            type='button'
            onClick={handleBack}
            className='mb-4 inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground'
            data-testid='onboarding-back'
            data-track-category='OnboardingPrototype'
            data-track-name='Back'
          >
            <ArrowLeft className='h-4 w-4' />
            Back
          </button>
        )}

        <h1 className='text-2xl font-semibold leading-tight text-foreground sm:text-3xl'>
          {ONBOARDING_TAP_COPY[tap].title}
        </h1>
        <p className='mt-2 text-sm leading-6 text-muted-foreground sm:text-base'>
          {ONBOARDING_TAP_COPY[tap].subtitle}
        </p>

        {tap === 1 && (
          <div className='mt-8 grid gap-3' data-testid='onboarding-tap-1'>
            {ONBOARDING_ROLES.map(option => (
              <ChoiceButton
                key={option.key}
                selected={payload.onboardingRole === option.key}
                onClick={() => handleRole(option.key)}
                testId={`onboarding-role-${option.key}`}
              >
                {option.label}
              </ChoiceButton>
            ))}
          </div>
        )}

        {tap === 2 && (
          <div className='mt-8 grid gap-3' data-testid='onboarding-tap-2'>
            {ONBOARDING_DOMAINS.map(option => (
              <ChoiceButton
                key={option.key}
                selected={payload.onboardingDomain === option.key}
                onClick={() => handleDomain(option.key)}
                testId={`onboarding-domain-${option.key}`}
              >
                {option.label}
              </ChoiceButton>
            ))}
          </div>
        )}

        {tap === 3 && (
          <div className='mt-8 grid gap-3' data-testid='onboarding-tap-3'>
            {ONBOARDING_TRY_FIRST.map(option => (
              <ChoiceButton
                key={option.key}
                selected={payload.onboardingTryFirst === option.key}
                onClick={() => handleTryFirst(option.key)}
                testId={`onboarding-try-${option.key}`}
              >
                {option.label}
              </ChoiceButton>
            ))}
          </div>
        )}

        {tap === 4 && (
          <div className='mt-8 flex min-h-0 flex-1 flex-col' data-testid='onboarding-tap-4'>
            <ul className='flex flex-col gap-3'>
              {PROTOTYPE_CONNECTORS.map(connector => {
                const checked = checkedKeys.includes(connector.key);
                return (
                  <li key={connector.key}>
                    <div className='flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card px-3 py-3'>
                      <OnboardingConnectLogo
                        connectorKey={connector.key}
                        className='h-7 w-7 shrink-0'
                      />
                      <span className='flex-1 text-sm font-medium text-foreground'>
                        {connector.label}
                      </span>
                      {checked ? (
                        <span
                          className='inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium text-green-600'
                          data-testid={`onboarding-connected-${connector.key}`}
                        >
                          <Check className='h-4 w-4' />
                          Connected
                        </span>
                      ) : (
                        <button
                          type='button'
                          onClick={() => handleConnectClick(connector.key)}
                          className='inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90'
                          data-testid={`onboarding-connect-${connector.key}`}
                          data-track-category='OnboardingPrototype'
                          data-track-name='DummyConnect'
                        >
                          Connect {connector.label}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className='mt-auto pt-8'>
              {footerAction === 'skip' ? (
                <button
                  type='button'
                  onClick={handleComplete}
                  className='inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-accent'
                  data-testid='onboarding-skip'
                  data-track-category='OnboardingPrototype'
                  data-track-name='DummySkip'
                >
                  Skip
                </button>
              ) : (
                <button
                  type='button'
                  onClick={handleComplete}
                  className='inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90'
                  data-testid='onboarding-continue'
                  data-track-category='OnboardingPrototype'
                  data-track-name='DummyContinueWizard'
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ChoiceButton = ({
  children,
  selected,
  onClick,
  testId,
}: {
  children: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-testid={testId}
    data-track-category='OnboardingPrototype'
    data-track-name='DummyChoice'
    className={`min-h-11 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
      selected
        ? 'border-foreground bg-accent text-foreground'
        : 'border-border bg-card text-foreground hover:bg-accent'
    }`}
  >
    {children}
  </button>
);
