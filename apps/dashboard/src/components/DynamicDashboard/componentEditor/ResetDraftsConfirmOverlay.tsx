import { AlertTriangle } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../../ui/Button';

interface ResetDraftsConfirmOverlayProps {
  fieldName: string;
  draftedTypeLabels: ReadonlyArray<string>;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ResetDraftsConfirmOverlay = ({
  fieldName,
  draftedTypeLabels,
  onCancel,
  onConfirm,
}: ResetDraftsConfirmOverlayProps): ReactElement => {
  const isSingular = draftedTypeLabels.length === 1;
  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center'>
      <button
        type='button'
        aria-label='Dismiss'
        onClick={onCancel}
        data-track-category='COMPONENT_EDITOR'
        data-track-name='Dismiss_Field_Change_Overlay'
        className='absolute inset-0 bg-black/50'
      />
      <div className='relative w-[min(440px,92vw)] bg-popover rounded-lg shadow-lg border border-border p-5'>
        <div className='flex items-start gap-3'>
          <div className='flex items-center justify-center w-9 h-9 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-500 shrink-0'>
            <AlertTriangle size={18} />
          </div>
          <div className='min-w-0'>
            <h3 className='text-sm font-semibold text-foreground'>
              Changing the {fieldName} will reset your {isSingular ? 'draft' : 'drafts'}
            </h3>
            <p className='text-xs text-muted-foreground mt-1.5 leading-relaxed'>
              You&apos;ve built{' '}
              <span className='font-medium text-foreground/90'>{draftedTypeLabels.join(', ')}</span>{' '}
              for this component. Its column references may not exist on the new schema, so the{' '}
              {isSingular ? 'draft' : 'drafts'} will be cleared.
            </p>
          </div>
        </div>
        <div className='flex items-center justify-end gap-2 mt-5'>
          <Button
            variant='secondary'
            onClick={onCancel}
            data-track-category='COMPONENT_EDITOR'
            data-track-name='CANCEL_RESET_DRAFTS'
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            data-track-category='COMPONENT_EDITOR'
            data-track-name='CONFIRM_RESET_DRAFTS'
          >
            Reset &amp; continue
          </Button>
        </div>
      </div>
    </div>
  );
};
