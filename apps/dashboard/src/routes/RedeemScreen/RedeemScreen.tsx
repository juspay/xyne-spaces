import { ReactElement, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { ThemeProvider } from '@juspay/blend-design-system';
import { useAuth } from '../../hooks/useAuth';
import CreateOrgForm from '../AuthScreen/CreateOrgForm';

const PENDING_INVITATION_KEY = 'pending_invitation_id';

/**
 * Create-organization page (/redeem). Signed-out visitors go through /auth first;
 * AuthScreen sends brand-new domains back here once login completes.
 */
const RedeemScreen = (): ReactElement | null => {
  const {
    isLoading,
    isCreatingOrg,
    isAuthenticated,
    error,
    clearError,
    createOrg,
    logout,
    userExistsButRemoved,
    pendingUserData,
  } = useAuth();
  const orgNameInputRef = useRef<HTMLInputElement>(null);

  if (isAuthenticated) return <Navigate to='/' replace />;

  if (!isCreatingOrg) {
    return isLoading ? null : <Navigate to='/auth' replace />;
  }

  // These cases are explained on the login screen, not here.
  const lowerError = error?.toLowerCase() ?? '';
  if (
    userExistsButRemoved ||
    lowerError.includes('organization already exists for') ||
    lowerError.includes('public email domains') ||
    localStorage.getItem(PENDING_INVITATION_KEY)
  ) {
    return <Navigate to='/auth' replace />;
  }

  const handleUseDifferentAccount = (): void => {
    logout();
    window.location.href = '/auth';
  };

  return (
    <ThemeProvider>
      <div className='h-[100dvh] w-full overflow-y-auto bg-background'>
        <div
          className='flex min-h-full w-full flex-col items-center justify-center gap-8 p-4 py-10 sm:p-8'
          role='main'
          aria-label='Create organization'
        >
          <img src='/svgs/xyne.svg' alt='Xyne Logo' />
          <CreateOrgForm
            isLoading={isLoading}
            isOrganizationNameTaken={
              !!error &&
              (lowerError.includes('organization with name') ||
                lowerError.includes('organization name already exists'))
            }
            signedInEmail={pendingUserData?.email}
            orgNameInputRef={orgNameInputRef}
            onClearError={clearError}
            onSubmit={createOrg}
            onUseDifferentAccount={handleUseDifferentAccount}
          />
        </div>
      </div>
    </ThemeProvider>
  );
};

export default RedeemScreen;
