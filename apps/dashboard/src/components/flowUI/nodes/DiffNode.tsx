import React, { useContext, useMemo, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { GitCompare, MaximizeFourArrow } from '@xyne/icons';
import type { DiffProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../FlowContext';
import { ArtifactRenderBoundary } from './ArtifactRenderBoundary';
import { useDiffsTheme } from './useDiffsTheme';
import { InsideWidgetPreviewContext, WidgetPreview } from './WidgetPreview';

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
  const { conversationId } = useFlow();
  // A copy of this card lives inside its own widget-preview thread panel; hide the
  // Maximize there so it can't open a nested preview.
  const insidePreview = useContext(InsideWidgetPreviewContext);
  const stat = useMemo(() => diffStat(props?.patch ?? ''), [props?.patch]);

  if (!props?.patch || !props.path) return null;
  const { path, patch } = props;

  const diffOptions = {
    ...themeOptions,
    disableFileHeader: true,
    diffStyle: 'unified' as const,
    overflow: 'scroll' as const,
  };

  const patchView = (
    <ArtifactRenderBoundary fallbackText={patch}>
      <PatchDiff patch={patch} options={diffOptions} disableWorkerPool />
    </ArtifactRenderBoundary>
  );

  return (
    <section
      className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className='flex items-center justify-between gap-2 px-4 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <GitCompare size={16} aria-label='Diff' className='shrink-0 text-muted-foreground' />
          <span className='truncate font-mono text-xs text-foreground' title={path}>
            {path}
          </span>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <DiffStat added={stat.added} removed={stat.removed} />
          {!insidePreview && (
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
          )}
        </div>
      </div>

      <div className='max-h-[420px] overflow-auto border-t border-border text-xs [--diffs-gap-inline:16px]'>
        {patchView}
      </div>

      <WidgetPreview
        open={expanded}
        onOpenChange={setExpanded}
        idPrefix='diff-preview'
        label='Diff'
        title={path}
        description='Proposed change'
        conversationId={conversationId ?? undefined}
        tracking={{ category: 'DIFF_ARTIFACT', closeName: 'CLOSE_DIFF_PREVIEW' }}
      >
        <div className='flex min-w-0 items-center justify-between gap-2'>
          <span className='truncate font-mono text-sm text-foreground' title={path}>
            {path}
          </span>
          <DiffStat added={stat.added} removed={stat.removed} />
        </div>
        <div className='overflow-auto rounded-xl border border-border text-xs [--diffs-gap-inline:16px]'>
          {patchView}
        </div>
      </WidgetPreview>
    </section>
  );
};
