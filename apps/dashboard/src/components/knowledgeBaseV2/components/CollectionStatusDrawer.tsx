import React, { useMemo } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { Folder, X } from 'lucide-react';
import { IngestionStatus } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { FileCardPreviewV2 } from './FileCardPreviewV2';

export interface StatusDrawerTarget {
  id: string;
  name: string;
  /** "#channel · project" line, precomputed by the screen. */
  location?: string;
}

interface CollectionStatusDrawerProps {
  collection: StatusDrawerTarget | null;
  onClose: () => void;
}

type FileState = 'ready' | 'processing' | 'queued' | 'failed';

function stateOf(status: string | null | undefined): FileState {
  const s = (status ?? '').toUpperCase() as IngestionStatus;
  if (s === IngestionStatus.PROCESSING) return 'processing';
  if (s === IngestionStatus.PENDING) return 'queued';
  if (s === IngestionStatus.FAILED) return 'failed';
  return 'ready';
}

const PILL: Record<FileState, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-green-50 text-green-700 ring-green-200' },
  processing: { label: 'Processing', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  queued: { label: 'Queued', className: 'bg-gray-100 text-gray-600 ring-gray-200' },
  failed: { label: 'Upload failed', className: 'bg-red-50 text-red-700 ring-red-200' },
};

function extOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() ?? 'file') : 'file';
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${String(parseFloat((bytes / Math.pow(k, i)).toFixed(1)))} ${sizes[i]}`;
}

/**
 * Right-side drawer listing every file in a collection with its ingestion
 * status. Read-only: shows status pills, sizes, and a generic failure note.
 * Opens when `collection` is set (from clicking a card's status badge).
 */
export const CollectionStatusDrawer: React.FC<CollectionStatusDrawerProps> = ({
  collection,
  onClose,
}) => {
  const open = collection !== null;

  const [files] = useCachedQuery(
    queries.collectionFilesByRoot({ rootCollectionId: collection?.id ?? '' }),
    open,
  );

  const { rows, ready, processing, queued, failed } = useMemo(() => {
    const list = (files ?? []).map(f => ({
      id: f.id,
      name: f.name,
      size: f.attachment?.size ?? 0,
      state: stateOf(f.ingestionStatus),
    }));
    return {
      rows: list,
      ready: list.filter(r => r.state === 'ready').length,
      processing: list.filter(r => r.state === 'processing').length,
      queued: list.filter(r => r.state === 'queued').length,
      failed: list.filter(r => r.state === 'failed').length,
    };
  }, [files]);

  // Header pill mirrors the card badge's priority: failures first, then active
  // work, then queued, else all-ready.
  const headerPill =
    failed > 0
      ? { label: 'Needs attention', className: 'bg-red-50 text-red-600 ring-red-200' }
      : processing > 0
        ? { label: 'Processing', className: 'bg-amber-50 text-amber-700 ring-amber-200' }
        : queued > 0
          ? { label: 'Queued', className: 'bg-gray-100 text-gray-600 ring-gray-200' }
          : { label: 'Ready', className: 'bg-green-50 text-green-700 ring-green-200' };

  const summary = [
    ready > 0 ? `${String(ready)} file${ready === 1 ? '' : 's'} ready` : null,
    processing > 0 ? `${String(processing)} processing` : null,
    queued > 0 ? `${String(queued)} queued` : null,
    failed > 0 ? `${String(failed)} file${failed === 1 ? '' : 's'} failed to read` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      direction='right'
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className='fixed inset-0 z-50 bg-black/40' />
        <DrawerPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col',
            'bg-background shadow-2xl focus:outline-none',
          )}
        >
          <DrawerPrimitive.Title className='sr-only'>
            {collection?.name ?? 'Collection'} ingestion status
          </DrawerPrimitive.Title>

          {/* Header */}
          <div className='flex items-start justify-between gap-3 border-b border-border px-5 py-4'>
            <div className='flex min-w-0 items-center gap-3'>
              <div className='grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-secondary'>
                <Folder className='h-5 w-5 text-muted-foreground' strokeWidth={1.75} />
              </div>
              <div className='min-w-0'>
                <div className='truncate text-[15px] font-semibold text-foreground'>
                  {collection?.name}
                </div>
                {collection?.location ? (
                  <div className='truncate text-[12px] text-muted-foreground'>
                    {collection.location}
                  </div>
                ) : null}
              </div>
            </div>
            <div className='flex flex-shrink-0 items-center gap-2'>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-[12px] font-medium ring-1',
                  headerPill.className,
                )}
              >
                {headerPill.label}
              </span>
              <button
                type='button'
                aria-label='Close'
                onClick={onClose}
                data-track-category='knowledge-base'
                data-track-name='close-collection-status'
                className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
              >
                <X className='h-4 w-4' strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {/* Summary */}
          {summary ? (
            <div className='px-5 pt-4 text-[12px] text-muted-foreground'>{summary}</div>
          ) : null}

          {/* File list */}
          <div className='flex-1 overflow-y-auto px-5 py-4'>
            <div className='space-y-2'>
              {rows.map(row => {
                const pill = PILL[row.state];
                const size = formatSize(row.size);
                return (
                  <div
                    key={row.id}
                    className={cn(
                      'rounded-xl border px-3 py-2.5',
                      row.state === 'failed' ? 'border-red-200 bg-red-50/40' : 'border-border',
                    )}
                  >
                    <div className='flex items-center gap-3'>
                      <div className='flex-shrink-0'>
                        <FileCardPreviewV2 format={extOf(row.name)} size='sm' />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-[13.5px] font-medium text-foreground'>
                          {row.name}
                        </div>
                        {size ? (
                          <div className='text-[11.5px] text-muted-foreground'>{size}</div>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          'flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium ring-1',
                          pill.className,
                        )}
                      >
                        {pill.label}
                      </span>
                    </div>
                    {row.state === 'failed' ? (
                      <div className='mt-2 pl-1 text-[11.5px] text-red-500'>
                        This file couldn&apos;t be processed.
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {rows.length === 0 ? (
                <div className='py-8 text-center text-[12px] text-muted-foreground'>
                  No files in this collection yet.
                </div>
              ) : null}
            </div>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
};
