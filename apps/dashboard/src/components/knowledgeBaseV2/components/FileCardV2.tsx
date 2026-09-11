import React from 'react';
import { cn } from '../../../utils/classNames';
import { FileCardPreviewV2 } from './FileCardPreviewV2';
import { IngestStatusV2 } from './IngestStatusV2';
import { CollectionStatusBadgeV2 } from './CollectionStatusBadgeV2';
import { CollectionChild } from '../../../services/Knowledge/collectionService';
import { Folder, Pencil, Share2, Trash2 } from 'lucide-react';
import { useInlineEdit } from './useInlineEdit';
import { XyneAIStar } from '../../icons/xyne-ai';
import { FileFailedBadgeV2 } from './FileFailedBadgeV2';

interface FileCardV2Props {
  file: CollectionChild;
  onClick: () => void;
  onDelete?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  /** Opens Ask AI scoped to this specific file (kbDocId). */
  onAskAI?: (() => void) | undefined;
  /** Opens the copy-link share dialog for this file. */
  onShare?: (() => void) | undefined;
  /** Inline-rename mode. When true the title becomes an editable input;
   *  Enter / blur calls `onRenameCommit`, Escape calls `onRenameCancel`. */
  isRenaming?: boolean;
  onRenameCommit?: ((next: string) => void | Promise<void>) | undefined;
  onRenameCancel?: (() => void) | undefined;
}

// Inline editable name. Renders an `<input>` in place of the title span when
// the card is in rename mode. Port of xyne-search/ui2/src/components/
// InlineRenameField.tsx — same UX (Enter commit, Escape cancel, blur save).
interface InlineNameProps {
  initial: string;
  onCommit: (next: string) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
}

const InlineName: React.FC<InlineNameProps> = ({ initial, onCommit, onCancel, className }) => {
  const { value, setValue, inputRef, onKeyDown, onBlur } = useInlineEdit({
    initial,
    onCommit,
    onCancel,
  });
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={e => e.stopPropagation()}
      aria-label='Rename'
      data-track-category='knowledge-base'
      data-track-name='rename-card-inline'
      className={cn(
        'h-6 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-[13.5px] font-medium text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring',
        className,
      )}
    />
  );
};

