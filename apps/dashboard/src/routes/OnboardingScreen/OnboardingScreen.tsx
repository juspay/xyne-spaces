import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import Cookies from 'js-cookie';
import { useAuth } from '../../hooks/useAuth';
import { useUser } from '../../hooks/useUsers';
import { useMigratedChannels, useChannelByName } from '../../hooks/useChannels';
import { useProfilePictureUrl } from '../../hooks/useProfilePicture';
import { authActor } from '../../machines/authMachine';
import Confetti from 'react-confetti';
import LocalHarnessOnboardingStep from './LocalHarnessOnboardingStep';
import type { LocalHarnessInstallation } from '../../types/electron';

const OnboardingScreen: React.FC = () => {
  const navigate = useNavigate();
  const [isCompleting, setIsCompleting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const { user: currentUser } = useAuth();
  const targetUserId = currentUser?.id || '';
  const user = useUser(targetUserId);

  // Get migrated channels using the hook
  const migratedChannels = useMigratedChannels();

  // Resolve the default "general" channel so first-time users land there after
  // onboarding instead of the user guide.
  const generalChannel = useChannelByName('general');

  const [localHarnesses, setLocalHarnesses] = useState<LocalHarnessInstallation[]>([]);
  const currentStepRef = useRef(0);
  currentStepRef.current = currentStep;

  useEffect(() => {
    const api = window.electronAPI?.localHarness;
    if (!api) return;
    let cancelled = false;
    void api
      .detect()
      .then(found => {
        if (cancelled || currentStepRef.current !== 0) return;
        setLocalHarnesses(found.filter(install => install.authenticated));
      })
      .catch(() => {});
    return (): void => {
      cancelled = true;
    };
  }, []);

  // Build onboarding steps dynamically based on whether user has migrated channels
  const hasMigratedChannels = migratedChannels?.length > 0;

  const onboardingSteps = [
    {
      key: 'welcome',
      title: 'Welcome to a smarter workspace made for you',
      animation: 'none',
    },
    {
      key: 'collaborate',
      title: 'Collaborate faster with a similar but enhanced interface',
      animation: 'fadeUp',
    },
    {
      key: 'tickets',
      title: 'Create & triage tickets easily from conversations',
      animation: 'fadeLeft',
    },
    {
      key: 'productivity',
      title: 'Welcome to Day 1 of 10x productivity',
      animation: 'fadeLeft',
    },
    ...(hasMigratedChannels
      ? [
          {
            key: 'channels',
            title: '',
            animation: 'fadeUp',
          } as const,
        ]
      : []),
    ...(localHarnesses.length > 0
      ? [
          {
            key: 'localHarness',
            title: 'Run agents on your own machine',
            animation: 'fadeUp',
          } as const,
        ]
      : []),
    {
      key: 'profile',
      title: 'Your profile is ready for action!',
      animation: 'none',
    },
  ];

  // Get context for queries
  // const context = useAuthContextValues();

  const [profileAnim, setProfileAnim] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const { url: pictureUrl } = useProfilePictureUrl(targetUserId, user?.picture);

  useEffect((): void | (() => void) => {
    if (onboardingSteps.length > 0 && currentStep === onboardingSteps.length - 1) {
      // start animation on mount with slight delay for smooth entry
      const animTimeout = setTimeout(() => {
        setProfileAnim(true);
      }, 100);

      // play confetti once
      setShowConfetti(true);
      const confettiTimeout = setTimeout(() => setShowConfetti(false), 800);

      return () => {
        clearTimeout(animTimeout);
        clearTimeout(confettiTimeout);
      };
    }

    setProfileAnim(false);
  }, [currentStep, migratedChannels]);

  useEffect(() => {
    // Check if is_new_user cookie exists
    const isNewUserCookie = Cookies.get('is_new_user');
    if (!isNewUserCookie) {
      // Redirect to home screen if cookie doesn't exist
      void navigate('/');
    }
  }, [navigate]);

  const handleCompleteOnboarding = (): void => {
    setIsCompleting(true);

    // Send event to auth machine to update isNewUser state
    authActor.send({ type: 'COMPLETE_ONBOARDING' });

    const workspaceId = currentUser?.workspaceId;
    if (workspaceId) {
      // After onboarding, land directly in the chat directory on the general
      // channel instead of the user guide.
      const landing = generalChannel?.id ? `/chat/dir/${generalChannel.id}` : '/chat/dir';
      void navigate(`/${workspaceId}${landing}`);
    }
  };

  const nextStep = (): void => {
    if (currentStep < onboardingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const renderStep = (): React.JSX.Element | null => {
    const step = onboardingSteps[currentStep];
    if (!step) return null;

    switch (step.key) {
      case 'welcome':
        return (
          <div className='w-full h-screen relative bg-background overflow-hidden flex items-center justify-center p-4 animate-in fade-in duration-500'>
            <div className='absolute inset-0 opacity-20 bg-gradient-to-br from-orange-100 to-orange-200 blur-3xl animate-pulse-slow' />
            <div className='relative z-10 w-full max-w-4xl mx-auto text-center'>
              <h1 className='text-center text-foreground font-medium text-lg sm:text-xl md:text-2xl lg:text-3xl leading-relaxed'>
                Welcome to a smarter workspace made
                <br />
                {/* FOR (anchor) */}
                <span className='relative inline-block mx-1'>
                  for
                  {/* crissCrossVector */}
                  <img
                    src='/images/onboarding/crissCrossVector.svg'
                    alt=''
                    className='absolute top-[0.2em] -right-[0.05em] w-[1.2em] pointer-events-none'
                  />
                  {/* GREYCOVER (always below 'for') */}
                  <span
                    className='
  absolute
  left-1/4
  top-[1em]
  -translate-x-1/2

'
                  >
                    <span
                      className='
    relative
    inline-block
    w-14 sm:w-16 md:w-20
    aspect-[3/2]
  '
                    >
                      <img
                        src='/images/onboarding/greycover.png'
                        alt=''
                        className='w-full h-full object-contain block'
                      />
                      <span
                        className='
      absolute inset-0
      flex items-center justify-center
      text-white
      text-xs sm:text-sm
    '
                      >
                        with
                      </span>
                    </span>
                  </span>
                </span>
                you
              </h1>
              <button
                className='mt-8 md:mt-12 bg-slate-500 hover:bg-slate-600 active:scale-95 text-white font-medium py-3 px-8 rounded-xl inline-flex justify-center items-center gap-2 transition-all duration-300 transform hover:shadow-lg hover:-translate-y-1 focus:outline-none'
                onClick={nextStep}
                data-track-category='Onboarding'
                data-track-name='GetStarted'
              >
                <div className='text-sm md:text-base font-sans leading-4'>Get Started -&gt;</div>
              </button>
            </div>
          </div>
        );

      case 'channels':
        return (
          <div className='w-full h-screen flex items-center justify-center bg-background'>
            <div className='flex flex-col items-center text-center gap-10'>
              {/* Title */}
              <div
                className='
            text-3xl font-medium text-foreground max-w-3xl
            opacity-0 translate-y-6
            animate-[fadeUp_.6s_ease-out_forwards]
          '
              >
                We found some channels that you&apos;d be a part of
              </div>

              {/* Channels List */}
              <div className='w-full max-w-80 md:max-w-md flex flex-col justify-start items-center gap-6'>
                {hasMigratedChannels &&
                  migratedChannels?.slice(0, 5).map(channel => (
                    <div key={channel.id} className='w-full flex items-center'>
                      {/* Channel Icon */}
                      <div className='w-3 h-3 relative overflow-hidden flex-shrink-0'>
                        <div className='w-2 h-0 left-[2px] top-[4.50px] absolute outline outline-1 outline-offset-[-0.50px] outline-gray-900' />
                        <div className='w-2 h-0 left-[2px] top-[7.50px] absolute outline outline-1 outline-offset-[-0.50px] outline-gray-900' />
                        <div className='w-px h-2 left-[4px] top-[1.50px] absolute outline outline-1 outline-offset-[-0.50px] outline-gray-900' />
                        <div className='w-px h-2 left-[7px] top-[1.50px] absolute outline outline-1 outline-offset-[-0.50px] outline-gray-900' />
                      </div>
                      {/* Channel Name */}
                      <div className='flex-1 py-0.5'>
                        <div className='text-foreground text-base font-semibold font-sans leading-5'>
                          {channel.name}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Continue Button */}
              <button
                onClick={nextStep}
                className='
            w-16 h-16 rounded-full bg-neutral-900/5
            transition hover:bg-neutral-900/10 active:scale-90
            focus:outline-none
          '
                data-track-category='Onboarding'
                data-track-name='ContinueStep'
              >
                -&gt;
              </button>
            </div>
          </div>
        );

      case 'localHarness':
        return <LocalHarnessOnboardingStep installations={localHarnesses} onNext={nextStep} />;

      case 'profile':
        return (
          <div className='relative w-full min-h-screen bg-background overflow-hidden flex items-center justify-center px-4 sm:px-8'>
            {/* Confetti */}
            {showConfetti && (
              <Confetti
                width={window.innerWidth}
                height={window.innerHeight}
                numberOfPieces={160}
                gravity={0.35}
                recycle={false}
              />
            )}

            {/* soft background glow */}
            <div className='absolute top-[-20rem] left-1/2 -translate-x-1/2 w-[60vw] h-[60vw] bg-background rounded-full blur-[90px] pointer-events-none' />

            <div className='relative w-full mx-auto flex flex-col items-center gap-12'>
              {/* TITLE & BUTTON */}
              <div
                className={`
            flex flex-col items-center text-center gap-6
            transition-all duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)]
            ${profileAnim ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'}
          `}
              >
                <h1 className='text-2xl sm:text-3xl font-medium text-foreground'>{step.title}</h1>

                <button
                  onClick={handleCompleteOnboarding}
                  disabled={isCompleting}
                  className='h-10 px-6 rounded-xl bg-slate-500 text-white text-sm font-medium transition hover:bg-slate-600 disabled:opacity-60 inline-flex items-center gap-2 focus:outline-none'
                  data-track-category='Onboarding'
                  data-track-name='OpenWorkspace'
                >
                  {isCompleting ? 'Completing...' : 'Open My Workspace'}
                  <span
                    className={`
                inline-block transition-transform duration-500 ease-out
                ${profileAnim ? 'rotate-0' : 'rotate-45'}
              `}
                  >
                    →
                  </span>
                </button>
              </div>

              {/* PROFILE CARD */}
              <div className='flex justify-center'>
                <div
                  className={`
              relative w-[300px]
              transition-all duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)]
              ${
                profileAnim
                  ? 'translate-y-0 scale-100 rotate-0 opacity-100'
                  : 'translate-y-20 scale-95 -rotate-6 opacity-0'
              }
            `}
                >
                  <div className='bg-background/60 backdrop-blur rounded-[30px] shadow-xl overflow-hidden rotate-[-2deg]'>
                    {/* Avatar */}
                    <div className='relative w-full aspect-square overflow-hidden rounded-t-[30px]'>
                      {pictureUrl ? (
                        <img
                          src={pictureUrl}
                          alt='User avatar'
                          className='w-full h-full object-cover'
                        />
                      ) : (
                        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-400 to-purple-600'>
                          <span className='text-6xl font-bold text-white'>
                            {user?.name?.[0]?.toUpperCase() || 'U'}
                          </span>
                        </div>
                      )}

                      {/* Joined badge */}
                      <div className='absolute top-4 right-4 px-3 py-1 bg-background/70 backdrop-blur rounded-full text-xs font-medium text-foreground'>
                        {user?.createdAt
                          ? `Joined ${new Date(user.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              year: 'numeric',
                            })}`
                          : 'Joined recently'}
                      </div>
                    </div>

                    {/* User info */}
                    <div className='px-4 py-5 text-center space-y-1'>
                      <div className='text-base font-semibold text-foreground truncate'>
                        {user?.name || 'User'}
                      </div>
                      <div className='text-xs text-muted-foreground break-all'>
                        {user?.email || 'user@example.com'}
                      </div>
                    </div>

                    <div className='h-px bg-border mx-4' />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div
            key={currentStep}
            className='w-full h-screen flex items-center justify-center bg-background'
          >
            <div className='flex flex-col items-center text-center gap-10'>
              <div
                className={`
            text-3xl font-medium text-foreground max-w-2xl
            opacity-0
            ${step.animation === 'fadeLeft' ? 'translate-x-8 animate-[fadeLeft_.6s_ease-out_forwards]' : 'translate-y-6 animate-[fadeUp_.6s_ease-out_forwards]'}
          `}
              >
                {step.title}
              </div>

              <button
                onClick={nextStep}
                className='
            w-16 h-16 rounded-full bg-neutral-900/5
            transition hover:bg-neutral-900/10 active:scale-90
            focus:outline-none
          '
                data-track-category='Onboarding'
                data-track-name='ContinueDefaultStep'
              >
                -&gt;
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className='relative w-full h-screen bg-background overflow-hidden flex items-center justify-center'>
      {renderStep()}
    </div>
  );
};

export default OnboardingScreen;
