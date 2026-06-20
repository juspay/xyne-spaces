import React from 'react';
import { ChevronRight } from 'lucide-react';

interface CrumbsV2Props {
  currentCollectionId: string | null;
  currentFolderId: string | null;
  collectionName: string;
  chain: Array<{ id: string; name: string }>;
  onGoToCollections: () => void;
  onGoToParent: (parentId: string | null) => void;
  isAtRoot: boolean;
}

function Sep(): React.ReactElement {
  return (
    <ChevronRight
      className='h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60'
      aria-hidden
      strokeWidth={1.75}
    />
  );
}

export const CrumbsV2: React.FC<CrumbsV2Props> = ({
  currentCollectionId: _currentCollectionId,
  currentFolderId,
  collectionName,
  chain,
  onGoToCollections,
  onGoToParent,
  isAtRoot,
}) => {
  if (isAtRoot) {
    return <span className='text-[13px] font-medium text-foreground'>Knowledge</span>;
  }

  const atCollectionRoot = currentFolderId === null;

  return (
    <nav
      aria-label='Knowledge path'
      className='flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground'
    >
      <button
        type='button'
        onClick={onGoToCollections}
        className='inline-flex items-center rounded-md px-1.5 py-0.5 transition hover:bg-secondary hover:text-foreground'
        data-track-category='knowledge-base'
        data-track-name='breadcrumb-root'
      >
        Knowledge
      </button>
      <Sep />
      {atCollectionRoot ? (
        <span
          aria-current='page'
          className='max-w-[28ch] truncate rounded-md px-1.5 py-0.5 font-medium text-foreground'
          title={collectionName}
        >
          {collectionName}
        </span>
      ) : (
        <button
          type='button'
          onClick={() => onGoToParent(null)}
          className='max-w-[20ch] truncate rounded-md px-1.5 py-0.5 transition hover:bg-secondary hover:text-foreground'
          title={collectionName}
          data-track-category='knowledge-base'
          data-track-name='breadcrumb-collection'
        >
          {collectionName}
        </button>
      )}
      {chain.map((seg, i) => {
        const isLast = i === chain.length - 1;
        return (
          <span key={seg.id} className='flex min-w-0 items-center gap-1'>
            <Sep />
            {isLast ? (
              <span
                aria-current='page'
                className='max-w-[28ch] truncate rounded-md px-1.5 py-0.5 font-medium text-foreground'
                title={seg.name}
              >
                {seg.name}
              </span>
            ) : (
              <button
                type='button'
                onClick={() => onGoToParent(seg.id)}
                className='max-w-[20ch] truncate rounded-md px-1.5 py-0.5 transition hover:bg-secondary hover:text-foreground'
                title={seg.name}
                data-track-category='knowledge-base'
                data-track-name='breadcrumb-folder'
              >
                {seg.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
};
