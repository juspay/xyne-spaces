import { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Mail, ArrowLeft } from 'lucide-react';
import { ThemeProvider } from '@juspay/blend-design-system';

/**
 * NoOrganizationAccessScreen - Shown when user is not part of any organization
 *
 * Features:
 * - Clean, professional error page
 * - No login buttons (user is already authenticated but has no access)
 * - Contact admin messaging
 * - Option to try different account
 */
const NoOrganizationAccessScreen = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const message = searchParams.get('message') || 'You are not part of any organisation.';

  const handleGoBack = (): void => {
    // Clear the error and go back to auth screen
    window.location.href = '/auth';
  };

  return (
    <ThemeProvider>
      <div className='min-h-screen w-full overflow-x-hidden overflow-y-auto relative bg-gradient-to-br from-slate-50 to-slate-100'>
        <div className='min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8'>
          <div className='w-full max-w-md flex flex-col items-center gap-8'>
            {/* Logo */}
            <div className='mb-4'>
              <img src='/svgs/xyne.svg' alt='Xyne Logo' className='h-8' />
            </div>

            {/* Icon */}
            <div className='w-20 h-20 bg-amber-100 rounded-2xl flex items-center justify-center'>
              <Building2 className='w-10 h-10 text-amber-600' />
            </div>

            {/* Title */}
            <div className='text-center space-y-2'>
              <h1 className='text-xl font-semibold text-slate-900'>No Organization Access</h1>
              <p className='text-sm text-slate-600'>{message}</p>
            </div>

            {/* Info Card */}
            <div className='w-full p-6 bg-white border border-slate-200 rounded-xl shadow-sm space-y-4'>
              <div className='flex items-start gap-3'>
                <div className='w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5'>
                  <Mail className='w-4 h-4 text-blue-600' />
                </div>
                <div>
                  <h3 className='text-sm font-medium text-slate-900 mb-1'>
                    Contact Your Administrator
                  </h3>
                  <p className='text-sm text-slate-600 leading-relaxed'>
                    Reach out to your organization admin to request access to a workspace. They can
                    send you an invitation to join.
                  </p>
                </div>
              </div>
            </div>

            {/* Back Button */}
            <button
              onClick={handleGoBack}
              className='inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors'
              data-track-category='Auth'
              data-track-name='TryDifferentAccount'
            >
              <ArrowLeft className='w-4 h-4' />
              Try with a different account
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className='absolute bottom-6 left-0 right-0 text-center'>
          <p className='text-xs text-slate-400'>© 2026 Xyne Spaces. All rights reserved.</p>
        </div>
      </div>
    </ThemeProvider>
  );
};

export default NoOrganizationAccessScreen;
