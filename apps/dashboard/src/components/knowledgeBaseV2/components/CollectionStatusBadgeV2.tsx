import React from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { IngestionStatus } from '@xyne/shared';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';
import { CollectionChild } from '../../../services/Knowledge/collectionService';

interface CollectionStatusBadgeV2Props {
  entry: CollectionChild;
  /** Opens the per-collection status drawer. Clicking the badge must not
   *  bubble to the card's navigation handler. */
  onOpenStatus?: ((entry: CollectionChild) => void) | undefined;
}

/**
 * Small circular status indicator overlaid on a collection's folder icon at the
 * KB root. Reflects the collection's rolled-up ingestion state and, on click,
 * opens the file-status drawer. Renders nothing for empty collections.
 */
export const CollectionStatusBadgeV2: React.FC<CollectionStatusBadgeV2Props> = ({
  entry,
  onOpenStatus,
}) => {
  const total = entry.fileTotal ?? 0;
  if (total === 0) return null;

  const status = entry.ingestionStatus;
  const ingested = entry.fileIngested ?? 0;
  const failed = entry.fileFailed ?? 0;

  let icon: React.ReactElement;
  let tooltip: string;

  if (status === IngestionStatus.PROCESSING) {
    const current = Math.min(ingested + 1, total);
    icon = <Loader2 className='h-3.5 w-3.5 animate-spin text-amber-500' strokeWidth={2} />;
    tooltip = `Currently processing ${String(current)} of ${String(total)} files…`;
  } else if (status === IngestionStatus.PENDING) {
    // No file is actively processing yet, so everything not-done is queued.
    const queued = Math.max(total - ingested - failed, 0);
    icon = <Loader2 className='h-3.5 w-3.5 animate-spin text-gray-400' strokeWidth={2} />;
    tooltip = `${String(queued)} file${queued === 1 ? '' : 's'} waiting to be processed`;
  } else if (status === IngestionStatus.FAILED) {
    icon = <AlertCircle className='h-3.5 w-3.5 text-red-500' strokeWidth={2} />;
    tooltip =
      `${String(ingested)} file${ingested === 1 ? '' : 's'} ready · ` +
      `${String(failed)} file${failed === 1 ? '' : 's'} failed to read`;
  } else {
    icon = <CheckCircle2 className='h-3.5 w-3.5 text-green-600' strokeWidth={2} />;
    tooltip = `All ${String(total)} file${total === 1 ? '' : 's'} ready to search`;
  }

  return (
    <Tooltip content={tooltip} side='top'>
      <button
        type='button'
        aria-label={tooltip}
        onClick={ev => {
          ev.stopPropagation();
          onOpenStatus?.(entry);
        }}
        data-track-category='knowledge-base'
        data-track-name='open-collection-status'
        className={cn(
          'grid h-5 w-5 place-items-center rounded-full bg-background ring-1 ring-border',
          'transition hover:ring-ring/50',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
};
