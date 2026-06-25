import { useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';

// Star state is a first-class `isStarred` column on saved_user_configurations, synced via Zero.
// Toggling is a single-field update — it never touches the view's filter value rows.
export interface StarViewConfig {
  id: string;
  isStarred?: boolean;
}

export const isViewStarred = (view: StarViewConfig): boolean => view.isStarred === true;

export function useViewStar(): { toggleStar: (view: StarViewConfig) => void } {
  const zero = useZero();
  const zeroRef = useRef(zero);
  zeroRef.current = zero;

  const toggleStar = useCallback((view: StarViewConfig): void => {
    void zeroRef.current
      .mutate(
        mutators.savedUserConfiguration.update({
          configId: view.id,
          isStarred: !isViewStarred(view),
          timestamp: Date.now(),
        }),
      )
      .server.then(
        res => {
          if (res.type === 'error') toast.error(res.error?.message ?? 'Failed to update star');
        },
        () => toast.error('Failed to update star'),
      );
  }, []);

  return { toggleStar };
}
