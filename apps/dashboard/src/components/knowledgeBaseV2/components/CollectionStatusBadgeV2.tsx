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
    icon = <Loader2 className='h-3.5 w-3.5 animate-spin text-status-pending' strokeWidth={2} />;
    tooltip = `Currently processing ${String(current)} of ${String(total)} files…`;
  } else if (status === IngestionStatus.PENDING) {
    // No file is actively processing yet, so everything not-done is queued.
    const queued = Math.max(total - ingested - failed, 0);
    icon = <Loader2 className='h-3.5 w-3.5 animate-spin text-status-new' strokeWidth={2} />;
    tooltip = `${String(queued)} file${queued === 1 ? '' : 's'} waiting to be processed`;
  } else if (status === IngestionStatus.FAILED) {
    icon = <AlertCircle className='h-3.5 w-3.5 text-status-failure' strokeWidth={2} />;
    tooltip =
      `${String(ingested)} file${ingested === 1 ? '' : 's'} ready · ` +
      `${String(failed)} file${failed === 1 ? '' : 's'} failed to read`;
  } else {
    icon = <CheckCircle2 className='h-3.5 w-3.5 text-status-success' strokeWidth={2} />;
    tooltip = `All ${String(total)} file${total === 1 ? '' : 's'} ready to search`;
  }

  const baseClass = 'grid h-5 w-5 place-items-center rounded-full bg-background ring-1 ring-border';

  return (
    <Tooltip content={tooltip} side='top'>
      {onOpenStatus ? (
        <button
          type='button'
          aria-label={tooltip}
          onClick={ev => {
            ev.stopPropagation();
            onOpenStatus(entry);
          }}
          onKeyDown={ev => {
            // The parent folder card is a role="button" div whose own onKeyDown
            // navigates into the folder on Enter/Space. Stop those keys here so
            // activating the badge opens the drawer only (the native button still
            // fires onClick) — without also bubbling up and navigating.
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.stopPropagation();
            }
          }}
          data-track-category='knowledge-base'
          data-track-name='open-collection-status'
          className={cn(baseClass, 'transition hover:ring-ring/50')}
        >
          {icon}
        </button>
      ) : (
        // No click handler (e.g. subfolders inside a collection) → static indicator.
        <span aria-label={tooltip} className={baseClass}>
          {icon}
        </span>
      )}
    </Tooltip>
  );
};
