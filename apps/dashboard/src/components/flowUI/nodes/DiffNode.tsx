import React, { useMemo, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { MaximizeFourArrow, MultipleCrossCancelDefault } from '@xyne/icons';
import type { DiffProps, FlowComponent } from '@xyne/shared';
import Dialog from '../../ui/Dialog';
import { ArtifactRenderBoundary } from './ArtifactRenderBoundary';
import { useDiffsTheme } from './useDiffsTheme';

function diffStat(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

const DiffStat: React.FC<{ added: number; removed: number }> = ({ added, removed }) => (
  <span className='shrink-0 font-mono text-xs tabular-nums'>
    <span className='text-[var(--diff-stat-add-fg)]'>+{added}</span>{' '}
    <span className='text-[var(--diff-stat-del-fg)]'>−{removed}</span>
  </span>
);

export const DiffNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as DiffProps | undefined;
  const [expanded, setExpanded] = useState(false);
  const themeOptions = useDiffsTheme();
  const stat = useMemo(() => diffStat(props?.patch ?? ''), [props?.patch]);

  if (!props?.patch || !props.path) return null;
  const { path, patch } = props;

  const diffOptions = {
    ...themeOptions,
    disableFileHeader: true,
    diffStyle: 'unified' as const,
    overflow: 'scroll' as const,
  };

  return (
    <>
      <section
        className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
        style={node.style}
      >
        <div className='flex items-center justify-between gap-2 px-4 pb-2 pt-4'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
              Diff
            </span>
            <span className='truncate font-mono text-xs text-foreground' title={path}>
              {path}
            </span>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <DiffStat added={stat.added} removed={stat.removed} />
            <button
              type='button'
              onClick={() => setExpanded(true)}
              aria-label='Expand diff'
              className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='DIFF_ARTIFACT'
              data-track-name='EXPAND_DIFF'
            >
              <MaximizeFourArrow size={16} className='shrink-0' />
            </button>
          </div>
        </div>

        <div className='max-h-[420px] overflow-auto border-t border-border text-xs'>
          <ArtifactRenderBoundary fallbackText={patch}>
            <PatchDiff patch={patch} options={diffOptions} disableWorkerPool />
          </ArtifactRenderBoundary>
        </div>
      </section>

      <Dialog
        open={expanded}
        onOpenChange={setExpanded}
        title={path}
        description='Proposed change'
        className='max-w-4xl overflow-hidden'
      >
        <div className='flex flex-col'>
          <div className='flex items-center justify-between gap-3 px-5 py-4 pb-0'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='truncate font-mono text-sm text-foreground' title={path}>
                {path}
              </span>
              <DiffStat added={stat.added} removed={stat.removed} />
            </div>
            <button
              type='button'
              onClick={() => setExpanded(false)}
              aria-label='Close'
              className='rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='DIFF_ARTIFACT'
              data-track-name='CLOSE_DIFF_DIALOG'
            >
              <MultipleCrossCancelDefault size={18} />
            </button>
          </div>
          <div className='max-h-[70vh] overflow-auto px-5 py-4 text-xs'>
            <ArtifactRenderBoundary fallbackText={patch}>
              <PatchDiff patch={patch} options={diffOptions} disableWorkerPool />
            </ArtifactRenderBoundary>
          </div>
        </div>
      </Dialog>
    </>
  );
};
