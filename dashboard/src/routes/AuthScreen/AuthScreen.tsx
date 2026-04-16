import { ReactElement, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ElectronEnrollmentSteps } from '../../components/Auth/ElectronEnrollmentSteps';
import { indexedDBService } from '../../services/indexedDBService';
import GoogleLogo from '../../assets/icons/GoogleLogo';
import { MicrosoftLogo } from '../../assets/icons/MicrosoftLogo';
import { Loader2 } from 'lucide-react';
import { ShineBorder } from '../../components/ui/shine-border';
import { ThemeProvider } from '@juspay/blend-design-system';
import { reactNativeBridge } from '../../utils/reactNativeBridge';

/**
 * AuthScreen - Mobile-Responsive Login Page with Modern Design
 *
 * Features:
 * - Fully responsive design following industry standards
 * - Mobile (< 1024px): Full-width login form with centered logo
 * - Desktop (>= 1024px): Two equal-width sections (50/50 split)
 * - Left section (desktop only): Branding, tagline, and features
 * - Right section: Login form with Google OAuth
 * - Background image with gradient overlay and fixed attachment
 * - Touch-friendly targets (min 44px height)
 * - Optimized text sizing for all screen sizes
 * - Uses Juspay Blend Design System
 * - Modern, minimalist design with Xyne branding
 * - Smooth transitions and hover states
 */
const AuthScreen = (): ReactElement => {
  const { isAuthenticated, isLoading, error, signInWithGoogle, signInWithMicrosoft, clearError } =
    useAuth();
  const [searchParams] = useSearchParams();
  const [isEnrollmentFlow, setIsEnrollmentFlow] = useState(false);

  useEffect(() => {
    const param = searchParams.get('enrollment_success');
    const wasCompleted = localStorage.getItem('enrollment_completed') === 'true';

    if (param === 'true') {
      localStorage.setItem('enrollment_completed', 'true');
    }

    if (param === 'true' || wasCompleted) {
      setIsEnrollmentFlow(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.removeItem('enrollment_completed');
    } else {
      void indexedDBService.dropAllUserDatabases();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return;
    }
    const path = `${location.pathname}${location.search}${location.hash}`;
    reactNativeBridge.notifyRouteReady(path);
  }, [location]);

  const handleGoogleSignIn = (): void => {
    clearError();
    signInWithGoogle();
  };

  const handleMicrosoftSignIn = (): void => {
    clearError();
    signInWithMicrosoft();
  };

  if (isAuthenticated) {
    return <Navigate to='/' replace={true}></Navigate>;
  }

  const googleSignInButton = (
    <div className='relative rounded-md overflow-hidden max-w-[280px]'>
      <button
        className="w-full gap-3 text-base h-9 font-medium inline-flex items-center justify-center whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 rounded-md px-6 has-[>svg]:px-4"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        data-track-category='Auth'
        data-track-name='GoogleSignIn'
      >
        <>
          <GoogleLogo />
          Sign in with Google
        </>
      </button>
      <ShineBorder shineColor={['hsl(var(--action-primary))']} />
    </div>
  );

  return (
    <ThemeProvider>
      <div className='min-h-screen w-full overflow-x-hidden overflow-y-auto relative bg-background'>
        <div className='min-h-screen w-full flex flex-col items-stretch'>
          <div
            className='w-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 min-h-screen py-8 sm:py-10 md:py-12 relative z-10'
            role='main'
            aria-label='Login form'
          >
            <div className='w-full max-w-xl flex flex-col justify-center gap-8 backdrop-blur-xl'>
              {/* Welcome Header */}
              {isEnrollmentFlow ? (
                <div className='w-full'>
                  <ElectronEnrollmentSteps
                    currentStep={2}
                    enrollmentComponent={googleSignInButton}
                  />
                </div>
              ) : (
                <div className='text-center flex flex-col justify-center items-center gap-1.5 sm:gap-2 md:gap-3'>
                  <div className='mb-8'>
                    <img src='/svgs/xyne.svg' alt='Xyne Logo' />
                  </div>
                  <h2 className='text-lg lg:text-xl font-medium md:font-semibold text-foreground'>
                    Log in to Xyne Spaces
                  </h2>
                  <p className='text-xs sm:text-sm md:text-sm text-muted-foreground'>
                    {isLoading
                      ? 'Signing you in...'
                      : 'Communicate, collaborate & 10x your daily productivity'}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div
                  className='max-h-24 overflow-y-auto rounded-lg border border-destructive/20 bg-destructive/10 p-3 sm:p-4'
                  role='alert'
                  aria-live='assertive'
                >
                  <p className='text-sm sm:text-base text-destructive break-words'>{error}</p>
                </div>
              )}

              {/* Login Section */}
              {!isLoading ? (
                !isEnrollmentFlow && (
                  <div className='flex flex-col justify-center items-center'>
                    {/* Google Sign In Button */}
                    <div className='w-full max-w-[280px] md:max-w-[320px]'>
                      <button
                        disabled={isLoading}
                        onClick={handleGoogleSignIn}
                        className='relative flex h-12 w-full items-center justify-center gap-4 overflow-hidden rounded-[10px] border border-border bg-card px-4 py-[9px] font-inherit text-foreground shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50'
                        data-track-category='Auth'
                        data-track-name='GoogleSignIn'
                      >
                        <span
                          data-button-left-slot='true'
                          className='flex items-center justify-center'
                        >
                          <GoogleLogo />
                        </span>
                        <span className='text-sm font-semibold text-center text-foreground'>
                          Sign in with Google
                        </span>
                      </button>
                    </div>

                    {/* Microsoft Sign In Button */}
                    <div className='w-full max-w-[280px] md:max-w-[320px] mt-3'>
                      <button
                        disabled={isLoading}
                        onClick={handleMicrosoftSignIn}
                        className='relative flex h-12 w-full items-center justify-center gap-4 overflow-hidden rounded-[10px] border border-border bg-secondary px-4 py-[9px] font-inherit text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50'
                        data-track-category='Auth'
                        data-track-name='MicrosoftSignIn'
                      >
                        <span
                          data-button-left-slot='true'
                          className='flex items-center justify-center'
                        >
                          <MicrosoftLogo />
                        </span>
                        <span className='text-sm font-semibold text-center text-secondary-foreground'>
                          Sign in with Microsoft
                        </span>
                      </button>
                    </div>
                  </div>
                )
              ) : (
                /* Loading State */
                <div
                  className='flex flex-col items-center justify-center py-10 sm:py-12 md:py-16 space-y-5 sm:space-y-6'
                  role='status'
                  aria-live='polite'
                >
                  <div className='relative' aria-hidden='true'>
                    <Loader2
                      className='h-12 w-12 sm:h-14 sm:w-14 animate-spin text-action-primary'
                      aria-hidden='true'
                    />
                    <div className='absolute inset-0 rounded-full bg-action-primary/20 animate-ping'></div>
                  </div>
                  <div className='text-center space-y-2'>
                    <p className='text-lg sm:text-xl font-semibold text-foreground'>
                      Signing you in...
                    </p>
                    <p className='text-sm sm:text-base text-muted-foreground'>
                      Please wait while we authenticate your account
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className='text-center pt-2 absolute bottom-16 w-full'>
          <p className='text-xs sm:text-sm text-muted-foreground'>
            &copy; {new Date().getFullYear()} Xyne Spaces. All rights reserved.
          </p>
        </div>
      </div>
    </ThemeProvider>
  );
};

export default AuthScreen;
