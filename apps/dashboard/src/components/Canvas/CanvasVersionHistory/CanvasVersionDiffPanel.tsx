import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';
import {
  isVisibleCanvasContentDiffPart,
  type CanvasContentDiffPart,
} from '../../../utils/canvasVersioning';

interface CanvasVersionDiffPanelProps {
  parts: CanvasContentDiffPart[];
  className?: string;
}

const CONTEXT_CHAR_LIMIT = 180;
const CLOSE_CHANGE_GAP_LIMIT = CONTEXT_CHAR_LIMIT * 2;

const trimContextBeforeChange = (value: string): string =>
  value.length > CONTEXT_CHAR_LIMIT ? `...${value.slice(-CONTEXT_CHAR_LIMIT)}` : value;

const trimContextAfterChange = (value: string): string =>
  value.length > CONTEXT_CHAR_LIMIT ? `${value.slice(0, CONTEXT_CHAR_LIMIT)}...` : value;

const appendPart = (hunkParts: CanvasContentDiffPart[], part: CanvasContentDiffPart): void => {
  if (!part.value) return;

  const lastPart = hunkParts[hunkParts.length - 1];
  if (lastPart?.type === part.type) {
    lastPart.value += part.value;
    return;
  }

  hunkParts.push({ ...part });
};

const buildDiffHunks = (parts: CanvasContentDiffPart[]): CanvasContentDiffPart[][] => {
  const hunks: CanvasContentDiffPart[][] = [];
  let currentHunk: CanvasContentDiffPart[] | null = null;
  let pendingPrefix: CanvasContentDiffPart | null = null;

  const finishCurrentHunk = (): void => {
    if (currentHunk?.some(isVisibleCanvasContentDiffPart)) {
      hunks.push(currentHunk);
    }
    currentHunk = null;
  };

  parts.forEach((part, index) => {
    const isVisibleChange = isVisibleCanvasContentDiffPart(part);

    if (part.type === 'same') {
      const hasMoreChanges = parts.slice(index + 1).some(isVisibleCanvasContentDiffPart);

      if (!currentHunk) {
        pendingPrefix = {
          type: 'same',
          value: trimContextBeforeChange(part.value),
        };
        return;
      }

      if (!hasMoreChanges) {
        appendPart(currentHunk, {
          type: 'same',
          value: trimContextAfterChange(part.value),
        });
        finishCurrentHunk();
        return;
      }

      if (part.value.length <= CLOSE_CHANGE_GAP_LIMIT) {
        appendPart(currentHunk, part);
        return;
      }

      appendPart(currentHunk, {
        type: 'same',
        value: trimContextAfterChange(part.value),
      });
      finishCurrentHunk();
      pendingPrefix = {
        type: 'same',
        value: trimContextBeforeChange(part.value),
      };
      return;
    }

    if (!isVisibleChange) return;

    if (!currentHunk) {
      currentHunk = [];
      if (pendingPrefix) appendPart(currentHunk, pendingPrefix);
    }

    appendPart(currentHunk, part);
    pendingPrefix = null;
  });

  finishCurrentHunk();
  return hunks;
};

export const CanvasVersionDiffPanel = ({
  parts,
  className,
}: CanvasVersionDiffPanelProps): ReactElement => {
  const diffHunks = buildDiffHunks(parts);
  const hasDiff = diffHunks.length > 0;

  return (
    <div
      className={cn(
        'shrink-0 border-b border-border bg-background px-3 py-3 text-sm md:px-4',
        className,
      )}
    >
      <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
        <div className='font-medium text-foreground'>Diff with current canvas</div>
        <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
          <span className='inline-flex items-center gap-1'>
            <span className='h-2 w-2 rounded-sm bg-emerald-200' />
            In selected version
          </span>
          <span className='inline-flex items-center gap-1'>
            <span className='h-2 w-2 rounded-sm bg-red-200' />
            Only in current
          </span>
        </div>
      </div>

      {hasDiff ? (
        <div className='max-h-64 space-y-2 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-foreground'>
          {diffHunks.map((hunkParts, hunkIndex) => (
            <div
              key={`hunk-${hunkIndex}`}
              className='rounded-md border border-border bg-background px-3 py-2'
            >
              <div className='mb-1 text-[11px] font-medium uppercase text-muted-foreground'>
                Change {hunkIndex + 1}
              </div>
              <div className='whitespace-pre-wrap break-words'>
                {hunkParts.map((part, partIndex) => (
                  <span
                    key={`${part.type}-${hunkIndex}-${partIndex}`}
                    className={cn(
                      part.type === 'added' && 'rounded-sm bg-emerald-100 px-0.5 text-emerald-950',
                      part.type === 'removed' &&
                        'rounded-sm bg-red-100 px-0.5 text-red-950 line-through decoration-red-700',
                    )}
                  >
                    {part.value}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className='rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground'>
          No text differences found.
        </div>
      )}
    </div>
  );
};
