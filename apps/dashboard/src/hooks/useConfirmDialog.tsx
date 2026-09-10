import { ReactElement, useCallback, useRef, useState } from 'react';
import { Dialog } from '../components/ui/Dialog/Dialog';
import { Button } from '../components/ui/Button/Button';

interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

interface ConfirmDialogState extends Required<Omit<ConfirmDialogOptions, 'variant'>> {
  variant: 'default' | 'destructive';
}

interface UseConfirmDialogResult {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  ConfirmDialog: () => ReactElement | null;
}

export const useConfirmDialog = (): UseConfirmDialogResult => {
  const [state, setState] = useState<ConfirmDialogState | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean): void => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise(resolve => {
      resolverRef.current = resolve;
      setState({
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel ?? 'Continue',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        variant: options.variant ?? 'default',
      });
    });
  }, []);

  const ConfirmDialog = useCallback((): ReactElement | null => {
    if (!state) return null;

    return (
      <Dialog
        open={true}
        onOpenChange={open => {
          if (!open) close(false);
        }}
        title={state.title}
        description={state.description}
      >
        <div className='p-6'>
          <h2 className='text-[18px] font-semibold text-foreground mb-2'>{state.title}</h2>
          <p className='text-[14px] leading-6 text-muted-foreground mb-6'>{state.description}</p>
          <div className='flex justify-end gap-3'>
            <Button
              type='button'
              variant='secondary'
              onClick={() => close(false)}
              data-track-category='confirm_dialog'
              data-track-name='cancel'
            >
              {state.cancelLabel}
            </Button>
            <Button
              type='button'
              variant={state.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => close(true)}
              data-track-category='confirm_dialog'
              data-track-name='confirm'
            >
              {state.confirmLabel}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }, [close, state]);

  return { confirm, ConfirmDialog };
};
