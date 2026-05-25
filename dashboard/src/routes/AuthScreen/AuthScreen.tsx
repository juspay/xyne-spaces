import { ReactElement, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import Cookies from 'js-cookie';
import { useAuth } from '../../hooks/useAuth';
import { useOAuthProviders } from '../../hooks/useOAuthProviders';
import { ElectronEnrollmentSteps } from '../../components/Auth/ElectronEnrollmentSteps';
import { indexedDBService } from '../../services/indexedDBService';
import GoogleLogo from '../../assets/icons/GoogleLogo';
import { MicrosoftLogo } from '../../assets/icons/MicrosoftLogo';
import { Loader2, Building2, ArrowRight } from 'lucide-react';
import { ShineBorder } from '../../components/ui/shine-border';
import { ThemeProvider } from '@juspay/blend-design-system';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { usePlatform } from '../../hooks/usePlatform';

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
  const {
    isAuthenticated,
    isLoading,
    error,
    signInWithGoogle,
    clearError,
    selectWorkspace,
    createOrg,
    workspaces,
    isSelectingWorkspace,
    isCreatingOrg,
    isLoggingInToWorkspace,
    user,
    userExistsButRemoved,
    signInWithMicrosoft,
    logout,
  } = useAuth();
  const { data: providers } = useOAuthProviders();
  const [searchParams] = useSearchParams();
  const [isEnrollmentFlow, setIsEnrollmentFlow] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [showCreateOrgForm, setShowCreateOrgForm] = useState(false);
  const orgNameInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

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

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      orgNameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [showCreateOrgForm, isCreatingOrg, isMobile]);

  const handleGoogleSignIn = (): void => {
    clearError();
    signInWithGoogle();
  };

  const handleMicrosoftSignIn = (): void => {
    clearError();
    signInWithMicrosoft();
  };

  const handleSelectWorkspace = (workspaceId: string): void => {
    selectWorkspace(workspaceId);
  };

  const handleTryDifferentAccount = (): void => {
    logout();
    window.location.reload();
  };

  const handleCreateOrg = (e: React.FormEvent): void => {
    e.preventDefault();
    if (orgName.trim() && workspaceName.trim()) {
      createOrg(orgName.trim(), workspaceName.trim());
    }
  };

  if (isAuthenticated) {
    const dest = user?.workspaceId ? `/${user.workspaceId}` : '/';
    return <Navigate to={dest} replace={true}></Navigate>;
  }

  const pendingInvitationId =
    localStorage.getItem('pending_invitation_id') ?? Cookies.get('pending_invitation_id');
  if (pendingInvitationId && (isSelectingWorkspace || isCreatingOrg)) {
    return (
      <Navigate
        to={`/invite?invitationId=${encodeURIComponent(pendingInvitationId)}&loginComplete=true`}
        replace={true}
      />
    );
  }

  if (isCreatingOrg && !userExistsButRemoved) {
    sessionStorage.setItem('no_access_from_auth', '1');
    return <Navigate to='/no-access' replace={true} />;
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
                  <p className='text-xs sm:text-sm md:text-sm text-muted-foreground pb-4'>
                    {isLoading
                      ? 'Signing you in...'
                      : 'Communicate, collaborate & 10x your daily productivity'}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div
                  className='p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg max-h-24 overflow-y-auto'
                  role='alert'
                  aria-live='assertive'
                >
                  <p className='text-sm sm:text-base text-red-600 break-words'>{error}</p>
                </div>
              )}

              {/* Workspace Selection */}
              {isSelectingWorkspace && (
                <div className='flex flex-col gap-6'>
                  <div className='text-center'>
                    <h3 className='text-lg font-semibold text-foreground'>Select Workspace</h3>
                    <p className='text-sm text-muted-foreground mt-1'>
                      Choose a workspace to continue
                    </p>
                  </div>

                  <div className='flex flex-col gap-3 max-h-64 overflow-y-auto'>
                    {workspaces.map(workspace => (
                      <button
                        key={workspace.id}
                        onClick={() => handleSelectWorkspace(workspace.id)}
                        className='flex items-center gap-3 p-4 border border-border rounded-lg hover:border-blue-500 hover:bg-accent transition-all text-left'
                        data-track-category='Auth'
                        data-track-name='SelectWorkspace'
                        data-track-metadata={JSON.stringify({ workspaceId: workspace.id })}
                      >
                        <div className='w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center'>
                          <Building2 className='w-5 h-5 text-blue-600' />
                        </div>
                        <div className='flex-1'>
                          <p className='font-medium text-foreground'>{workspace.name}</p>
                          <p className='text-xs text-muted-foreground capitalize'>
                            {workspace.role}
                          </p>
                        </div>
                        <ArrowRight className='w-5 h-5 text-slate-400' />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* User was removed from all workspaces - cannot create org */}
              {isCreatingOrg && userExistsButRemoved && (
                <div className='flex flex-col gap-4'>
                  <div className='p-4 bg-amber-50 border border-amber-200 rounded-lg text-center'>
                    <h3 className='text-base font-semibold text-amber-800 mb-2'>
                      No Workspace Access
                    </h3>
                    <p className='text-sm text-amber-700'>
                      Your account exists but you don&apos;t have access to any workspaces.
                    </p>
                    <p className='text-sm text-amber-700 mt-2'>
                      Please check with your <span className='font-medium'>Organization Admin</span>{' '}
                      to get access to a workspace.
                    </p>
                  </div>

                  <button
                    type='button'
                    onClick={handleTryDifferentAccount}
                    className='text-sm text-muted-foreground hover:text-foreground text-center cursor-pointer'
                    data-track-category='Auth'
                    data-track-name='TryDifferentAccount'
                  >
                    Try with a different account
                  </button>
                </div>
              )}

              {/* Create Organization Form - only for new users */}
              {((isCreatingOrg && !userExistsButRemoved) || showCreateOrgForm) && (
                <form onSubmit={handleCreateOrg} className='flex flex-col gap-4'>
                  <div className='text-center'>
                    <h3 className='text-lg font-semibold text-foreground'>Create Organization</h3>
                    <p className='text-sm text-muted-foreground mt-1'>Set up your new workspace</p>
                  </div>

                  {/* Duplicate Name Error Alert */}
                  {error?.toLowerCase().includes('already exists') && (
                    <div className='p-3 bg-amber-50 border border-amber-200 rounded-lg'>
                      <p className='text-sm text-amber-700'>
                        <span className='font-medium'>Organization name taken.</span> Please choose
                        a different name.
                      </p>
                    </div>
                  )}

                  <div className='flex flex-col gap-3'>
                    <div>
                      <label
                        htmlFor='orgName'
                        className='text-sm font-medium text-foreground mb-1 block'
                      >
                        Organization Name
                      </label>
                      <input
                        id='orgName'
                        type='text'
                        value={orgName}
                        ref={orgNameInputRef}
                        onChange={e => {
                          setOrgName(e.target.value);
                          if (error?.toLowerCase().includes('already exists')) {
                            clearError();
                          }
                        }}
                        placeholder='Juspay Inc'
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-background text-foreground ${
                          error?.toLowerCase().includes('already exists')
                            ? 'border-amber-400 focus:ring-amber-500'
                            : 'border-border focus:ring-blue-500'
                        }`}
                        required
                        data-track-category='Auth'
                        data-track-name='OrgNameInput'
                      />
                      {error?.toLowerCase().includes('already exists') && (
                        <p className='text-xs text-amber-600 mt-1'>
                          Try adding your team name or a unique identifier
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor='workspaceName'
                        className='text-sm font-medium text-foreground mb-1 block'
                      >
                        Workspace Name
                      </label>
                      <input
                        id='workspaceName'
                        type='text'
                        value={workspaceName}
                        onChange={e => setWorkspaceName(e.target.value)}
                        placeholder='Engineering'
                        className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground'
                        required
                        data-track-category='Auth'
                        data-track-name='WorkspaceNameInput'
                      />
                    </div>
                  </div>

                  <button
                    type='submit'
                    disabled={isLoading || !orgName.trim() || !workspaceName.trim()}
                    className='w-full py-2.5 bg-black text-white font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                    data-track-category='Auth'
                    data-track-name='CreateOrganization'
                  >
                    {isLoading ? 'Creating...' : 'Create Organization'}
                  </button>

                  {workspaces.length > 0 && (
                    <button
                      type='button'
                      onClick={() => setShowCreateOrgForm(false)}
                      className='text-sm text-muted-foreground hover:text-foreground'
                      data-track-category='Auth'
                      data-track-name='BackToWorkspaceSelection'
                    >
                      Back to workspace selection
                    </button>
                  )}
                </form>
              )}

              {/* Login Section */}
              {!isLoading && !isSelectingWorkspace && !isCreatingOrg && !showCreateOrgForm
                ? !isEnrollmentFlow && (
                    <div className='flex flex-col gap-3 items-center'>
                      {/* Google Sign In Button */}
                      <div className='w-full max-w-[280px] md:max-w-[320px]'>
                        <button
                          disabled={isLoading}
                          onClick={handleGoogleSignIn}
                          className='appearance-none outline-none font-inherit cursor-pointer opacity-100 flex items-center justify-center gap-4 px-4 py-[9px] w-full relative bg-[#2F2F2F] text-white border border-white/10 rounded-[10px] overflow-hidden h-12'
                          data-track-category='Auth'
                          data-track-name='GoogleSignIn'
                        >
                          <span
                            data-button-left-slot='true'
                            className='flex items-center justify-center'
                          >
                            <GoogleLogo />
                          </span>
                          <span className='text-sm font-semibold text-center text-white'>
                            Sign in with Google
                          </span>
                        </button>
                      </div>
                      {/* Microsoft Sign In Button */}
                      {providers?.microsoft && (
                        <div className='w-full max-w-[280px] md:max-w-[320px]'>
                          <button
                            disabled={isLoading}
                            onClick={handleMicrosoftSignIn}
                            className='appearance-none outline-none font-inherit cursor-pointer opacity-100 flex items-center justify-center gap-4 px-4 py-[9px] w-full relative bg-[#2F2F2F] text-white border border-white/10 rounded-[10px] overflow-hidden h-12'
                            data-track-category='Auth'
                            data-track-name='MicrosoftSignIn'
                          >
                            <span
                              data-button-left-slot='true'
                              className='flex items-center justify-center'
                            >
                              <MicrosoftLogo />
                            </span>
                            <span className='text-sm font-semibold text-center text-white'>
                              Sign in with Microsoft
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )
                : /* Loading State */
                  (isLoading || isLoggingInToWorkspace) && (
                    <div
                      className='flex flex-col items-center justify-center py-10 sm:py-12 md:py-16 space-y-5 sm:space-y-6'
                      role='status'
                      aria-live='polite'
                    >
                      <div className='relative' aria-hidden='true'>
                        <Loader2
                          className='h-12 w-12 sm:h-14 sm:w-14 animate-spin text-blue-600'
                          aria-hidden='true'
                        />
                        <div className='absolute inset-0 rounded-full bg-blue-600/20 animate-ping'></div>
                      </div>
                      <div className='text-center space-y-2'>
                        <p className='text-lg sm:text-xl font-semibold text-foreground'>
                          {isLoggingInToWorkspace
                            ? 'Logging into workspace...'
                            : 'Signing you in...'}
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
