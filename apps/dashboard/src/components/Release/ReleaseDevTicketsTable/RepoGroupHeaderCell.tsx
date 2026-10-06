import type { ReactElement } from 'react';
import type { ICellRendererParams } from 'ag-grid-community';
import { RepoDot, repoColor } from '../repoVisual';
import { shortenRef } from '../../../routes/ReleaseDetailScreen/releaseReport.utils';
import type { GridRow } from './types';

export const RepoGroupHeaderCell = (params: ICellRendererParams<GridRow>): ReactElement | null => {
  if (params.data?.kind !== 'group') return null;
  const h = params.data.header;
  return (
    <div className='flex h-full items-center gap-2.5 bg-muted/50 px-4'>
      <RepoDot color={repoColor(h.dotKey)} />
      <span className='text-sm font-semibold text-foreground'>{h.label}</span>
      {(h.rangeFrom || h.rangeTo) && (
        <span className='rounded-md bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground'>
          {shortenRef(h.rangeFrom) || '—'}
          <span className='mx-0.5'>→</span>
          {shortenRef(h.rangeTo) || '—'}
        </span>
      )}
      {h.tested !== null && (
        <span className='ml-auto rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
          TESTED {h.tested}/{h.total}
        </span>
      )}
    </div>
  );
};
