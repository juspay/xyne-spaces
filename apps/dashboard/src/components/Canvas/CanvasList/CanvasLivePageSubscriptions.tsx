import React, { useCallback, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { CanvasPageSubscription } from './CanvasPageSubscription';

type PageProps = ComponentProps<typeof CanvasPageSubscription>;
type Props = PageProps & {
  onFirstPageComplete: (
    ...args: [...Parameters<PageProps['onPageComplete']>, isPaginationPage: boolean]
  ) => void;
};

/** Keep the newest page live while the current cursor watches older results. */
export function CanvasLivePageSubscriptions({
  cursor,
  onFirstPageComplete,
  onLoadingChange,
  onCachedPage,
  ...props
}: Props): React.ReactElement {
  const activeCursor = useRef(cursor);
  useLayoutEffect(() => {
    activeCursor.current = cursor;
  }, [cursor]);

  const handleFirstPageComplete = useCallback<PageProps['onPageComplete']>(
    (page, previousIds, pageSize) => {
      onFirstPageComplete(page, previousIds, pageSize, activeCursor.current === null);
    },
    [onFirstPageComplete],
  );
  const handleFirstPageLoading = useCallback(
    (loading: boolean) => {
      if (activeCursor.current === null) onLoadingChange(loading);
    },
    [onLoadingChange],
  );

  return (
    <>
      <CanvasPageSubscription
        {...props}
        cursor={null}
        onPageComplete={handleFirstPageComplete}
        onLoadingChange={handleFirstPageLoading}
        onCachedPage={onCachedPage}
      />
      {cursor && (
        <CanvasPageSubscription
          {...props}
          key={`${cursor.updatedAt}:${cursor.id}`}
          cursor={cursor}
          onLoadingChange={onLoadingChange}
        />
      )}
    </>
  );
}
