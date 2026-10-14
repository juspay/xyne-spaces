import { ReactElement, useEffect, useState } from 'react';
import {
  View,
  Text,
  Alert,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useRouter } from 'expo-router';
import { ChevronLeft, Building2, Mail } from 'lucide-react-native';
import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import {
  OrganizationDomainConflictError,
  PublicEmailDomainError,
  requestPasswordResetCode,
  resetPasswordWithCode,
} from '@/src/services/AuthServices';
import {
  flattenCommunityWorkspaces,
  listCommunityWorkspaces,
} from '@/src/services/CommunityServices';
import {
  getPendingCommunityWorkspace,
  setPendingCommunityWorkspace,
} from '@/src/services/communityIntent';
import { AuthButton, Divider } from '@/src/components/auth/auth-button';
import { GoogleLogo } from '@/src/assets/icons/GoogleLogo';
import { MicrosoftLogo } from '@/src/assets/icons/MicrosoftLogo';
import { XyneLogo } from '@/src/assets/icons/XyneLogo';
import { useReportStartupReady } from '@/src/observability/logging/hooks/startup/useReportStartupReady';

type AuthMode = 'providers' | 'email' | 'sign-up' | 'forgot-password';
type ForgotPasswordStep = 'request-code' | 'reset-password' | 'success';
type SignUpStep = 'details' | 'verify-code';

/** Matches the backend's `NAME_REGEX` on `POST /v2/auth/email/register`. */
const NAME_PATTERN = /^[A-Za-z ]+$/;

const PASSWORD_REQUIREMENTS =
  'Password must be 8-128 characters and include at least one uppercase letter, one number, and one special character.';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validateNewPassword(password: string): string | null {
  if (
    password.length < 8 ||
    password.length > 128 ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return PASSWORD_REQUIREMENTS;
  }
  return null;
}

/**
 * Resolves the display name of the community the user picked before signing in, so the banner can
 * name it. Mirrors the dashboard's `AuthScreen` behaviour of re-fetching the listing when only the
 * id was stored (e.g. after an invite deep link).
 */
