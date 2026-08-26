import { ReactElement, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import Cookies from 'js-cookie';
import { AxiosError } from 'axios';
import { apiInstance } from '../../services/clients/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { useOAuthProviders } from '../../hooks/useOAuthProviders';
import { ElectronEnrollmentSteps } from '../../components/Auth/ElectronEnrollmentSteps';
import GoogleLogo from '../../assets/icons/GoogleLogo';
import { MicrosoftLogo } from '../../assets/icons/MicrosoftLogo';
import { Loader2, Building2, ArrowRight } from 'lucide-react';
import { ShineBorder } from '../../components/ui/shine-border';
import { ThemeProvider } from '@juspay/blend-design-system';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { usePlatform } from '../../hooks/usePlatform';
import { PENDING_WORKSPACE_ID_KEY, PENDING_WORKSPACE_NAME_KEY } from '../../machines/authMachine';
import { WorkspaceType } from '@xyne/shared';
import { getPendingSdkSso, clearPendingSdkSso } from '../SdkSsoAuthorizeScreen';

interface CommunityWorkspaceListItem {
  id: string;
  name: string;
}

interface CommunityWorkspaceOrganization {
  workspaces: CommunityWorkspaceListItem[];
}

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
const AuthScreen = (): ReactElement | null => {
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
    signInWithEmail,
    registerWithEmail,
    verifyEmailCode,
    resendVerificationCode,
    communityJoinRequest,
    enterpriseJoinTarget,
  } = useAuth();
  const navigate = useNavigate();
  const { data: providers } = useOAuthProviders();
  const [searchParams] = useSearchParams();
  const [isEnrollmentFlow, setIsEnrollmentFlow] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [showCreateOrgForm, setShowCreateOrgForm] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingCommunityWorkspaceName, setPendingCommunityWorkspaceName] = useState<string | null>(
    () => localStorage.getItem(PENDING_WORKSPACE_NAME_KEY),
  );
  const [isRequestingEnterpriseJoin, setIsRequestingEnterpriseJoin] = useState(false);
  const [enterpriseJoinRequestMessage, setEnterpriseJoinRequestMessage] = useState('');
  const [enterpriseJoinRequestError, setEnterpriseJoinRequestError] = useState('');
  const [newEnterpriseWorkspaceName, setNewEnterpriseWorkspaceName] = useState('');
  const [isCreatingEnterpriseWorkspace, setIsCreatingEnterpriseWorkspace] = useState(false);
  const [createEnterpriseWorkspaceError, setCreateEnterpriseWorkspaceError] = useState('');
  const orgNameInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();
  const isOrganizationNameTakenError =
    error?.toLowerCase().includes('organization with name') ||
    error?.toLowerCase().includes('organization name already exists');
  const isOrganizationDomainConflictError = error
    ?.toLowerCase()
    .includes('organization already exists for');
  const isPublicEmailDomainError = error?.toLowerCase().includes('public email domains');

  // Forgot password flow
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [fpEmail, setFpEmail] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpNewPassword, setFpNewPassword] = useState('');
  const [fpConfirmPassword, setFpConfirmPassword] = useState('');
  const [fpStep, setFpStep] = useState<'email' | 'code' | 'success'>('email');
  const [fpError, setFpError] = useState('');
  const [fpMessage, setFpMessage] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const fpSubmitLockRef = useRef(false);

  // Registration flow
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regStep, setRegStep] = useState<'register' | 'verify'>('register');
  const [regError, setRegError] = useState('');
  const [regMessage, setRegMessage] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regCode, setRegCode] = useState('');
  const [regNameError, setRegNameError] = useState('');
  const [regEmailError, setRegEmailError] = useState('');
  const [regPasswordError, setRegPasswordError] = useState('');
  const [regConfirmPasswordError, setRegConfirmPasswordError] = useState('');
  const regSubmitLockRef = useRef(false);

  const NAME_REGEX = /^[a-zA-Z][a-zA-Z\s]*$/;
  const EMAIL_VALIDATION_REGEX =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  const validateRegName = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return 'Name is required';
    if (!NAME_REGEX.test(trimmed)) return 'Name can only contain alphabets and spaces';
    return '';
  };

  const validateRegEmail = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return 'Email is required';
    if (!EMAIL_VALIDATION_REGEX.test(trimmed)) return 'Invalid email address';
    return '';
  };

  const validateRegPassword = (value: string): string => {
    if (!value) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value))
      return 'Password must include at least one uppercase letter, one number, and one special character';
    return '';
  };

  const validateRegConfirmPassword = (value: string): string => {
    if (!value) return 'Please confirm your password';
    if (value !== regPassword) return 'Passwords do not match';
    return '';
  };

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
    const pendingWorkspaceId = searchParams.get('workspaceId')?.trim();
    if (!pendingWorkspaceId) return;
    localStorage.setItem(PENDING_WORKSPACE_ID_KEY, pendingWorkspaceId);
    localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
    setPendingCommunityWorkspaceName(null);
  }, [searchParams]);

  useEffect(() => {
    const pendingWorkspaceId =
      searchParams.get('workspaceId')?.trim() ||
      localStorage.getItem(PENDING_WORKSPACE_ID_KEY)?.trim();

    if (!pendingWorkspaceId) {
      localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
      setPendingCommunityWorkspaceName(null);
      return;
    }

    let isCancelled = false;

    apiInstance
      .get<{ organizations: CommunityWorkspaceOrganization[] }>('/community/workspaces')
      .then(response => {
        if (isCancelled) return;
        const communityWorkspace = (response.data.organizations || [])
          .flatMap(org => org.workspaces)
          .find(workspace => workspace.id === pendingWorkspaceId);

        if (communityWorkspace) {
          localStorage.setItem(PENDING_WORKSPACE_NAME_KEY, communityWorkspace.name);
          setPendingCommunityWorkspaceName(communityWorkspace.name);
          return;
        }

        localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
        setPendingCommunityWorkspaceName(null);
      })
      .catch(() => {
        if (isCancelled) return;
        localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
        setPendingCommunityWorkspaceName(null);
      });

    return (): void => {
      isCancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.removeItem('enrollment_completed');
    }
  }, [isAuthenticated]);

  const location = useLocation();
  useEffect(() => {
    if (!reactNativeBridge.isAvailable()) {
      return;
    }
    const path = `${location.pathname}${location.search}${location.hash}`;
    reactNativeBridge.notifyRouteReady(path);
  }, [location]);

  // Redirect multi-workspace selection to the dedicated workspace hub
  useEffect(() => {
    if (isSelectingWorkspace && workspaces.length > 0 && !isAuthenticated) {
      void navigate('/workspaces', {
        replace: true,
        state: {
          workspaces,
          email: user?.email ?? '',
          name: user?.name ?? '',
          picture: user?.picture ?? '',
        },
      });
    }
  }, [isSelectingWorkspace, workspaces, isAuthenticated, user, navigate]);

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      orgNameInputRef.current?.focus();
    });
    return (): void => cancelAnimationFrame(rafId);
  }, [showCreateOrgForm, isCreatingOrg, isMobile]);

  useEffect(() => {
    if (!error) {
      return;
    }

    setShowForgotPassword(false);
    setShowEmailForm(true);
  }, [error]);

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

  const handleRequestEnterpriseJoin = async (
    workspaceId: string,
    workspaceName: string,
  ): Promise<void> => {
    setIsRequestingEnterpriseJoin(true);
    setEnterpriseJoinRequestMessage('');
    setEnterpriseJoinRequestError('');
    try {
      const response = await apiInstance.post<{
        joinRequest?: { isExisting?: boolean; status?: string };
      }>(`/community/${workspaceId}/join`, {
        workspaceType: WorkspaceType.ENTERPRISE,
      });
      const isExisting = response.data.joinRequest?.isExisting;
      const requestStatus = response.data.joinRequest?.status;
      setEnterpriseJoinRequestMessage(
        requestStatus === 'APPROVED'
          ? `Your request to join ${workspaceName} is approved. Continue to Enterprise login.`
          : isExisting
            ? `Your request to join ${workspaceName} is already pending.`
            : `Your request to join ${workspaceName} has been submitted.`,
      );
    } catch (err) {
      if (err instanceof Error && err.message) {
        setEnterpriseJoinRequestError(err.message);
      } else {
        setEnterpriseJoinRequestError('Failed to request enterprise access.');
      }
    } finally {
      setIsRequestingEnterpriseJoin(false);
    }
  };

  const handleCreateEnterpriseWorkspace = async (): Promise<void> => {
    if (!newEnterpriseWorkspaceName.trim()) return;
    setIsCreatingEnterpriseWorkspace(true);
    setCreateEnterpriseWorkspaceError('');
    try {
      const res = await apiInstance.post<{ user: { workspaceId: string; id: string } }>(
        '/auth/create-workspace-pending',
        {
          workspaceName: newEnterpriseWorkspaceName.trim(),
          workspaceType: WorkspaceType.ENTERPRISE,
        },
      );
      const newWorkspaceId = res.data.user.workspaceId;
      localStorage.setItem('user_id', res.data.user.id);
      window.location.href = `/${newWorkspaceId}`;
    } catch (err) {
      if (err instanceof AxiosError) {
        const msg = (err.response?.data as { message?: string } | undefined)?.message;
        setCreateEnterpriseWorkspaceError(msg ?? 'Failed to create workspace.');
      } else {
        setCreateEnterpriseWorkspaceError('Failed to create workspace.');
      }
    } finally {
      setIsCreatingEnterpriseWorkspace(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    clearError();
    const invitationId =
      localStorage.getItem('pending_invitation_id')?.trim() ||
      searchParams.get('invitationId')?.trim() ||
      undefined;
    await signInWithEmail(email.trim(), password, invitationId);
  };

  const handleFpRequestCode = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (fpSubmitLockRef.current) {
      return;
    }

    fpSubmitLockRef.current = true;
    setFpError('');
    setFpMessage('');
    setFpLoading(true);
    try {
      await apiInstance.post(
        '/v2/auth/email/forgot-password',
        {
          email: fpEmail.trim(),
        },
        {
          timeout: 30000,
        },
      );
      setFpMessage('Code sent! Check your email.');
      setFpStep('code');
    } catch (err) {
      if (err instanceof Error && err.message) {
        setFpError(err.message);
      } else {
        setFpError('Failed to send code. Please try again.');
      }
    } finally {
      fpSubmitLockRef.current = false;
      setFpLoading(false);
    }
  };

  const handleFpResetPassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (fpSubmitLockRef.current) {
      return;
    }

    fpSubmitLockRef.current = true;
    setFpError('');
    const normalizedCode = fpCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(normalizedCode)) {
      setFpError('Enter a valid 6-digit code');
      fpSubmitLockRef.current = false;
      return;
    }
    if (fpNewPassword.length < 8) {
      setFpError('Password must be at least 8 characters');
      fpSubmitLockRef.current = false;
      return;
    }
    if (fpNewPassword !== fpConfirmPassword) {
      setFpError('Passwords do not match');
      fpSubmitLockRef.current = false;
      return;
    }
    setFpLoading(true);
    try {
      await apiInstance.post('/v2/auth/email/reset-password', {
        email: fpEmail.trim(),
        code: normalizedCode,
        newPassword: fpNewPassword,
      });
      setFpStep('success');
    } catch (err: unknown) {
      if (err instanceof Error && err.message) {
        setFpError(err.message);
      } else {
        setFpError('Failed to reset password. Please try again.');
      }
    } finally {
      fpSubmitLockRef.current = false;
      setFpLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (regSubmitLockRef.current) return;

    setRegError('');
    setRegMessage('');

    const nameErr = validateRegName(regName);
    const emailErr = validateRegEmail(regEmail);
    const passwordErr = validateRegPassword(regPassword);
    const confirmErr = validateRegConfirmPassword(regConfirmPassword);
    setRegNameError(nameErr);
    setRegEmailError(emailErr);
    setRegPasswordError(passwordErr);
    setRegConfirmPasswordError(confirmErr);
    if (nameErr || emailErr || passwordErr || confirmErr) return;

    const pendingWorkspaceId =
      searchParams.get('workspaceId')?.trim() ||
      localStorage.getItem(PENDING_WORKSPACE_ID_KEY)?.trim() ||
      undefined;
    const pendingInvitationId =
      localStorage.getItem('pending_invitation_id')?.trim() ||
      searchParams.get('invitationId')?.trim() ||
      undefined;

    regSubmitLockRef.current = true;
    setRegLoading(true);
    try {
      const result = await registerWithEmail(
        regEmail.trim(),
        regPassword,
        regName.trim(),
        pendingWorkspaceId,
        pendingInvitationId,
      );
      if (result.success) {
        setRegMessage(result.message || 'Verification code sent to your email.');
        setRegStep('verify');
      } else {
        setRegError(result.error || 'Registration failed');
      }
    } finally {
      regSubmitLockRef.current = false;
      setRegLoading(false);
    }
  };

  const handleRegVerify = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (regSubmitLockRef.current) return;

    setRegError('');
    const normalizedCode = regCode.replace(/\D/g, '');
    if (!/^\d{6}$/.test(normalizedCode)) {
      setRegError('Enter a valid 6-digit code');
      return;
    }

    regSubmitLockRef.current = true;
    setRegLoading(true);
    try {
      const result = await verifyEmailCode(regEmail.trim(), normalizedCode);
      // On success, OAUTH_CALLBACK_COMPLETE is dispatched to the auth machine,
      // which takes over navigation — joining the workspace (community OPEN,
      // community REQUEST_TO_JOIN, or enterprise) just like Google/Microsoft SSO.
      // No local step change needed; the auth machine will redirect.
      if (!result.success) {
        setRegError(result.error || 'Verification failed');
      }
    } finally {
      regSubmitLockRef.current = false;
      setRegLoading(false);
    }
  };

  const handleRegResendCode = async (): Promise<void> => {
    setRegError('');
    setRegMessage('');
    try {
      const result = await resendVerificationCode(regEmail.trim());
      if (result.success) {
        setRegMessage(result.message || 'A new verification code has been sent.');
      } else {
        setRegError(result.error || 'Failed to resend code');
      }
    } catch {
      setRegError('Failed to resend code. Please try again.');
    }
  };

  const resetRegistrationState = (): void => {
    setShowRegisterForm(false);
    setRegName('');
    setRegEmail('');
    setRegPassword('');
    setRegConfirmPassword('');
    setRegCode('');
    setRegStep('register');
    setRegError('');
    setRegMessage('');
    setRegNameError('');
    setRegEmailError('');
    setRegPasswordError('');
    setRegConfirmPasswordError('');
  };

  // Handle SDK SSO flow - redirect to authorize page after login (must be checked before workspace redirect)
  const pendingSdkSsoUserCode = getPendingSdkSso();
  if (isAuthenticated && pendingSdkSsoUserCode) {
    clearPendingSdkSso();
    return (
      <Navigate
        to={`/sdk-sso/authorize?user_code=${encodeURIComponent(pendingSdkSsoUserCode)}`}
        replace={true}
      />
    );
  }

  if (isAuthenticated) {
    const dest = user?.workspaceId ? `/${user.workspaceId}` : '/';
    return <Navigate to={dest} replace={true}></Navigate>;
  }

  if (communityJoinRequest) {
    return <Navigate to='/community' replace={true} />;
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

  // When the machine enters selectingWorkspace with workspaces, redirect to the
  // dedicated /workspaces screen. Return early so the old inline list never flashes.
  if (isSelectingWorkspace && workspaces.length > 0) {
    return null;
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
      <div className='h-[100dvh] w-full overflow-y-auto bg-background'>
        <div
          className='min-h-full w-full grid grid-rows-[1fr_auto]'
          role='main'
          aria-label='Login form'
        >
          <div className='flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 lg:p-12 py-8 sm:py-10 md:py-12'>
            <div className='w-full max-w-xl flex flex-col gap-8 backdrop-blur-xl'>
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
                  {pendingCommunityWorkspaceName ? (
                    <div className='mt-2 max-w-full rounded-lg border border-blue-100 bg-blue-50 px-4 py-2'>
                      <p className='max-w-[420px] whitespace-normal break-words text-sm font-semibold leading-snug text-blue-950'>
                        You will be joining {pendingCommunityWorkspaceName} Community
                      </p>
                    </div>
                  ) : null}
                  <p className='text-xs sm:text-sm md:text-sm text-muted-foreground pb-4'>
                    {isLoading
                      ? 'Signing you in...'
                      : 'Communicate, collaborate & 10x your daily productivity'}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error &&
                !(
                  isCreatingOrg &&
                  (isOrganizationDomainConflictError || isPublicEmailDomainError)
                ) && (
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

              {isCreatingOrg && isOrganizationDomainConflictError && (
                <div className='flex flex-col gap-4'>
                  <div className='p-4 bg-amber-50 border border-amber-200 rounded-lg text-center'>
                    <h3 className='text-base font-semibold text-amber-800 mb-2'>
                      Organization Already Exists
                    </h3>
                    <p className='text-sm text-amber-700'>{error}</p>
                  </div>

                  {enterpriseJoinRequestMessage ? (
                    <div className='rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center text-sm text-emerald-700'>
                      {enterpriseJoinRequestMessage}
                    </div>
                  ) : null}

                  {enterpriseJoinRequestError ? (
                    <div className='rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700'>
                      {enterpriseJoinRequestError}
                    </div>
                  ) : null}

                  {enterpriseJoinTarget?.workspaces?.length ? (
                    <div className='flex flex-col gap-2'>
                      <p className='text-sm font-medium text-foreground'>
                        Request access to a workspace in {enterpriseJoinTarget.orgName}:
                      </p>
                      <div className='flex flex-col gap-2 max-h-48 overflow-y-auto'>
                        {enterpriseJoinTarget.workspaces.map(ws => (
                          <div
                            key={ws.id}
                            className='flex items-center justify-between gap-3 p-3 border border-border rounded-lg'
                          >
                            <div className='flex items-center gap-2'>
                              <Building2 className='w-4 h-4 text-muted-foreground' />
                              <span className='text-sm font-medium text-foreground'>{ws.name}</span>
                            </div>
                            <button
                              type='button'
                              onClick={() => {
                                void handleRequestEnterpriseJoin(ws.id, ws.name);
                              }}
                              disabled={
                                isRequestingEnterpriseJoin || Boolean(enterpriseJoinRequestMessage)
                              }
                              className='text-xs font-medium px-3 py-1.5 rounded-md bg-black text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed'
                              data-track-category='Auth'
                              data-track-name='RequestEnterpriseWorkspaceAccess'
                              data-track-metadata={JSON.stringify({ workspaceId: ws.id })}
                            >
                              {isRequestingEnterpriseJoin ? '...' : 'Request to join'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className='border-t border-border pt-4'>
                    <p className='text-sm font-medium text-foreground mb-2'>
                      Or create a new workspace in{' '}
                      {enterpriseJoinTarget?.orgName ?? 'your organization'}:
                    </p>
                    {createEnterpriseWorkspaceError ? (
                      <div className='mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-center text-xs text-red-700'>
                        {createEnterpriseWorkspaceError}
                      </div>
                    ) : null}
                    <div className='flex gap-2'>
                      <input
                        type='text'
                        value={newEnterpriseWorkspaceName}
                        onChange={e => setNewEnterpriseWorkspaceName(e.target.value)}
                        placeholder='Workspace name'
                        className='flex-1 px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm'
                        data-track-category='Auth'
                        data-track-name='NewEnterpriseWorkspaceNameInput'
                      />
                      <button
                        type='button'
                        onClick={() => {
                          void handleCreateEnterpriseWorkspace();
                        }}
                        disabled={
                          isCreatingEnterpriseWorkspace || !newEnterpriseWorkspaceName.trim()
                        }
                        className='px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed'
                        data-track-category='Auth'
                        data-track-name='CreateEnterpriseWorkspace'
                      >
                        {isCreatingEnterpriseWorkspace ? 'Creating...' : 'Create'}
                      </button>
                    </div>
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

              {/* Public Email Domain Blocked */}
              {isCreatingOrg && isPublicEmailDomainError && (
                <div className='flex flex-col gap-4'>
                  <div className='p-4 bg-red-50 border border-red-200 rounded-lg text-center'>
                    <h3 className='text-base font-semibold text-red-800 mb-2'>
                      Workspace Unavailable
                    </h3>
                    <p className='text-sm text-red-700'>{error}</p>
                  </div>

                  <button
                    type='button'
                    onClick={handleTryDifferentAccount}
                    className='text-sm text-muted-foreground hover:text-foreground text-center cursor-pointer'
                    data-track-category='Auth'
                    data-track-name='TryDifferentAccount'
                  >
                    Try with a work email
                  </button>
                </div>
              )}

              {/* Create Organization Form - only for new users */}
              {((isCreatingOrg &&
                !userExistsButRemoved &&
                !isOrganizationDomainConflictError &&
                !isPublicEmailDomainError) ||
                showCreateOrgForm) && (
                <form onSubmit={handleCreateOrg} className='flex flex-col gap-4'>
                  <div className='text-center'>
                    <h3 className='text-lg font-semibold text-foreground'>Create Organization</h3>
                    <p className='text-sm text-muted-foreground mt-1'>Set up your new workspace</p>
                  </div>

                  {/* Duplicate Name Error Alert */}
                  {isOrganizationNameTakenError && (
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
                          if (isOrganizationNameTakenError) {
                            clearError();
                          }
                        }}
                        placeholder='Juspay Inc'
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-background text-foreground ${
                          isOrganizationNameTakenError
                            ? 'border-amber-400 focus:ring-amber-500'
                            : 'border-border focus:ring-blue-500'
                        }`}
                        required
                        data-track-category='Auth'
                        data-track-name='OrgNameInput'
                      />
                      {isOrganizationNameTakenError && (
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

                      {/* Divider */}
                      <div className='w-full max-w-[280px] md:max-w-[320px] flex items-center gap-3 my-1'>
                        <div className='flex-1 h-px bg-border' />
                        <span className='text-xs text-muted-foreground'>or</span>
                        <div className='flex-1 h-px bg-border' />
                      </div>

                      {/* Email Sign In / Sign Up Toggle */}
                      {!showEmailForm && !showRegisterForm ? (
                        <div className='w-full max-w-[280px] md:max-w-[320px] flex flex-col gap-3'>
                          <button
                            onClick={() => {
                              clearError();
                              setShowEmailForm(true);
                            }}
                            className='appearance-none outline-none font-inherit cursor-pointer opacity-100 flex items-center justify-center gap-4 px-4 py-[9px] w-full relative bg-[#2F2F2F] text-white border border-white/10 rounded-[10px] overflow-hidden h-12'
                            data-track-category='Auth'
                            data-track-name='EmailSignInToggle'
                          >
                            <span className='text-sm font-semibold text-center text-white'>
                              Sign in with Email
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              clearError();
                              setShowEmailForm(true);
                              setShowRegisterForm(true);
                            }}
                            className='text-xs text-muted-foreground hover:text-foreground text-center'
                            data-track-category='Auth'
                            data-track-name='EmailRegisterToggle'
                          >
                            Don&apos;t have an account? Sign up
                          </button>
                        </div>
                      ) : showRegisterForm ? (
                        /* Registration Flow */
                        <div className='w-full max-w-[280px] md:max-w-[320px] flex flex-col gap-3'>
                          {regStep === 'register' && (
                            <form
                              onSubmit={e => {
                                void handleRegisterSubmit(e);
                              }}
                              className='flex flex-col gap-3'
                            >
                              <p className='text-sm font-medium text-foreground'>
                                {pendingCommunityWorkspaceName
                                  ? `Join ${pendingCommunityWorkspaceName}`
                                  : 'Create Account'}
                              </p>
                              <p className='text-xs text-muted-foreground'>
                                Register with your email to join the community.
                              </p>
                              <input
                                type='text'
                                value={regName}
                                onChange={e => {
                                  const v = e.target.value;
                                  setRegName(v);
                                  setRegNameError(validateRegName(v));
                                }}
                                placeholder='Full name'
                                required
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-background text-foreground text-sm ${
                                  regNameError
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-border focus:ring-blue-500'
                                }`}
                                data-track-category='Auth'
                                data-track-name='RegisterNameInput'
                              />
                              {regNameError && (
                                <p className='text-xs text-red-600'>{regNameError}</p>
                              )}
                              <input
                                type='email'
                                value={regEmail}
                                onChange={e => {
                                  const v = e.target.value;
                                  setRegEmail(v);
                                  setRegEmailError(validateRegEmail(v));
                                }}
                                placeholder='Email address'
                                required
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-background text-foreground text-sm ${
                                  regEmailError
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-border focus:ring-blue-500'
                                }`}
                                data-track-category='Auth'
                                data-track-name='RegisterEmailInput'
                              />
                              {regEmailError && (
                                <p className='text-xs text-red-600'>{regEmailError}</p>
                              )}
                              <input
                                type='password'
                                value={regPassword}
                                onChange={e => {
                                  const v = e.target.value;
                                  setRegPassword(v);
                                  setRegPasswordError(validateRegPassword(v));
                                  if (regConfirmPassword)
                                    setRegConfirmPasswordError(
                                      validateRegConfirmPassword(regConfirmPassword),
                                    );
                                }}
                                placeholder='Password (min 8 chars, 1 uppercase, 1 number, 1 special)'
                                required
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-background text-foreground text-sm ${
                                  regPasswordError
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-border focus:ring-blue-500'
                                }`}
                                data-track-category='Auth'
                                data-track-name='RegisterPasswordInput'
                              />
                              {regPasswordError && (
                                <p className='text-xs text-red-600'>{regPasswordError}</p>
                              )}
                              <input
                                type='password'
                                value={regConfirmPassword}
                                onChange={e => {
                                  const v = e.target.value;
                                  setRegConfirmPassword(v);
                                  setRegConfirmPasswordError(validateRegConfirmPassword(v));
                                }}
                                placeholder='Confirm password'
                                required
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-background text-foreground text-sm ${
                                  regConfirmPasswordError
                                    ? 'border-red-500 focus:ring-red-500'
                                    : 'border-border focus:ring-blue-500'
                                }`}
                                data-track-category='Auth'
                                data-track-name='RegisterConfirmPasswordInput'
                              />
                              {regConfirmPasswordError && (
                                <p className='text-xs text-red-600'>{regConfirmPasswordError}</p>
                              )}
                              {regError && <p className='text-xs text-red-600'>{regError}</p>}
                              <button
                                type='submit'
                                disabled={regLoading}
                                className='w-full py-2.5 bg-black text-white font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 text-sm'
                                data-track-category='Auth'
                                data-track-name='RegisterSubmit'
                              >
                                {regLoading ? 'Sending...' : 'Send Verification Code'}
                              </button>
                            </form>
                          )}

                          {regStep === 'verify' && (
                            <form
                              onSubmit={e => {
                                void handleRegVerify(e);
                              }}
                              className='flex flex-col gap-3'
                            >
                              <p className='text-sm font-medium text-foreground'>
                                Verify Your Email
                              </p>
                              <p className='text-xs text-muted-foreground'>
                                We sent a 6-digit code to {regEmail}
                              </p>
                              <input
                                type='text'
                                value={regCode}
                                onChange={e =>
                                  setRegCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                }
                                placeholder='6-digit code'
                                maxLength={6}
                                pattern='[0-9]{6}'
                                inputMode='numeric'
                                required
                                className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm tracking-widest text-center'
                                data-track-category='Auth'
                                data-track-name='RegisterVerifyCodeInput'
                              />
                              {regError && <p className='text-xs text-red-600'>{regError}</p>}
                              {regMessage && <p className='text-xs text-green-600'>{regMessage}</p>}
                              <button
                                type='submit'
                                disabled={regLoading}
                                className='w-full py-2.5 bg-black text-white font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 text-sm'
                                data-track-category='Auth'
                                data-track-name='RegisterVerifySubmit'
                              >
                                {regLoading ? 'Verifying...' : 'Verify & Continue'}
                              </button>
                              <button
                                type='button'
                                onClick={() => {
                                  void handleRegResendCode();
                                }}
                                disabled={regLoading}
                                className='text-xs text-muted-foreground hover:text-foreground text-center'
                                data-track-category='Auth'
                                data-track-name='RegisterResendCode'
                              >
                                Resend code
                              </button>
                            </form>
                          )}

                          <button
                            type='button'
                            onClick={() => {
                              clearError();
                              resetRegistrationState();
                            }}
                            className='text-xs text-muted-foreground hover:text-foreground text-center'
                            data-track-category='Auth'
                            data-track-name='BackToSignIn'
                          >
                            Back to sign in
                          </button>
                        </div>
                      ) : showForgotPassword ? (
                        <div className='w-full max-w-[280px] md:max-w-[320px] flex flex-col gap-3'>
                          {fpStep === 'email' && (
                            <form
                              onSubmit={e => {
                                void handleFpRequestCode(e);
                              }}
                              className='flex flex-col gap-3'
                            >
                              <p className='text-sm font-medium text-foreground'>Reset Password</p>
                              <p className='text-xs text-muted-foreground'>
                                Enter your email to receive a reset code.
                              </p>
                              <input
                                type='email'
                                value={fpEmail}
                                onChange={e => setFpEmail(e.target.value)}
                                placeholder='Email address'
                                required
                                className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm'
                                data-track-category='Auth'
                                data-track-name='ForgotPasswordEmailInput'
                              />
                              {fpError && <p className='text-xs text-red-600'>{fpError}</p>}
                              {fpMessage && <p className='text-xs text-green-600'>{fpMessage}</p>}
                              <button
                                type='submit'
                                disabled={fpLoading}
                                className='w-full py-2.5 bg-black text-white font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 text-sm'
                                data-track-category='Auth'
                                data-track-name='SendResetCode'
                              >
                                {fpLoading ? 'Sending...' : 'Send Code'}
                              </button>
                            </form>
                          )}

                          {fpStep === 'code' && (
                            <form
                              onSubmit={e => {
                                void handleFpResetPassword(e);
                              }}
                              className='flex flex-col gap-3'
                            >
                              <p className='text-sm font-medium text-foreground'>Enter Code</p>
                              <p className='text-xs text-muted-foreground'>
                                We sent a 6-digit code to {fpEmail}
                              </p>
                              <input
                                type='text'
                                value={fpCode}
                                onChange={e =>
                                  setFpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                }
                                placeholder='6-digit code'
                                maxLength={6}
                                pattern='[0-9]{6}'
                                inputMode='numeric'
                                required
                                className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm tracking-widest text-center'
                                data-track-category='Auth'
                                data-track-name='ResetCodeInput'
                              />
                              <input
                                type='password'
                                value={fpNewPassword}
                                onChange={e => setFpNewPassword(e.target.value)}
                                placeholder='New password (min 8 chars)'
                                required
                                className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm'
                                data-track-category='Auth'
                                data-track-name='ResetNewPasswordInput'
                              />
                              <input
                                type='password'
                                value={fpConfirmPassword}
                                onChange={e => setFpConfirmPassword(e.target.value)}
                                placeholder='Confirm new password'
                                required
                                className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm'
                                data-track-category='Auth'
                                data-track-name='ResetConfirmPasswordInput'
                              />
                              {fpError && <p className='text-xs text-red-600'>{fpError}</p>}
                              <button
                                type='submit'
                                disabled={fpLoading}
                                className='w-full py-2.5 bg-black text-white font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 text-sm'
                                data-track-category='Auth'
                                data-track-name='ResetPassword'
                              >
                                {fpLoading ? 'Resetting...' : 'Reset Password'}
                              </button>
                            </form>
                          )}

                          {fpStep === 'success' && (
                            <div className='flex flex-col gap-3 text-center'>
                              <p className='text-sm font-medium text-green-600'>
                                Password reset successful!
                              </p>
                              <p className='text-xs text-muted-foreground'>
                                You can now sign in with your new password.
                              </p>
                            </div>
                          )}

                          <button
                            type='button'
                            onClick={() => {
                              setShowForgotPassword(false);
                              setFpStep('email');
                              setFpEmail('');
                              setFpCode('');
                              setFpNewPassword('');
                              setFpConfirmPassword('');
                              setFpError('');
                              setFpMessage('');
                            }}
                            className='text-xs text-muted-foreground hover:text-foreground text-center'
                            data-track-category='Auth'
                            data-track-name='BackToSignIn'
                          >
                            Back to sign in
                          </button>
                        </div>
                      ) : (
                        <form
                          onSubmit={(e): void => {
                            void handleEmailSubmit(e);
                          }}
                          className='w-full max-w-[280px] md:max-w-[320px] flex flex-col gap-3'
                        >
                          <input
                            type='email'
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder='Email address'
                            required
                            className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm'
                            data-track-category='Auth'
                            data-track-name='EmailInput'
                          />
                          <input
                            type='password'
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder='Password'
                            required
                            className='w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground text-sm'
                            data-track-category='Auth'
                            data-track-name='PasswordInput'
                          />
                          <button
                            type='button'
                            onClick={() => {
                              clearError();
                              setShowForgotPassword(true);
                            }}
                            className='text-xs text-muted-foreground hover:text-foreground text-right self-end'
                            data-track-category='Auth'
                            data-track-name='ForgotPassword'
                          >
                            Forgot password?
                          </button>
                          <button
                            type='submit'
                            disabled={isLoading}
                            className='w-full py-2.5 bg-black text-white font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50 text-sm'
                            data-track-category='Auth'
                            data-track-name='EmailSignInSubmit'
                          >
                            {isLoading ? 'Please wait...' : 'Sign In'}
                          </button>
                          <button
                            type='button'
                            onClick={() => {
                              clearError();
                              setShowRegisterForm(true);
                              setShowForgotPassword(false);
                            }}
                            className='text-xs text-muted-foreground hover:text-foreground text-center'
                            data-track-category='Auth'
                            data-track-name='SwitchToRegister'
                          >
                            Don&apos;t have an account? Sign up
                          </button>
                        </form>
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

          {/* Copyright */}
          <div className='py-4 text-center'>
            <p className='text-xs sm:text-sm text-muted-foreground'>
              &copy; {new Date().getFullYear()} Xyne Spaces. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
};

export default AuthScreen;
