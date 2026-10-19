import React, { ReactElement, useState } from 'react';
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
import { Building2, Mail } from 'lucide-react-native';
import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import { requestPasswordResetCode, resetPasswordWithCode } from '@/src/services/AuthServices';
import { GoogleLogo } from '@/src/assets/icons/GoogleLogo';
import { MicrosoftLogo } from '@/src/assets/icons/MicrosoftLogo';
import { XyneLogo } from '@/src/assets/icons/XyneLogo';
import { useReportStartupReady } from '@/src/observability/logging/hooks/startup/useReportStartupReady';
import { IS_COMMUNITY_APP } from '@/src/config';
import { CommunityLoginScreen } from '@/src/screens/CommunityLoginScreen';

type AuthMode = 'providers' | 'email' | 'forgot-password';
type ForgotPasswordStep = 'request-code' | 'reset-password' | 'success';

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

function AuthButton({
  label,
  onPress,
  disabled,
  icon,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary';
}): ReactElement {
  const bgVar =
    variant === 'primary' ? '--color-auth-primary-btn-bg' : '--color-auth-secondary-btn-bg';
  const fgVar =
    variant === 'primary' ? '--color-auth-primary-btn-text' : '--color-auth-secondary-btn-text';
  const backgroundColor = useCSSVariable(bgVar) as string;
  const textColor = useCSSVariable(fgVar) as string;
  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor,
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 16,
        minHeight: 48,
        opacity: disabled ? 0.65 : 1,
      }}
      onPress={onPress}
      disabled={disabled}
    >
      {icon}
      <Text style={{ fontSize: 14, fontWeight: '600', color: textColor }}>{label}</Text>
    </Pressable>
  );
}

function Divider(): ReactElement {
  const dividerLine = useCSSVariable('--color-auth-divider') as string;
  const secondaryText = useCSSVariable('--color-auth-secondary-text') as string;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: dividerLine }} />
      <Text style={{ fontSize: 12, color: secondaryText }}>or</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: dividerLine }} />
    </View>
  );
}

const LoginScreen = (): ReactElement => {
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
    isLoading,
    pendingAuth,
    selectWorkspace,
    clearPendingAuth,
  } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const isNoOrgAccess = pendingAuth?.kind === 'org_creation_required';

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

  const [authMode, setAuthMode] = useState<AuthMode>('providers');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  const showProviderButtons = authMode === 'providers';
  const showEmailForm = authMode === 'email';
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
        <View
          style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}
        >
          <View style={{ marginBottom: isTablet ? 48 : 32 }}>
            <XyneLogo width={isTablet ? 160 : 120} height={isTablet ? 53 : 40} />
          </View>

          {isNoOrgAccess ? (
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
                  No Organization Access
                </Text>
                <Text
                  style={{
                    fontSize: isTablet ? 16 : 14,
                    color: secondaryText,
                    textAlign: 'center',
                  }}
                >
                  You are not part of any organisation.
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
              ) : isNoOrgAccess ? (
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
                  <Pressable
                    onPress={clearPendingAuth}
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ fontSize: 13, color: linkText, fontWeight: '600' }}>
                      Try with a different account
                    </Text>
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

// The community app has its own login (sign-up, community join); the main app keeps this one.
export default IS_COMMUNITY_APP ? CommunityLoginScreen : LoginScreen;