function usePendingCommunity(): { hasPending: boolean; name: string | null } {
  const pendingOnMount = getPendingCommunityWorkspace();
  const [name, setName] = useState<string | null>(pendingOnMount?.name ?? null);

  useEffect(() => {
    const pending = getPendingCommunityWorkspace();
    if (!pending || pending.name) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const organizations = await listCommunityWorkspaces();
        const match = flattenCommunityWorkspaces(organizations).find(
          workspace => workspace.id === pending.id,
        );
        if (cancelled || !match) {
          return;
        }
        setPendingCommunityWorkspace(match.id, match.name);
        setName(match.name);
      } catch {
        // Best effort — the banner falls back to generic copy.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { hasPending: pendingOnMount !== null, name };
}

/**
 * Login screen of the community app (APP_VARIANT=community): adds email sign-up, the pending
 * community banner, enterprise-join and "back to communities" on top of the main app's login.
 * `app/login.tsx` picks it when IS_COMMUNITY_APP.
 */
export const CommunityLoginScreen = (): ReactElement => {
  useReportStartupReady('login', true);
  const background = useCSSVariable('--color-auth-background') as string;
  const cardBackground = useCSSVariable('--color-auth-card-bg') as string;
  const cardBorder = useCSSVariable('--color-auth-card-border') as string;
  const primaryText = useCSSVariable('--color-auth-primary-text') as string;
  const secondaryText = useCSSVariable('--color-auth-secondary-text') as string;
  const tertiaryText = useCSSVariable('--color-auth-tertiary-text') as string;
  const mutedText = useCSSVariable('--color-auth-muted-text') as string;
  const inputBackground = useCSSVariable('--color-auth-input-bg') as string;
  const inputBorder = useCSSVariable('--color-auth-input-border') as string;
  const inputText = useCSSVariable('--color-auth-input-text') as string;
  const placeholderText = useCSSVariable('--color-auth-placeholder') as string;
  const primaryBtnBg = useCSSVariable('--color-auth-primary-btn-bg') as string;
  const primaryBtnText = useCSSVariable('--color-auth-primary-btn-text') as string;
  const secondaryBtnText = useCSSVariable('--color-auth-secondary-btn-text') as string;
  const linkText = useCSSVariable('--color-auth-link') as string;
  const errorText = useCSSVariable('--color-auth-error') as string;
  const successText = useCSSVariable('--color-auth-success') as string;
  const activityIndicator = useCSSVariable('--color-auth-activity-indicator') as string;
  const warningIconBg = useCSSVariable('--color-auth-warning-icon-bg') as string;
  const warningIconColor = useCSSVariable('--color-auth-warning-icon') as string;
  const infoIconBg = useCSSVariable('--color-auth-info-icon-bg') as string;
  const infoIconColor = useCSSVariable('--color-auth-info-icon') as string;
  const {
    signIn,
    signInWithMicrosoft,
    signInWithEmail,
    signUpWithEmail,
    confirmEmailSignUp,
    resendSignUpCode,
    isLoading,
    pendingAuth,
    selectWorkspace,
    clearPendingAuth,
    createOrganization,
    requestEnterpriseJoin,
    createEnterpriseWorkspace,
  } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const isTablet = screenWidth >= 768;
  const orgCreation = pendingAuth?.kind === 'org_creation_required' ? pendingAuth : null;
  /**
   * The user signed in but owns no workspace. Which of the four sub-screens shows depends on *why*
   * — mirrors the dashboard's `AuthScreen` split of its `creatingOrg` state.
   */
  const isNoWorkspaceAccess = orgCreation?.userExistsButRemoved === true;
  const pendingCommunity = usePendingCommunity();
  const infoBannerBg = useCSSVariable('--color-auth-info-icon-bg') as string;
  const infoBannerFg = useCSSVariable('--color-auth-info-icon') as string;

  const goBackToCommunities = (): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/community');
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: inputBorder,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: inputText,
    backgroundColor: inputBackground,
  } as const;

  const helperTextStyle = {
    fontSize: 13,
    color: secondaryText,
    lineHeight: 20,
  } as const;

  /** Amber/red policy notice card — the mobile equivalent of the dashboard's alert boxes. */
  const noticeCardStyle = {
    borderWidth: 1,
    borderColor: cardBorder,
    borderRadius: 12,
    backgroundColor: warningIconBg,
    padding: 14,
    gap: 6,
  } as const;

  const noticeTitleStyle = {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  } as const;

  const noticeBodyStyle = {
    fontSize: 13,
    color: secondaryText,
    lineHeight: 20,
    textAlign: 'center',
  } as const;

  const linkRowStyle = {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  } as const;

  const linkLabelStyle = {
    fontSize: 13,
    color: linkText,
    fontWeight: '600',
  } as const;

  const [authMode, setAuthMode] = useState<AuthMode>('providers');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [signUpStep, setSignUpStep] = useState<SignUpStep>('details');
  const [signUpName, setSignUpName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('');
  const [signUpCode, setSignUpCode] = useState('');
  const [signUpMessage, setSignUpMessage] = useState('');
  const [signUpError, setSignUpError] = useState('');
  const [isSignUpLoading, setIsSignUpLoading] = useState(false);

  // --- No-workspace flow (create org / request enterprise access / create workspace in org) ---
  const [orgName, setOrgName] = useState('');
  const [orgWorkspaceName, setOrgWorkspaceName] = useState('');
  const [orgError, setOrgError] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  /**
   * A domain conflict discovered by *attempting* org creation — the fallback for any sign-in path
   * whose backend reply does not carry the conflict. The server's refusal names the existing org
   * but not its workspaces, so the request-to-join list only appears when the sign-in itself
   * reported one.
   */
  const [createOrgConflict, setCreateOrgConflict] = useState<{
    message: string;
    orgName: string | null;
  } | null>(null);
  const [createOrgPublicDomainError, setCreateOrgPublicDomainError] = useState('');
  const [joinRequestMessage, setJoinRequestMessage] = useState('');
  const [joinRequestError, setJoinRequestError] = useState('');
  const [requestingWorkspaceId, setRequestingWorkspaceId] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState('');

  const [forgotStep, setForgotStep] = useState<ForgotPasswordStep>('request-code');
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetLoading, setIsResetLoading] = useState(false);

  const resetForgotPasswordState = (): void => {
    setForgotStep('request-code');
    setResetCode('');
    setNewPassword('');
    setConfirmPassword('');
    setResetMessage('');
    setResetError('');
    setIsResetLoading(false);
  };

  const resetSignUpState = (): void => {
    setSignUpStep('details');
    setSignUpPassword('');
    setSignUpConfirmPassword('');
    setSignUpCode('');
    setSignUpMessage('');
    setSignUpError('');
    setIsSignUpLoading(false);
  };

  const openSignUp = (): void => {
    resetSignUpState();
    setSignUpEmail(email.trim());
    setAuthMode('sign-up');
  };

  const handleSignUpRequest = async (): Promise<void> => {
    const normalizedEmail = signUpEmail.trim();
    const name = signUpName.trim();

    if (!NAME_PATTERN.test(name)) {
      setSignUpError('Name can only contain letters and spaces.');
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setSignUpError('Please enter a valid email address.');
      return;
    }
    const passwordError = validateNewPassword(signUpPassword);
    if (passwordError) {
      setSignUpError(passwordError);
      return;
    }
    if (signUpPassword !== signUpConfirmPassword) {
      setSignUpError('Passwords do not match.');
      return;
    }

    setSignUpError('');
    setIsSignUpLoading(true);
    try {
      const message = await signUpWithEmail({
        email: normalizedEmail,
        password: signUpPassword,
        name,
      });
      setSignUpMessage(message);
      setSignUpStep('verify-code');
    } catch (error: unknown) {
      setSignUpError(getErrorMessage(error, 'Registration failed. Please try again.'));
    } finally {
      setIsSignUpLoading(false);
    }
  };

  const handleVerifySignUp = async (): Promise<void> => {
    if (signUpCode.length !== 6) {
      setSignUpError('Enter the 6-digit code from your email.');
      return;
    }

    setSignUpError('');
    setIsSignUpLoading(true);
    try {
      await confirmEmailSignUp(signUpEmail.trim(), signUpCode);
    } catch (error: unknown) {
      setSignUpError(getErrorMessage(error, 'Verification failed. Please try again.'));
    } finally {
      setIsSignUpLoading(false);
    }
  };

  const handleResendSignUpCode = async (): Promise<void> => {
    setSignUpError('');
    setIsSignUpLoading(true);
    try {
      setSignUpMessage(await resendSignUpCode(signUpEmail.trim()));
    } catch (error: unknown) {
      setSignUpError(getErrorMessage(error, 'Could not resend the code. Please wait and retry.'));
    } finally {
      setIsSignUpLoading(false);
    }
  };

  const handleGoogleAuth = async (): Promise<void> => {
    try {
      await signIn();
    } catch (error: unknown) {
      void haptics.error();
      Alert.alert('Login Failed', getErrorMessage(error, 'An error occurred. Please try again.'));
    }
  };

  const handleMicrosoftAuth = async (): Promise<void> => {
    try {
      await signInWithMicrosoft();
    } catch (error: unknown) {
      void haptics.error();
      Alert.alert('Login Failed', getErrorMessage(error, 'Microsoft login failed.'));
    }
  };

  const handleEmailAuth = async (): Promise<void> => {
    const normalizedEmail = email.trim();
    if (!isValidEmail(normalizedEmail)) {
      void haptics.warning();
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!password) {
      void haptics.warning();
      Alert.alert('Password Required', 'Please enter your password.');
      return;
    }

    try {
      await signInWithEmail(normalizedEmail, password);
    } catch (error: unknown) {
      void haptics.error();
      Alert.alert('Login Failed', getErrorMessage(error, 'Email login failed.'));
    }
  };

  const handleWorkspaceSelection = async (workspaceId: string): Promise<void> => {
    try {
      await selectWorkspace(workspaceId);
    } catch (error: unknown) {
      void haptics.error();
      Alert.alert(
        'Workspace Login Failed',
        getErrorMessage(error, 'Failed to login to workspace.'),
      );
    }
  };

  const openForgotPassword = (): void => {
    resetForgotPasswordState();
    setResetEmail(email.trim());
    setAuthMode('forgot-password');
  };

  const handleRequestResetCode = async (): Promise<void> => {
    const normalizedEmail = resetEmail.trim();
    if (!isValidEmail(normalizedEmail)) {
      setResetError('Enter a valid email address.');
      return;
    }

    setResetError('');
    setResetMessage('');
    setIsResetLoading(true);
    try {
      const message = await requestPasswordResetCode(normalizedEmail);
      setResetMessage(message);
      setForgotStep('reset-password');
    } catch (error: unknown) {
      void haptics.error();
      setResetError(getErrorMessage(error, 'Failed to send reset code. Please try again.'));
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleResetPassword = async (): Promise<void> => {
    const normalizedEmail = resetEmail.trim();
    const normalizedCode = resetCode.replace(/\D/g, '');
    const passwordError = validateNewPassword(newPassword);

    if (!isValidEmail(normalizedEmail)) {
      setResetError('Enter a valid email address.');
      return;
    }
    if (!/^\d{6}$/.test(normalizedCode)) {
      setResetError('Enter the 6-digit code from your email.');
      return;
    }
    if (passwordError) {
      setResetError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    setResetError('');
    setIsResetLoading(true);
    try {
      const message = await resetPasswordWithCode({
        email: normalizedEmail,
        code: normalizedCode,
        newPassword,
      });
      setResetMessage(message);
      setPassword('');
      setEmail(normalizedEmail);
      void haptics.success();
      setForgotStep('success');
    } catch (error: unknown) {
      void haptics.error();
      setResetError(getErrorMessage(error, 'Failed to reset password. Please try again.'));
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleCreateOrg = async (): Promise<void> => {
    const trimmedOrgName = orgName.trim();
    const trimmedWorkspaceName = orgWorkspaceName.trim();
    if (!trimmedOrgName || !trimmedWorkspaceName) {
      setOrgError('Organization name and workspace name are both required.');
      return;
    }

    setOrgError('');
    setIsCreatingOrg(true);
    try {
      await createOrganization({ orgName: trimmedOrgName, workspaceName: trimmedWorkspaceName });
    } catch (error: unknown) {
      void haptics.error();
      if (error instanceof OrganizationDomainConflictError) {
        setCreateOrgConflict({ message: error.message, orgName: error.orgName });
        return;
      }
      if (error instanceof PublicEmailDomainError) {
        setCreateOrgPublicDomainError(error.message);
        return;
      }
      setOrgError(getErrorMessage(error, 'Failed to create organization. Please try again.'));
    } finally {
      setIsCreatingOrg(false);
    }
  };

  const handleRequestEnterpriseJoin = async (
    workspaceId: string,
    workspaceName: string,
  ): Promise<void> => {
    setJoinRequestError('');
    setJoinRequestMessage('');
    setRequestingWorkspaceId(workspaceId);
    try {
      const { status, isExisting } = await requestEnterpriseJoin(workspaceId);
      void haptics.success();
      setJoinRequestMessage(
        status === 'APPROVED'
          ? `Your request to join ${workspaceName} is approved. Sign in again to continue.`
          : isExisting
            ? `Your request to join ${workspaceName} is already pending.`
            : `Your request to join ${workspaceName} has been submitted.`,
      );
    } catch (error: unknown) {
      void haptics.error();
      setJoinRequestError(getErrorMessage(error, 'Failed to request access.'));
    } finally {
      setRequestingWorkspaceId(null);
    }
  };

  const handleCreateEnterpriseWorkspace = async (): Promise<void> => {
    const trimmedName = newWorkspaceName.trim();
    if (!trimmedName) {
      return;
    }

    setCreateWorkspaceError('');
    setIsCreatingWorkspace(true);
    try {
      await createEnterpriseWorkspace(trimmedName);
    } catch (error: unknown) {
      void haptics.error();
      setCreateWorkspaceError(getErrorMessage(error, 'Failed to create workspace.'));
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleTryDifferentAccount = (): void => {
    setCreateOrgConflict(null);
    setCreateOrgPublicDomainError('');
    setOrgName('');
    setOrgWorkspaceName('');
    setOrgError('');
    setJoinRequestMessage('');
    setJoinRequestError('');
    setNewWorkspaceName('');
    setCreateWorkspaceError('');
    setPassword('');
    resetSignUpState();
    // Web reloads the page here; the mobile equivalent is dropping the pending identity and
    // returning to the provider list, so the next attempt starts from a clean sign-in.
    setAuthMode('providers');
    clearPendingAuth();
  };

  // The sign-in reply carries the conflict when it can; otherwise it surfaces on create-org.
  const domainConflictMessage =
    orgCreation?.domainConflictError ?? createOrgConflict?.message ?? null;
  const publicEmailDomainMessage =
    orgCreation?.publicEmailDomainError ?? createOrgPublicDomainError ?? '';
  const enterpriseJoinTarget = orgCreation?.enterpriseJoinTarget ?? null;
  const conflictOrgName = enterpriseJoinTarget?.orgName ?? createOrgConflict?.orgName ?? null;
  const showOrgConflict = Boolean(orgCreation) && Boolean(domainConflictMessage);
  const showPublicDomainBlocked = Boolean(orgCreation) && Boolean(publicEmailDomainMessage);
  const showCreateOrgForm =
    Boolean(orgCreation) && !isNoWorkspaceAccess && !showOrgConflict && !showPublicDomainBlocked;

  const showProviderButtons = authMode === 'providers';
  const showEmailForm = authMode === 'email';
  const showSignUp = authMode === 'sign-up';
  const showForgotPassword = authMode === 'forgot-password';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          paddingVertical: 32,
        }}
      >
        <Pressable
          onPress={goBackToCommunities}
          accessibilityRole='button'
          accessibilityLabel='Back to communities'
          style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <ChevronLeft size={18} color={secondaryText} />
          <Text style={{ fontSize: 13, color: secondaryText, fontWeight: '600' }}>Communities</Text>
        </Pressable>

        <View
          style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}
        >
          <View style={{ marginBottom: isTablet ? 48 : 32 }}>
            <XyneLogo width={isTablet ? 160 : 120} height={isTablet ? 53 : 40} />
          </View>

          {pendingCommunity.hasPending ? (
            <View
              style={{
                width: '100%',
                maxWidth: isTablet ? 420 : 340,
                borderRadius: 12,
                backgroundColor: infoBannerBg,
                paddingVertical: 12,
                paddingHorizontal: 16,
                marginBottom: isTablet ? 24 : 16,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: infoBannerFg }}>
                {pendingCommunity.name
                  ? `You will be joining ${pendingCommunity.name} Community`
                  : 'You will be joining the selected community'}
              </Text>
            </View>
          ) : null}

          {isNoWorkspaceAccess ? (
            <View style={{ alignItems: 'center', marginBottom: isTablet ? 32 : 24, gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  backgroundColor: warningIconBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Building2 size={24} color={warningIconColor} />
              </View>
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Text
                  style={{
                    fontSize: isTablet ? 24 : 20,
                    fontWeight: '600',
                    color: primaryText,
                    textAlign: 'center',
                  }}
                >
                  No Workspace Access
                </Text>
                <Text
                  style={{
                    fontSize: isTablet ? 16 : 14,
                    color: secondaryText,
                    textAlign: 'center',
                  }}
                >
                  Your account exists but you don&apos;t have access to any workspaces.
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ alignItems: 'center', marginBottom: isTablet ? 48 : 32, gap: 8 }}>
              <Text
                style={{
                  fontSize: isTablet ? 24 : 20,
                  fontWeight: '600',
                  color: primaryText,
                  textAlign: 'center',
                }}
              >
                Log in to Xyne Spaces
              </Text>
              <Text
                style={{
                  fontSize: isTablet ? 16 : 14,
                  color: secondaryText,
                  textAlign: 'center',
                }}
              >
                {isLoading
                  ? 'Signing you in...'
                  : 'Communicate, collaborate & 10x your daily productivity'}
              </Text>
            </View>
          )}

          {isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 32, gap: 16 }}>
              <ActivityIndicator size='large' color={activityIndicator} />
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: primaryText }}>
                  Signing you in...
                </Text>
                <Text style={{ fontSize: 14, color: secondaryText }}>
                  Please wait while we authenticate your account
                </Text>
              </View>
            </View>
          ) : (
            <View
              style={{ width: '100%', maxWidth: isTablet ? 420 : 340, gap: isTablet ? 16 : 12 }}
            >
              {pendingAuth?.kind === 'workspace_selection_required' ? (
                <>
                  <Text style={{ fontSize: 15, color: tertiaryText, textAlign: 'center' }}>
                    Select a workspace to continue
                  </Text>
                  {pendingAuth.workspaces.map(workspace => (
                    <Pressable
                      key={workspace.id}
                      style={{
                        backgroundColor: primaryBtnBg,
                        borderRadius: 10,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        minHeight: 48,
                        justifyContent: 'center',
                      }}
                      onPress={() => {
                        void handleWorkspaceSelection(workspace.id);
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '600', color: primaryBtnText }}>
                        {workspace.name}
                      </Text>
                      {workspace.role ? (
                        <Text style={{ fontSize: 12, color: mutedText, marginTop: 2 }}>
                          {workspace.role}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={clearPendingAuth}
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ fontSize: 13, color: linkText, fontWeight: '600' }}>
                      Back to sign in
                    </Text>
                  </Pressable>
                </>
              ) : isNoWorkspaceAccess ? (
                <>
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: cardBorder,
                      borderRadius: 12,
                      backgroundColor: cardBackground,
                      padding: 16,
                      flexDirection: 'row',
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: infoIconBg,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Mail size={18} color={infoIconColor} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: primaryText }}>
                        Contact Your Administrator
                      </Text>
                      <Text style={helperTextStyle}>
                        Reach out to your organization admin to request access to a workspace. They
                        can send you an invitation to join.
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={handleTryDifferentAccount} style={linkRowStyle}>
                    <Text style={linkLabelStyle}>Try with a different account</Text>
                  </Pressable>
                </>
              ) : showPublicDomainBlocked ? (
                <>
                  <View style={noticeCardStyle}>
                    <Text style={{ ...noticeTitleStyle, color: errorText }}>
                      Workspace Unavailable
                    </Text>
                    <Text style={noticeBodyStyle}>{publicEmailDomainMessage}</Text>
                  </View>
                  <Pressable onPress={handleTryDifferentAccount} style={linkRowStyle}>
                    <Text style={linkLabelStyle}>Try with a different account</Text>
                  </Pressable>
                </>
              ) : showOrgConflict ? (
                <>
                  <View style={noticeCardStyle}>
                    <Text style={{ ...noticeTitleStyle, color: warningIconColor }}>
                      Organization Already Exists
                    </Text>
                    <Text style={noticeBodyStyle}>{domainConflictMessage}</Text>
                  </View>

                  {joinRequestMessage ? (
                    <Text style={{ fontSize: 13, color: successText, textAlign: 'center' }}>
                      {joinRequestMessage}
                    </Text>
                  ) : null}
                  {joinRequestError ? (
                    <Text style={{ fontSize: 13, color: errorText, textAlign: 'center' }}>
                      {joinRequestError}
                    </Text>
                  ) : null}

                  {enterpriseJoinTarget && enterpriseJoinTarget.workspaces.length > 0 ? (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: primaryText }}>
                        {`Request access to a workspace in ${enterpriseJoinTarget.orgName}:`}
                      </Text>
                      {enterpriseJoinTarget.workspaces.map(workspace => (
                        <View
                          key={workspace.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            borderWidth: 1,
                            borderColor: cardBorder,
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                          }}
                        >
                          <Building2 size={16} color={secondaryText} />
                          <Text
                            numberOfLines={1}
                            style={{
                              flex: 1,
                              fontSize: 14,
                              fontWeight: '500',
                              color: primaryText,
                            }}
                          >
                            {workspace.name}
                          </Text>
                          <Pressable
                            onPress={() => {
                              void handleRequestEnterpriseJoin(workspace.id, workspace.name);
                            }}
                            disabled={requestingWorkspaceId !== null || Boolean(joinRequestMessage)}
                            accessibilityRole='button'
                            accessibilityLabel={`Request to join ${workspace.name}`}
                            style={{
                              backgroundColor: primaryBtnBg,
                              borderRadius: 8,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              opacity:
                                requestingWorkspaceId !== null || joinRequestMessage ? 0.5 : 1,
                            }}
                          >
                            <Text
                              style={{ fontSize: 13, fontWeight: '600', color: primaryBtnText }}
                            >
                              {requestingWorkspaceId === workspace.id
                                ? 'Requesting...'
                                : 'Request to join'}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: cardBorder,
                      paddingTop: 14,
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: primaryText }}>
                      {`Or create a new workspace in ${conflictOrgName ?? 'your organization'}:`}
                    </Text>
                    {createWorkspaceError ? (
                      <Text style={{ fontSize: 13, color: errorText }}>{createWorkspaceError}</Text>
                    ) : null}
                    <TextInput
                      style={inputStyle}
                      value={newWorkspaceName}
                      onChangeText={setNewWorkspaceName}
                      placeholder='Workspace name'
                      placeholderTextColor={placeholderText}
                      autoCapitalize='words'
                      returnKeyType='go'
                      onSubmitEditing={() => {
                        void handleCreateEnterpriseWorkspace();
                      }}
                    />
                    <AuthButton
                      label={isCreatingWorkspace ? 'Creating...' : 'Create'}
                      onPress={() => {
                        void handleCreateEnterpriseWorkspace();
                      }}
                      disabled={isCreatingWorkspace || !newWorkspaceName.trim()}
                    />
                  </View>

                  <Pressable onPress={handleTryDifferentAccount} style={linkRowStyle}>
                    <Text style={linkLabelStyle}>Try with a different account</Text>
                  </Pressable>
                </>
              ) : showCreateOrgForm ? (
                <>
                  <View style={{ alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: primaryText }}>
                      Create Organization
                    </Text>
                    <Text style={{ fontSize: 13, color: secondaryText }}>
                      Set up your new workspace
                    </Text>
                  </View>
                  {orgError ? (
                    <Text style={{ fontSize: 13, color: errorText }}>{orgError}</Text>
                  ) : null}
                  <TextInput
                    style={inputStyle}
                    value={orgName}
                    onChangeText={setOrgName}
                    placeholder='Organization name'
                    placeholderTextColor={placeholderText}
                    autoCapitalize='words'
                    returnKeyType='next'
                  />
                  <TextInput
                    style={inputStyle}
                    value={orgWorkspaceName}
                    onChangeText={setOrgWorkspaceName}
                    placeholder='Workspace name'
                    placeholderTextColor={placeholderText}
                    autoCapitalize='words'
                    returnKeyType='go'
                    onSubmitEditing={() => {
                      void handleCreateOrg();
                    }}
                  />
                  <AuthButton
                    label={isCreatingOrg ? 'Creating...' : 'Create Organization'}
                    onPress={() => {
                      void handleCreateOrg();
                    }}
                    disabled={isCreatingOrg || !orgName.trim() || !orgWorkspaceName.trim()}
                  />
                  <Pressable onPress={handleTryDifferentAccount} style={linkRowStyle}>
                    <Text style={linkLabelStyle}>Try with a different account</Text>
                  </Pressable>
                </>
              ) : showProviderButtons ? (
                <>
                  <AuthButton
                    label='Sign in with Google'
                    onPress={() => {
                      void handleGoogleAuth();
                    }}
                    icon={<GoogleLogo />}
                  />
                  <AuthButton
                    label='Sign in with Microsoft'
                    onPress={() => {
                      void handleMicrosoftAuth();
                    }}
                    icon={<MicrosoftLogo />}
                    variant='secondary'
                  />
                  <Divider />
                  <AuthButton
                    label='Sign in with Email'
                    onPress={() => {
                      setAuthMode('email');
                    }}
                    icon={<Mail size={18} color={secondaryBtnText} />}
                    variant='secondary'
                  />
                </>
              ) : showEmailForm ? (
                <>
                  <TextInput
                    style={inputStyle}
                    value={email}
                    onChangeText={setEmail}
                    placeholder='Email address'
                    placeholderTextColor={placeholderText}
                    autoCapitalize='none'
                    autoCorrect={false}
                    keyboardType='email-address'
                    textContentType='emailAddress'
                    autoComplete='email'
                    returnKeyType='next'
                  />
                  <TextInput
                    style={inputStyle}
                    value={password}
                    onChangeText={setPassword}
                    placeholder='Password'
                    placeholderTextColor={placeholderText}
                    secureTextEntry
                    textContentType='password'
                    autoComplete='current-password'
                    returnKeyType='go'
                    onSubmitEditing={() => {
                      void handleEmailAuth();
                    }}
                  />
                  <Pressable
                    onPress={openForgotPassword}
                    style={{ alignSelf: 'flex-end', paddingVertical: 4 }}
                  >
                    <Text style={{ fontSize: 13, color: linkText, fontWeight: '600' }}>
                      Forgot password?
                    </Text>
                  </Pressable>
                  <AuthButton
                    label='Sign in'
                    onPress={() => {
                      void handleEmailAuth();
                    }}
                    disabled={!email.trim() || !password}
                  />
                  <Pressable
                    onPress={openSignUp}
                    style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 13, color: secondaryText }}>
                      New here?{' '}
                      <Text style={{ color: linkText, fontWeight: '600' }}>Create an account</Text>
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setAuthMode('providers');
                      setPassword('');
                    }}
                    style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 13, color: secondaryText, fontWeight: '600' }}>
                      Back
                    </Text>
                  </Pressable>
                </>
              ) : showSignUp ? (
                <>
                  {signUpStep === 'details' ? (
                    <>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: primaryText }}>
                        Create your account
                      </Text>
                      <TextInput
                        style={inputStyle}
                        value={signUpName}
                        onChangeText={setSignUpName}
                        placeholder='Full name'
                        placeholderTextColor={placeholderText}
                        autoCapitalize='words'
                        autoCorrect={false}
                        textContentType='name'
                        autoComplete='name'
                        returnKeyType='next'
                      />
                      <TextInput
                        style={inputStyle}
                        value={signUpEmail}
                        onChangeText={setSignUpEmail}
                        placeholder='Email address'
                        placeholderTextColor={placeholderText}
                        autoCapitalize='none'
                        autoCorrect={false}
                        keyboardType='email-address'
                        textContentType='emailAddress'
                        autoComplete='email'
                        returnKeyType='next'
                      />
                      <TextInput
                        style={inputStyle}
                        value={signUpPassword}
                        onChangeText={setSignUpPassword}
                        placeholder='Password'
                        placeholderTextColor={placeholderText}
                        secureTextEntry
                        textContentType='newPassword'
                        autoComplete='new-password'
                        returnKeyType='next'
                      />
                      <TextInput
                        style={inputStyle}
                        value={signUpConfirmPassword}
                        onChangeText={setSignUpConfirmPassword}
                        placeholder='Confirm password'
                        placeholderTextColor={placeholderText}
                        secureTextEntry
                        textContentType='newPassword'
                        autoComplete='new-password'
                        returnKeyType='go'
                        onSubmitEditing={() => {
                          void handleSignUpRequest();
                        }}
                      />
                      <Text style={helperTextStyle}>{PASSWORD_REQUIREMENTS}</Text>
                      {signUpError ? (
                        <Text style={{ fontSize: 13, color: errorText, lineHeight: 20 }}>
                          {signUpError}
                        </Text>
                      ) : null}
                      <AuthButton
                        label={isSignUpLoading ? 'Sending...' : 'Create account'}
                        onPress={() => {
                          void handleSignUpRequest();
                        }}
                        disabled={
                          isSignUpLoading ||
                          !signUpName.trim() ||
                          !signUpEmail.trim() ||
                          !signUpPassword ||
                          !signUpConfirmPassword
                        }
                      />
                    </>
                  ) : (
                    <>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: primaryText }}>
                        Verify your email
                      </Text>
                      <Text style={helperTextStyle}>
                        We sent a 6-digit code to {signUpEmail.trim()}. It expires in 15 minutes.
                      </Text>
                      <TextInput
                        style={[inputStyle, { textAlign: 'center', letterSpacing: 6 }]}
                        value={signUpCode}
                        onChangeText={value => setSignUpCode(value.replace(/\D/g, '').slice(0, 6))}
                        placeholder='000000'
                        placeholderTextColor={placeholderText}
                        keyboardType='number-pad'
                        maxLength={6}
                        textContentType='oneTimeCode'
                        autoComplete='one-time-code'
                        returnKeyType='go'
                        onSubmitEditing={() => {
                          void handleVerifySignUp();
                        }}
                      />
                      {signUpError ? (
                        <Text style={{ fontSize: 13, color: errorText, lineHeight: 20 }}>
                          {signUpError}
                        </Text>
                      ) : null}
                      {signUpMessage ? (
                        <Text style={{ fontSize: 13, color: successText, lineHeight: 20 }}>
                          {signUpMessage}
                        </Text>
                      ) : null}
                      <AuthButton
                        label={isSignUpLoading ? 'Verifying...' : 'Verify and continue'}
                        onPress={() => {
                          void handleVerifySignUp();
                        }}
                        disabled={isSignUpLoading || signUpCode.length !== 6}
                      />
                      <Pressable
                        onPress={() => {
                          void handleResendSignUpCode();
                        }}
                        disabled={isSignUpLoading}
                        style={{
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: 8,
                        }}
                      >
                        <Text style={{ fontSize: 13, color: linkText, fontWeight: '600' }}>
                          Resend code
                        </Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable
                    onPress={() => {
                      resetSignUpState();
                      setAuthMode('email');
                    }}
                    style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 13, color: secondaryText, fontWeight: '600' }}>
                      Back to sign in
                    </Text>
                  </Pressable>
                </>
              ) : showForgotPassword ? (
                <>
                  {forgotStep === 'request-code' ? (
                    <>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: primaryText }}>
                        Reset Password
                      </Text>
                      <Text style={helperTextStyle}>
                        Enter your email to receive a 6-digit reset code.
                      </Text>
                      <TextInput
                        style={inputStyle}
                        value={resetEmail}
                        onChangeText={setResetEmail}
                        placeholder='Email address'
                        placeholderTextColor={placeholderText}
                        autoCapitalize='none'
                        autoCorrect={false}
                        keyboardType='email-address'
                        textContentType='emailAddress'
                        autoComplete='email'
                        returnKeyType='send'
                        onSubmitEditing={() => {
                          void handleRequestResetCode();
                        }}
                      />
                      {resetError ? (
                        <Text style={{ fontSize: 13, color: errorText, lineHeight: 20 }}>
                          {resetError}
                        </Text>
                      ) : null}
                      {resetMessage ? (
                        <Text style={{ fontSize: 13, color: successText, lineHeight: 20 }}>
                          {resetMessage}
                        </Text>
                      ) : null}
                      <AuthButton
                        label={isResetLoading ? 'Sending...' : 'Send Code'}
                        onPress={() => {
                          void handleRequestResetCode();
                        }}
                        disabled={isResetLoading || !resetEmail.trim()}
                      />
                    </>
                  ) : null}

                  {forgotStep === 'reset-password' ? (
                    <>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: primaryText }}>
                        Enter Reset Code
                      </Text>
                      <Text style={helperTextStyle}>
                        We sent a 6-digit code to {resetEmail.trim()}.
                      </Text>
                      <TextInput
                        style={[inputStyle, { textAlign: 'center', letterSpacing: 6 }]}
                        value={resetCode}
                        onChangeText={value => setResetCode(value.replace(/\D/g, '').slice(0, 6))}
                        placeholder='000000'
                        placeholderTextColor={placeholderText}
                        keyboardType='number-pad'
                        maxLength={6}
                        textContentType='oneTimeCode'
                      />
                      <TextInput
                        style={inputStyle}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        placeholder='New password'
                        placeholderTextColor={placeholderText}
                        secureTextEntry
                        textContentType='newPassword'
                        autoComplete='new-password'
                      />
                      <TextInput
                        style={inputStyle}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder='Confirm new password'
                        placeholderTextColor={placeholderText}
                        secureTextEntry
                        textContentType='newPassword'
                        autoComplete='new-password'
                        returnKeyType='go'
                        onSubmitEditing={() => {
                          void handleResetPassword();
                        }}
                      />
                      <Text style={helperTextStyle}>{PASSWORD_REQUIREMENTS}</Text>
                      {resetError ? (
                        <Text style={{ fontSize: 13, color: errorText, lineHeight: 20 }}>
                          {resetError}
                        </Text>
                      ) : null}
                      <AuthButton
                        label={isResetLoading ? 'Resetting...' : 'Reset Password'}
                        onPress={() => {
                          void handleResetPassword();
                        }}
                        disabled={
                          isResetLoading ||
                          resetCode.length !== 6 ||
                          !newPassword ||
                          !confirmPassword
                        }
                      />
                    </>
                  ) : null}

                  {forgotStep === 'success' ? (
                    <>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: successText }}>
                        Password reset successful
                      </Text>
                      <Text style={helperTextStyle}>
                        {resetMessage || 'You can now sign in with your new password.'}
                      </Text>
                      <AuthButton
                        label='Back to Sign In'
                        onPress={() => {
                          resetForgotPasswordState();
                          setAuthMode('email');
                        }}
                      />
                    </>
                  ) : null}

                  {forgotStep !== 'success' ? (
                    <Pressable
                      onPress={() => {
                        resetForgotPasswordState();
                        setAuthMode('email');
                      }}
                      style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}
                    >
                      <Text style={{ fontSize: 13, color: secondaryText, fontWeight: '600' }}>
                        Back to sign in
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>
          )}
        </View>

        <View style={{ paddingTop: 32 }}>
          <Text style={{ fontSize: 12, color: secondaryText }}>
            &copy; {new Date().getFullYear()} Xyne Spaces. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
