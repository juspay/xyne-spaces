import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ReactElement } from 'react';
import { Event } from '../../utils/logger';
import { useLoadingAnimationLog } from '../../hooks/useLoadingAnimationLog';
import { usePlatform } from '../../hooks/usePlatform';

const SplashScreen = (): ReactElement => {
  const { isLoading, isAuthenticated, signInWithGoogle, state } = useAuth();
  const { isElectron } = usePlatform();

  if (isLoading) {
    const isElectronAuthLoading = isElectron && !isAuthenticated && state === 'authenticating';
    return (
      <SplashLoadingScreen
        isElectronAuthLoading={isElectronAuthLoading}
        onRetry={signInWithGoogle}
      />
    );
  }
  return <Outlet></Outlet>;
};

interface SplashLoadingScreenProps {
  isElectronAuthLoading: boolean;
  onRetry: () => void;
}

const SplashLoadingScreen = ({
  isElectronAuthLoading,
  onRetry,
}: SplashLoadingScreenProps): ReactElement => {
  const location = useLocation();

  useLoadingAnimationLog({
    event: Event.SPLASH_SCREEN_HIDDEN,
    source: 'splash_screen',
    message: 'splash screen loading',
    url: location.pathname,
  });

  if (isElectronAuthLoading) {
    return (
      <div className='min-h-screen w-full overflow-x-hidden overflow-y-auto relative bg-background'>
        <div className='min-h-screen w-full flex flex-col items-stretch'>
          <div className='w-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 min-h-screen py-8 sm:py-10 md:py-12 relative z-10'>
            <div className='w-full max-w-xl flex flex-col justify-center gap-4 backdrop-blur-xl'>
              <div className='text-center flex flex-col justify-center items-center gap-1.5 sm:gap-2 md:gap-3'>
                <div className='mb-4'>
                  <img src='/svgs/xyne.svg' alt='Xyne Logo' />
                </div>
              </div>

              <div className='w-full bg-background px-8 py-10 text-center'>
                <div className='mb-6 flex justify-center'>
                  <XyneLoader />
                </div>

                <h1 className='text-lg lg:text-xl font-medium md:font-semibold text-foreground'>
                  Complete sign-in in your browser
                </h1>
                <p className='mt-3 text-sm sm:text-base leading-6 text-muted-foreground'>
                  Finish Google sign-in in your browser, then return to the app. If the browser
                  didn&apos;t open or was closed,{' '}
                  <button
                    onClick={onRetry}
                    className='inline cursor-pointer border-none bg-transparent p-0 text-sm sm:text-base font-medium text-primary underline underline-offset-4'
                    data-track-category='Auth'
                    data-track-name='ElectronRetrySignIn'
                  >
                    Retry sign-in
                  </button>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen w-full overflow-x-hidden overflow-y-auto relative bg-background'>
      <div className='flex min-h-screen items-center justify-center px-6 py-12'>
        <div className='w-full max-w-md text-center'>
          <div className='mb-8 flex justify-center'>
            <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-5 w-auto' />
          </div>

          <div className='mt-10 flex flex-col items-center gap-5'>
            <XyneLoader />
            <p className='text-sm sm:text-base text-muted-foreground'>
              Getting Xyne Spaces ready...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const XyneLoader = (): ReactElement => {
  return (
    <div
      className='flex h-16 w-16 items-center justify-center rounded-full bg-muted'
      aria-hidden='true'
    >
      <div className='h-10 w-10 rounded-full border-[3px] border-primary/25 border-t-primary animate-spin'></div>
    </div>
  );
};

export default SplashScreen;
