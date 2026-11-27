import { ReactElement } from 'react';
import { TransitKeyUnavailableError } from '@xyne/shared';
import { Button } from './ui/Button';

interface EncryptionSetupErrorProps {
  error: Error;
  onRetry: () => void;
}

/**
 * Shown in place of the app when encryption setup fails: without a transit key Zero stays
 * closed, and the device's key store is never swapped for another, so the user has to see it.
 * It says only whether this device or the connection failed, never the error itself: the cause
 * is in the error-level setup log. The mobile app's EncryptionSetupErrorScreen has the same text.
 */
export function EncryptionSetupError({ error, onRetry }: EncryptionSetupErrorProps): ReactElement {
  const deviceFailed = error instanceof TransitKeyUnavailableError;

  return (
    <div
      data-id='encryption-setup-error'
      className='flex h-screen w-full items-center justify-center bg-background'
    >
      <div className='flex flex-col items-center text-center space-y-4 max-w-xl px-4'>
        <img
          src='/svgs/icons/error.svg'
          alt='Error'
          className='w-40 h-36 select-none theme-invert'
          draggable='false'
        />
        <div className='space-y-2'>
          <p className='text-xl font-semibold text-foreground'>
            {deviceFailed ? "We couldn't secure this device" : "We couldn't connect securely"}
          </p>
          <p className='text-md text-muted-foreground'>
            {deviceFailed
              ? "Your workspace is encrypted, and this device couldn't finish setting up its secure key. Try again, or restart the app. If it keeps happening, contact support."
              : 'Check your internet connection and try again. If it keeps happening, contact support.'}
          </p>
        </div>
        <Button
          onClick={onRetry}
          trackId='retry_encryption_setup'
          data-track-category='EncryptionSetupError'
          data-track-name='Retry'
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
