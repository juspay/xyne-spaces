import { ReactElement, useState } from 'react';
import { AlertTriangle, Plug, Unplug } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { cn } from '../../../utils/classNames';

interface DeskConnectionCardProps {
  label: string;
  value: string | null;
  isConnected: boolean;
  onDisconnect: () => Promise<void>;
  onReconnect?: () => Promise<void>;
  disconnectTitle: string;
  disconnectPrompt: string;
  disconnectBullets: string[];
  trackCategory: string;
}

export const DeskConnectionCard = ({
  label,
  value,
  isConnected,
  onDisconnect,
  onReconnect,
  disconnectTitle,
  disconnectPrompt,
  disconnectBullets,
  trackCategory,
}: DeskConnectionCardProps): ReactElement => {
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      await onDisconnect();
      setShowDisconnectConfirm(false);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleReconnect = async (): Promise<void> => {
    if (!onReconnect) return;
    setIsReconnecting(true);
    try {
      await onReconnect();
    } finally {
      setIsReconnecting(false);
    }
  };

  return (
    <div className='flex flex-col gap-[8px]'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex flex-col gap-[4px] min-w-0 flex-1'>
          <span className='text-desk-label shrink-0'>{label}</span>
          <span className='text-sm text-muted-foreground truncate' title={value ?? undefined}>
            {value ?? '—'}
          </span>
        </div>
        {isConnected ? (
          <button
            type='button'
            onClick={() => setShowDisconnectConfirm(true)}
            disabled={isDisconnecting}
            className={cn(
              'inline-flex h-[32px] shrink-0 items-center gap-1.5 px-[10px] py-1.5 text-desk-label',
              'text-desk-destructive border rounded-[10px] shadow-sm',
              'hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            data-track-category={trackCategory}
            data-track-name='open-disconnect-confirm'
          >
            <Unplug size={14} className='shrink-0' />
            Disconnect
          </button>
        ) : (
          onReconnect && (
            <button
              type='button'
              onClick={() => void handleReconnect()}
              disabled={isReconnecting}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium',
                'text-foreground border border-border rounded-[10px] bg-background shadow-sm',
                'hover:bg-desk-accent-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              data-track-category={trackCategory}
              data-track-name='reconnect'
            >
              <Plug size={14} className='shrink-0' />
              {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
          )
        )}
      </div>

      <Dialog
        open={showDisconnectConfirm}
        onOpenChange={open => !open && setShowDisconnectConfirm(false)}
        title={disconnectTitle}
      >
        <div className='p-5 flex flex-col gap-3'>
          <div className='flex gap-3'>
            <AlertTriangle size={18} className='flex-shrink-0 text-amber-500 mt-0.5' />
            <div className='flex flex-col gap-2 text-sm'>
              <p className='text-foreground'>{disconnectPrompt}</p>
              <ul className='text-muted-foreground list-disc pl-4 space-y-1 text-xs'>
                {disconnectBullets.map(bullet => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className='flex justify-end gap-2 pt-2'>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setShowDisconnectConfirm(false)}
              data-track-category='desk-integration'
              data-track-name='CANCEL_DISCONNECT'
              disabled={isDisconnecting}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
              data-track-category={trackCategory}
              data-track-name='confirm-disconnect'
            >
              {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
