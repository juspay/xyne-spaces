import { ReactElement, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { authActor } from '../../machines/authMachine';
import {
  getQuestionnaireResponse,
  saveQuestionnaireResponse,
} from '../../services/userProfile/userProfileService';
import { mixpanelService, EVENTS } from '../../services/Analytics/mixpanelService';
import { suppressAIOnboardingAutoStart } from '../../contexts/AIOnboardingContext';
import { OnboardingConnectLogo } from './OnboardingConnectLogos';
import { markOnboardingSampleVisible } from './onboardingSample';
import {
  addPrototypeConnectKey,
  buildCompletePayload,
  canCompleteOnboarding,
  ONBOARDING_DOMAINS,
  ONBOARDING_ROLES,
  ONBOARDING_TRY_FIRST,
  PLUG_AND_PLAY_ONBOARDING_TYPE,
  PROTOTYPE_CONNECTORS,
  parseOnboardingPayload,
  wizardOpeningTap,
  tap4FooterAction,
  tryFirstLandingPath,
  type OnboardingDomain,
  type OnboardingPayload,
  type OnboardingRole,
  type OnboardingTap,
  type OnboardingTryFirst,
  type PrototypeConnectKey,
} from './onboardingFlow';

const TAP_COPY: Record<OnboardingTap, { title: string; subtitle: string }> = {
  1: {
    title: 'What do you do here?',
    subtitle: "We'll remember this. It doesn't change where you land.",
  },
  2: {
    title: 'What space are you in?',
    subtitle: 'Stored only. Your landing still follows what you want to try first.',
  },
  3: {
    title: 'What do you want to try first?',
    subtitle: "We'll take you there after you connect — or skip — your tools.",
  },
  4: {
    title: 'See Spaces with the tools you already live in.',
    subtitle: 'Connect one, several, or skip. You can use Spaces either way.',
  },
};

const OnboardingScreen = (): ReactElement | null => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tap, setTap] = useState<OnboardingTap>(1);
  const [payload, setPayload] = useState<OnboardingPayload>({});
  const [checkedKeys, setCheckedKeys] = useState<PrototypeConnectKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLand, setPendingLand] = useState<OnboardingPayload | null>(null);

  useEffect(() => {
    suppressAIOnboardingAutoStart();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const raw = await getQuestionnaireResponse(PLUG_AND_PLAY_ONBOARDING_TYPE);
        if (cancelled) {
          return;
        }
        const next = parseOnboardingPayload(raw);
        setPayload(next);
        setCheckedKeys(next.onboardingPrototypeConnectKeys ?? []);
        const openingTap = wizardOpeningTap(next);
        setTap(openingTap);
        mixpanelService.track(EVENTS.ONBOARDING_TAP, { tap: openingTap, prototype: true });
      } catch {
        if (!cancelled) {
          setError("Couldn't load your progress. You can still continue.");
          setTap(1);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pendingLand) {
      return;
    }
    const workspaceId = user?.workspaceId;
    const tryFirst = pendingLand.onboardingTryFirst;
    if (!workspaceId || !tryFirst) {
      return;
    }
    markOnboardingSampleVisible(workspaceId);
    suppressAIOnboardingAutoStart();
    authActor.send({ type: 'COMPLETE_ONBOARDING' });
    void navigate(tryFirstLandingPath(workspaceId, tryFirst));
  }, [pendingLand, user?.workspaceId, navigate]);

  const persist = async (next: OnboardingPayload): Promise<OnboardingPayload> => {
    const saved = await saveQuestionnaireResponse({
      questionnaireType: PLUG_AND_PLAY_ONBOARDING_TYPE,
      payload: { ...next },
    });
    return parseOnboardingPayload(saved);
  };

  const selectAndAdvance = async (
    patch: OnboardingPayload,
    nextTap: OnboardingTap,
  ): Promise<void> => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    const next = { ...payload, ...patch };
    setPayload(next);
    try {
      const saved = await persist(next);
      setPayload(saved);
      setTap(nextTap);
      mixpanelService.track(EVENTS.ONBOARDING_TAP, { tap: nextTap, prototype: true });
    } catch {
      setError("Couldn't save. Stay here and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRole = (key: OnboardingRole): void => {
    void selectAndAdvance({ onboardingRole: key }, 2);
  };

  const handleDomain = (key: OnboardingDomain): void => {
    void selectAndAdvance({ onboardingDomain: key }, 3);
  };

  const handleTryFirst = (key: OnboardingTryFirst): void => {
    void selectAndAdvance({ onboardingTryFirst: key }, 4);
  };

  const handleConnectClick = (key: PrototypeConnectKey): void => {
    if (checkedKeys.includes(key)) {
      return;
    }
    const nextKeys = addPrototypeConnectKey(checkedKeys, key);
    setCheckedKeys(nextKeys);
    mixpanelService.track(EVENTS.ONBOARDING_CONNECT_CLICK, {
      connectorKey: key,
      prototype: true,
    });
    const next = { ...payload, onboardingPrototypeConnectKeys: nextKeys };
    setPayload(next);
    void persist(next).catch(() => {
      setError("Couldn't save. Stay here and try again.");
    });
  };

  const handleBack = (): void => {
    if (tap <= 1 || isSaving) {
      return;
    }
    const previous = (tap - 1) as OnboardingTap;
    setError(null);
    setTap(previous);
    mixpanelService.track(EVENTS.ONBOARDING_TAP, { tap: previous, prototype: true });
  };

  const handleComplete = async (skipped: boolean): Promise<void> => {
    if (isSaving || !canCompleteOnboarding(payload) || !payload.onboardingTryFirst) {
      return;
    }
    setIsSaving(true);
    setError(null);
    const completed = buildCompletePayload(payload, checkedKeys, new Date().toISOString());
    try {
      const saved = await persist(completed);
      const tryFirst = saved.onboardingTryFirst ?? payload.onboardingTryFirst;
      mixpanelService.track(skipped ? EVENTS.ONBOARDING_SKIP : EVENTS.ONBOARDING_COMPLETE, {
        checkedKeys,
        tryFirst,
        prototype: true,
      });
      setPendingLand({
        ...payload,
        ...saved,
        onboardingTryFirst: payload.onboardingTryFirst,
      });
    } catch {
      setError("Couldn't save. Stay here and try again.");
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className='flex h-[100dvh] w-full items-center justify-center bg-background'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    );
  }

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
            disabled={isSaving}
            className='mb-4 inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground'
            data-testid='onboarding-back'
            data-track-category='Onboarding'
            data-track-name='Back'
          >
            <ArrowLeft className='h-4 w-4' />
            Back
          </button>
        )}

        <h1 className='text-2xl font-semibold leading-tight text-foreground sm:text-3xl'>
          {TAP_COPY[tap].title}
        </h1>
        <p className='mt-2 text-sm leading-6 text-muted-foreground sm:text-base'>
          {TAP_COPY[tap].subtitle}
        </p>

        {error && (
          <p
            className='mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
            data-testid='onboarding-error'
            role='alert'
          >
            {error}
          </p>
        )}

        {tap === 1 && (
          <div className='mt-8 grid gap-3' data-testid='onboarding-tap-1'>
            {ONBOARDING_ROLES.map(option => (
              <ChoiceButton
                key={option.key}
                selected={payload.onboardingRole === option.key}
                disabled={isSaving}
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
                disabled={isSaving}
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
                disabled={isSaving}
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
                          data-track-category='Onboarding'
                          data-track-name='ConnectPrototype'
                          data-track-metadata={JSON.stringify({ connectorKey: connector.key })}
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
                  onClick={() => void handleComplete(true)}
                  disabled={isSaving}
                  className='inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60'
                  data-testid='onboarding-skip'
                  data-track-category='Onboarding'
                  data-track-name='SkipConnect'
                >
                  {isSaving ? 'Saving…' : 'Skip'}
                </button>
              ) : (
                <button
                  type='button'
                  onClick={() => void handleComplete(false)}
                  disabled={isSaving}
                  className='inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60'
                  data-testid='onboarding-continue'
                  data-track-category='Onboarding'
                  data-track-name='ContinueConnect'
                >
                  {isSaving ? 'Saving…' : 'Continue'}
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
  disabled,
  onClick,
  testId,
}: {
  children: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    data-track-category='Onboarding'
    data-track-name='Choice'
    className={`min-h-11 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors disabled:opacity-60 ${
      selected
        ? 'border-foreground bg-accent text-foreground'
        : 'border-border bg-card text-foreground hover:bg-accent'
    }`}
  >
    {children}
  </button>
);

export default OnboardingScreen;
