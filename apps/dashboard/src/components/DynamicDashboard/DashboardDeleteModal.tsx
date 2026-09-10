import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';

export interface DashboardDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  dashboardName?: string | undefined;
  isDeleting?: boolean;
}

export const DashboardDeleteModal = ({
  onClose,
  onConfirm,
  dashboardName,
  isDeleting = false,
}: DashboardDeleteModalProps): ReactElement => {
  return (
    <div className='p-6'>
      <h2 className='text-lg font-semibold text-foreground mb-2'>Delete Dashboard</h2>
      <p className='text-muted-foreground mb-6'>
        Are you sure you want to delete
        {dashboardName ? ` "${dashboardName}"` : ' this dashboard'}? This action cannot be undone.
      </p>
      <div className='flex justify-end gap-3'>
        <Button
          variant='secondary'
          onClick={onClose}
          disabled={isDeleting}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Cancel_Delete_Dashboard'
        >
          Cancel
        </Button>
        <Button
          variant='destructive'
          onClick={onConfirm}
          disabled={isDeleting}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Confirm_Delete_Dashboard'
        >
          {isDeleting && <Loader2 size={14} className='mr-1.5 animate-spin' />}
          {isDeleting ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </div>
  );
};