// Shared hover action button (top-right of each card). Kept inline so
// File + Folder cards render the same chip without diverging visually.
interface HoverActionProps {
  label: string;
  trackName: string;
  intent?: 'neutral' | 'danger';
  onClick: (ev: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

const HoverAction: React.FC<HoverActionProps> = ({
  label,
  trackName,
  intent = 'neutral',
  onClick,
  children,
}) => (
  <button
    type='button'
    aria-label={label}
    title={label}
    onClick={onClick}
    data-track-category='knowledge-base'
    data-track-name={trackName}
    className={cn(
      'grid h-7 w-7 place-items-center rounded-md bg-background/80 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition group-hover:opacity-100 focus-visible:opacity-100',
      intent === 'danger'
        ? 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40'
        : 'hover:bg-muted hover:text-foreground',
    )}
  >
    {children}
  </button>
);

function extOf(name: string): string | undefined {
  const parts = name.split('.');
  if (parts.length < 2) return undefined;
  return parts[parts.length - 1]?.toLowerCase();
}

export const FileCardV2: React.FC<FileCardV2Props> = ({
  file,
  onClick,
  onDelete,
  onRename,
  onAskAI,
  onShare,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
}) => {
  const ext = extOf(file.name) || 'file';

  return (
    <div className='group relative'>
      <button
        type='button'
        onClick={isRenaming ? undefined : onClick}
        className={cn(
          // Surface uses `bg-background` so the card blends with the
          // knowledge-base page background instead of the slightly warm
          // `bg-secondary` token (which read as yellowish against the page).
          'bg-background flex w-full flex-col items-start gap-3 rounded-2xl border p-4 text-left transition',
          String(file.ingestionStatus) === 'PENDING' ||
            String(file.ingestionStatus) === 'PROCESSING'
            ? 'animate-pulse border-ring/60 ring-1 ring-ring/25'
            : 'border-border',
          isRenaming ? '' : 'hover:border-ring/40 hover:bg-muted active:scale-[0.99]',
        )}
        title={file.name}
        data-track-category='knowledge-base'
        data-track-name='open-file-card'
      >
        <div className='relative pl-1 pt-1'>
          <FileCardPreviewV2 format={ext} size='md' />
          {/* Bottom-right, matching FolderCardV2's CollectionStatusBadgeV2
              corner — FileCardPreviewV2's format banner moved to top-right
              to free this corner up.
              z-10 — FileCardPreviewV2's thumbnail/banner sit at z-[1]/z-[2],
              which otherwise outrank this z-auto badge and clip it. */}
          <span className='absolute -right-1 -bottom-1 z-10'>
            <FileFailedBadgeV2 status={file.ingestionStatus} />
          </span>
        </div>
        <span className='flex w-full min-w-0 flex-col gap-0.5'>
          <span className='flex min-w-0 items-center gap-1.5'>
            {isRenaming && onRenameCommit && onRenameCancel ? (
              <InlineName initial={file.name} onCommit={onRenameCommit} onCancel={onRenameCancel} />
            ) : (
              <span className='truncate text-[13.5px] font-medium text-foreground'>
                {file.name}
              </span>
            )}
            <IngestStatusV2 status={file.ingestionStatus} />
          </span>
          {file.size > 0 ? (
            <span className='truncate text-[11.5px] text-muted-foreground'>
              {formatFileSize(file.size)}
            </span>
          ) : null}
        </span>
      </button>
      {!isRenaming && (onAskAI || onShare || onRename || onDelete) ? (
        <div className='absolute right-2 top-2 z-10 flex gap-1'>
          {onAskAI ? (
            <HoverAction
              label={`Ask AI about ${file.name}`}
              trackName='ask-ai-file-card'
              onClick={ev => {
                ev.stopPropagation();
                onAskAI();
              }}
            >
              <XyneAIStar size={14} />
            </HoverAction>
          ) : null}
          {onShare ? (
            <HoverAction
              label={`Share ${file.name}`}
              trackName='share-file-card'
              onClick={ev => {
                ev.stopPropagation();
                onShare();
              }}
            >
              <Share2 className='h-3.5 w-3.5' strokeWidth={1.75} />
            </HoverAction>
          ) : null}
          {onRename ? (
            <HoverAction
              label={`Rename ${file.name}`}
              trackName='rename-file-card'
              onClick={ev => {
                ev.stopPropagation();
                onRename();
              }}
            >
              <Pencil className='h-3.5 w-3.5' strokeWidth={1.75} />
            </HoverAction>
          ) : null}
          {onDelete ? (
            <HoverAction
              label={`Delete ${file.name}`}
              trackName='delete-file-card'
              intent='danger'
              onClick={ev => {
                ev.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className='h-3.5 w-3.5' strokeWidth={1.75} />
            </HoverAction>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

interface FolderCardV2Props {
  folder: CollectionChild;
  onClick: () => void;
  /** Optional override for the subtitle. Defaults to "Folder". The
   *  collections view passes "Collection" / "Empty collection" / "N items"
   *  so the root cards mirror xyne-search /kb. */
  caption?: string;
  onDelete?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  /** Opens the share dialog for this entry — the full access-management
   *  dialog at the KB root (a collection card), or the copy-link-only
   *  dialog for a regular subfolder. See KnowledgeBaseV2Screen's onShare. */
  onShare?: (() => void) | undefined;
  /** Opens Ask AI scoped to this folder's owning collection (there's no
   *  per-folder scope — see KnowledgeBaseV2Screen's onAskAIAboutEntry). */
  onAskAI?: (() => void) | undefined;
  /** Opens the per-collection ingestion status drawer. Wired at the KB root
   *  only; clicking the badge must not trigger folder navigation. */
  onOpenStatus?: ((entry: CollectionChild) => void) | undefined;
  /** Inline-rename mode (see FileCardV2Props for details). */
  isRenaming?: boolean;
  onRenameCommit?: ((next: string) => void | Promise<void>) | undefined;
  onRenameCancel?: (() => void) | undefined;
}

export const FolderCardV2: React.FC<FolderCardV2Props> = ({
  folder,
  onClick,
  caption,
  onDelete,
  onRename,
  onShare,
  onAskAI,
  onOpenStatus,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
}) => {
  return (
    <div className='group relative'>
      {/* Rendered as a role=button div (not a <button>) — matches FileCardV2's
          structure so mixed grids line up. The status badge is a real nested
          button overlaid on the folder glyph, so it needs its own
          stopPropagation to avoid triggering navigation. */}
      <div
        role='button'
        tabIndex={isRenaming ? -1 : 0}
        onClick={isRenaming ? undefined : onClick}
        onKeyDown={
          isRenaming
            ? undefined
            : (e): void => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick();
                }
              }
        }
        className={cn(
          // Matches FileCardV2's surface so mixed folder + file grids feel
          // consistent across light and dark themes.
          'ai-page-bg flex w-full flex-col items-start gap-3 rounded-2xl border border-border p-4 text-left transition',
          isRenaming
            ? ''
            : 'cursor-pointer hover:border-ring/40 hover:bg-muted active:scale-[0.99]',
        )}
        title={folder.name}
        data-track-category='knowledge-base'
        data-track-name='open-folder-card'
      >
        {/* Plain outline glyph — same bounding box FileCardPreviewV2 reserves
            so rows line up evenly across mixed folder + file grids. */}
        <div className='pl-1 pt-1'>
          <div className='relative flex h-[4.5rem] w-14 items-center justify-center'>
            <Folder className='h-10 w-10 text-muted-foreground' strokeWidth={1.5} />
            <span className='absolute bottom-2 right-0'>
              <CollectionStatusBadgeV2 entry={folder} onOpenStatus={onOpenStatus} />
            </span>
          </div>
        </div>
        <span className='flex w-full min-w-0 flex-col gap-0.5'>
          <span className='flex min-w-0 items-center gap-1.5'>
            {isRenaming && onRenameCommit && onRenameCancel ? (
              <InlineName
                initial={folder.name}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
              />
            ) : (
              <span className='truncate text-[13.5px] font-medium text-foreground'>
                {folder.name}
              </span>
            )}
          </span>
          <span
            className='truncate text-[11.5px] text-muted-foreground'
            title={caption ?? 'Folder'}
          >
            {caption ?? 'Folder'}
          </span>
        </span>
      </div>
      {!isRenaming && (onAskAI || onShare || onRename || onDelete) ? (
        <div className='absolute right-2 top-2 z-10 flex gap-1'>
          {onAskAI ? (
            <HoverAction
              label={`Ask AI about ${folder.name}`}
              trackName='ask-ai-folder-card'
              onClick={ev => {
                ev.stopPropagation();
                onAskAI();
              }}
            >
              <XyneAIStar size={14} />
            </HoverAction>
          ) : null}
          {onShare ? (
            <HoverAction
              label={`Share ${folder.name}`}
              trackName='share-folder-card'
              onClick={ev => {
                ev.stopPropagation();
                onShare();
              }}
            >
              <Share2 className='h-3.5 w-3.5' strokeWidth={1.75} />
            </HoverAction>
          ) : null}
          {onRename ? (
            <HoverAction
              label={`Rename ${folder.name}`}
              trackName='rename-folder-card'
              onClick={ev => {
                ev.stopPropagation();
                onRename();
              }}
            >
              <Pencil className='h-3.5 w-3.5' strokeWidth={1.75} />
            </HoverAction>
          ) : null}
          {onDelete ? (
            <HoverAction
              label={`Delete ${folder.name}`}
              trackName='delete-folder-card'
              intent='danger'
              onClick={ev => {
                ev.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className='h-3.5 w-3.5' strokeWidth={1.75} />
            </HoverAction>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
