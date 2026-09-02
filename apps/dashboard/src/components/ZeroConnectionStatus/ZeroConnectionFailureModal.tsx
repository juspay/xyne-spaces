import { ReactElement } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '../ui/Button/Button';
import { isElectronApp } from '../../utils/electronApp';
import { logger, Event as LoggerEvent } from '../../utils/logger';
import { useAuth } from '@/hooks/useAuth';

interface ZeroConnectionFailureModalProps {
  onClose?: () => void;
}

export const ZeroConnectionFailureModal = ({
  onClose,
}: ZeroConnectionFailureModalProps = {}): ReactElement => {
  const isElectron = isElectronApp();
  const { logout } = useAuth();

  const handleRefresh = (): void => {
    logger.info(LoggerEvent.APP_REFRESH, {
      trigger: 'USER_CLICK_CONNECTION_FAILURE_MODAL',
    });

    logout();
  };

  return (
    <div
      className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm'
      role='presentation'
    >
      <div
        className='bg-card rounded-lg shadow-2xl p-8 max-w-md w-full mx-4 relative'
        role='dialog'
        aria-labelledby='modal-title'
        aria-describedby='modal-description'
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className='absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors'
            aria-label='Close modal'
            data-track-category='ZERO_CONNECTION'
            data-track-name='CLOSE_CONNECTION_FAILURE_MODAL'
          >
            <X className='w-5 h-5' />
          </button>
        )}

        {/* Icon */}
        <div className='flex justify-center mb-4'>
          <div className='w-16 h-16 rounded-full bg-red-100 flex items-center justify-center'>
            <svg
              className='w-8 h-8 text-red-600'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 id='modal-title' className='text-xl font-semibold text-foreground text-center mb-2'>
          Connection Lost
        </h2>

        {/* Description */}
        <p id='modal-description' className='text-muted-foreground text-center mb-6'>
          {isElectron
            ? 'The connection to the server has been lost. Click below to reload the app.'
            : 'The connection to the server has been lost. Click below to refresh.'}
        </p>

        {/* Refresh Button — behaviour differs between Electron and web */}
        <Button
          variant='ghost'
          onClick={handleRefresh}
          trackId='reload_app_on_connection_failure'
          className='w-full py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-all duration-200 bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
          data-track-category='ZERO_CONNECTION'
          data-track-name='RELOAD_APP_ON_CONNECTION_FAILURE'
        >
          <RefreshCw className='w-5 h-5' strokeWidth={2.5} />
          <span>{isElectron ? 'Reload App' : 'Refresh Connection'}</span>
        </Button>
      </div>
    </div>
  );
};
