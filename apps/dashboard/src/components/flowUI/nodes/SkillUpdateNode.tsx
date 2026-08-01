import React, { useContext, useMemo, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { MaximizeFourArrow, Spinner, CheckTickSingle, MultipleCrossCancelDefault } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, SkillUpdateProps } from '@xyne/shared';
import { ArtifactPreview, InsideArtifactPreviewContext } from './ArtifactPreview';
import { useTheme } from '../../../hooks/useTheme';
import { cn } from '../../../utils/classNames';
import { getDiffThemeType } from './diffTheme';

interface SkillUpdateNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const SkillUpdateNode: React.FC<SkillUpdateNodeProps> = ({ node }) => {
  const props = node.props as SkillUpdateProps | undefined;
  const { executeAction, conversationId, messageId } = useFlow();
  const insidePreview = useContext(InsideArtifactPreviewContext);
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const diff = props?.diff;
  const visibleHunks = useMemo(() => (diff ? diff.hunks.slice(0, 3) : []), [diff]);
  const fullPatch = useMemo(() => (diff ? buildSkillPatch(diff.hunks) : null), [diff]);
  const compactPatch = useMemo(() => (diff ? buildSkillPatch(visibleHunks) : null), [diff, visibleHunks]);

  if (!props) return null;

  const isPending = props.phase === 'pending';
  const isApproved = props.phase === 'approved';
  const shrinkWarning = !!diff && diff.removed > 30 && diff.removed > diff.added * 3;
  const hiddenHunkCount = diff ? diff.hunks.length - visibleHunks.length : 0;

  const submit = async (decision: 'approve' | 'decline'): Promise<void> => {
    if (pending !== null) return;
    setPending(decision);
    try {
      await executeAction({ type: 'submit', actionId: `skill-update-${decision}` });
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  const footerContent = isPending ? (
    <div className='flex flex-wrap items-center gap-2'>
      <button
        type='button'
        onClick={() => void submit('approve')}
        disabled={pending !== null}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='SKILL_UPDATE_ARTIFACT'
        data-track-name='CLICK_APPROVE'
      >
        {pending === 'approve' && <Spinner size={14} className='animate-spin' />}
        {pending === 'approve' ? 'Applying...' : 'Approve'}
      </button>
      <button
        type='button'
        onClick={() => void submit('decline')}
        disabled={pending !== null}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5',
          'text-sm font-medium leading-[1.2] text-muted-foreground',
          'hover:bg-foreground/[0.04] hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='SKILL_UPDATE_ARTIFACT'
        data-track-name='CLICK_DECLINE'
      >
        {pending === 'decline' && <Spinner size={14} className='animate-spin' />}
        {pending === 'decline' ? 'Declining...' : 'Decline'}
      </button>
    </div>
  ) : (
    <div className='flex items-center gap-2'>
      {isApproved ? (
        <span className='flex size-4 items-center justify-center rounded-full bg-emerald-600'>
          <CheckTickSingle size={12} strokeWidth={1.33} absoluteStrokeWidth className='text-white' />
        </span>
      ) : (
        <span className='flex size-4 items-center justify-center rounded-full bg-destructive'>
          <MultipleCrossCancelDefault size={10} className='text-white' />
        </span>
      )}
      <span className='text-xs leading-[1.2] text-muted-foreground'>
        {withDecisionTime(`${isApproved ? 'Approved and applied' : 'Declined'}${props.decidedBy ? ` by ${props.decidedBy}` : ''}`, props.decidedAt)}
      </span>
    </div>
  );

  const diffBlock = (patch: string | null): React.ReactNode => {
    if (patch) {
      return <SkillPatchDiff patch={patch} diffStyle={diffStyle} />;
    }
    if (props.diffText) {
      return (
        <pre className='overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-[1.5] text-foreground'>
          {props.diffText}
        </pre>
      );
    }
    return <p className='text-sm leading-[1.5] text-muted-foreground'>No markdown diff available.</p>;
  };

  const previewBody = (
    <div className='flex flex-col gap-4'>
      <SummaryPanel props={props} />
      {shrinkWarning && diff && <ShrinkWarning added={diff.added} removed={diff.removed} />}
      <div className='flex flex-col gap-2'>
        <DiffSectionHeader added={diff?.added} removed={diff?.removed} diffStyle={diffStyle} onDiffStyleChange={setDiffStyle} />
        {diffBlock(fullPatch)}
        {props.truncated && <TruncatedNote />}
      </div>
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className={cn('flex flex-col gap-3 p-4', props.phase === 'rejected' && 'opacity-70')}>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>Skill update</span>
            <StatusChip
              label={isPending ? 'Review' : isApproved ? 'Approved' : 'Rejected'}
              tone={isPending ? 'muted' : isApproved ? 'approved' : 'rejected'}
            />
          </div>
          {!insidePreview && (
            <button
              type='button'
              onClick={() => setExpanded(true)}
              aria-label='Expand skill update'
              className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='SKILL_UPDATE_ARTIFACT'
              data-track-name='EXPAND_UPDATE'
            >
              <MaximizeFourArrow size={16} className='shrink-0' />
            </button>
          )}
        </div>

        <div className='flex flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-lg font-semibold leading-[1.2] text-foreground'>{props.skillName}</p>
            <SlugPill slug={props.skillSlug} />
          </div>
          <p className='text-xs leading-[1.4] text-muted-foreground tabular-nums'>
            proposed by {props.proposerName}
            {diff && (
              <>
                {'  ·  '}
                <span className='text-emerald-600 dark:text-emerald-400'>+{diff.added}</span>
                {' / '}
                <span className='text-destructive'>-{diff.removed}</span>
              </>
            )}
          </p>
        </div>

        {props.summary && (
          <p className='text-sm leading-[1.5] text-foreground/80'>
            <span className='font-medium'>Summary:</span> {props.summary}
          </p>
        )}

        {shrinkWarning && diff && <ShrinkWarning added={diff.added} removed={diff.removed} compact />}

        <div className='flex flex-col gap-1.5'>
          <DiffSectionHeader added={diff?.added} removed={diff?.removed} diffStyle={diffStyle} onDiffStyleChange={setDiffStyle} />
          <div className='max-h-[280px] overflow-auto rounded-lg border border-border'>
            {diffBlock(compactPatch)}
          </div>
          {hiddenHunkCount > 0 && !insidePreview && (
            <button
              type='button'
              onClick={() => setExpanded(true)}
              className='self-start text-xs font-medium text-muted-foreground underline hover:text-foreground'
              data-track-category='SKILL_UPDATE_ARTIFACT'
              data-track-name='SHOW_FULL_DIFF'
            >
              View full diff ({hiddenHunkCount} more hunk{hiddenHunkCount === 1 ? '' : 's'})
            </button>
          )}
          {props.truncated && <TruncatedNote />}
        </div>

        {props.note && <p className='text-xs leading-[1.4] text-amber-600 dark:text-amber-400'>{props.note}</p>}
      </div>

      <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>{footerContent}</div>

      <ArtifactPreview
        open={expanded}
        onOpenChange={setExpanded}
        label='Skill update'
        messageId={messageId ?? ''}
        title={props.skillName}
        desc={`@${props.skillSlug} - proposed by ${props.proposerName}`}
        conversationId={conversationId ?? undefined}
        footer={footerContent}
        body={previewBody}
        trackCategory='SKILL_UPDATE_ARTIFACT'
      />
    </CardShell>
  );
};

const SummaryPanel: React.FC<{ props: SkillUpdateProps }> = ({ props }) => (
  <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3'>
    <div className='flex flex-wrap items-center gap-2'>
      <span className='font-mono text-xs leading-[1.3] text-muted-foreground'>skill</span>
      <SlugPill slug={props.skillSlug} />
      <StatusChip
        label={props.phase === 'pending' ? 'Review' : props.phase === 'approved' ? 'Approved' : 'Rejected'}
        tone={props.phase === 'pending' ? 'muted' : props.phase === 'approved' ? 'approved' : 'rejected'}
      />
    </div>
    {props.summary && <p className='text-sm leading-[1.55] text-foreground/85'>{props.summary}</p>}
  </div>
);

const ShrinkWarning: React.FC<{ added: number; removed: number; compact?: boolean }> = ({ added, removed, compact }) => (
  <div className={cn('rounded-lg border border-destructive/60 bg-destructive/5 text-sm leading-[1.5] text-destructive', compact ? 'p-2.5' : 'p-3')}>
    This update removes {removed} lines but adds only {added}. Verify the tail before approving.
  </div>
);

const TruncatedNote: React.FC = () => (
  <p className='text-xs leading-[1.4] text-muted-foreground'>
    Diff truncated for display. The full proposed content is stored on the request and applied by integrity hash.
  </p>
);

type DiffHunk = NonNullable<SkillUpdateProps['diff']>['hunks'][number];

const buildSkillPatch = (hunks: DiffHunk[]): string => [
  'diff --git a/SKILL.md b/SKILL.md',
  '--- a/SKILL.md',
  '+++ b/SKILL.md',
  ...hunks.flatMap(hunk => [
    hunk.header,
    ...hunk.lines.map(line => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`),
  ]),
].join('\n');

const DiffSectionHeader: React.FC<{
  added?: number | undefined;
  removed?: number | undefined;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
}> = ({ added, removed, diffStyle, onDiffStyleChange }) => (
  <div className='flex flex-wrap items-center justify-between gap-3'>
    <p className='text-xs font-medium uppercase tracking-[0.4px] text-muted-foreground'>SKILL.md changes</p>
    <div className='flex items-center gap-2'>
      <div className='inline-flex rounded-md border border-border bg-muted/50 p-0.5'>
        {(['unified', 'split'] as const).map(style => (
          <button
            key={style}
            type='button'
            onClick={() => onDiffStyleChange(style)}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium capitalize leading-[1.4] transition-colors',
              diffStyle === style ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            data-track-category='SKILL_UPDATE_ARTIFACT'
            data-track-name={style === 'split' ? 'VIEW_SPLIT_DIFF' : 'VIEW_UNIFIED_DIFF'}
          >
            {style}
          </button>
        ))}
      </div>
      {added !== undefined && removed !== undefined && (
        <p className='font-mono text-xs leading-[1.3] tabular-nums'>
          <span className='text-emerald-600 dark:text-emerald-400'>+{added}</span>
          <span className='text-muted-foreground'> / </span>
          <span className='text-destructive'>-{removed}</span>
        </p>
      )}
    </div>
  </div>
);

const SkillPatchDiff: React.FC<{ patch: string; diffStyle: 'unified' | 'split' }> = ({ patch, diffStyle }) => {
  const { theme } = useTheme();
  const themeType = getDiffThemeType(theme);

  return (
    <div
      className='overflow-hidden rounded-lg border border-border bg-background'
      style={{
        '--diffs-light-bg': 'hsl(var(--background))',
        '--diffs-dark-bg': 'hsl(var(--background))',
        '--diffs-light': 'hsl(var(--foreground))',
        '--diffs-dark': 'hsl(var(--foreground))',
        '--diffs-font-size': '12px',
        '--diffs-line-height': '18px',
        '--diffs-font-family':
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        '--diffs-header-font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
      } as React.CSSProperties}
    >
      <PatchDiff
        patch={patch}
        disableWorkerPool
        options={{
          diffStyle,
          diffIndicators: 'classic',
          disableFileHeader: true,
          disableLineNumbers: true,
          hunkSeparators: 'metadata',
          lineDiffType: 'word',
          overflow: 'wrap',
          themeType,
          tokenizeMaxLineLength: 300,
        }}
      />
    </div>
  );
};

const CardShell: React.FC<{ children: React.ReactNode; style?: React.CSSProperties | undefined }> = ({ children, style }) => (
  <div className='flex w-[450px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40' style={style}>
    {children}
  </div>
);

const SlugPill: React.FC<{ slug: string }> = ({ slug }) => (
  <span className='rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs leading-[1.4] text-muted-foreground'>
    @{slug}
  </span>
);

const StatusChip: React.FC<{ label: string; tone: 'approved' | 'muted' | 'rejected' }> = ({ label, tone }) => (
  <span className='flex h-[18px] items-center'>
    <span
      className={cn(
        'rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px]',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'rejected' && 'bg-destructive/10 text-destructive',
        tone === 'approved' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      )}
    >
      {label}
    </span>
  </span>
);

const formatDecisionTime = (iso?: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const withDecisionTime = (label: string, iso?: string): string => {
  const t = formatDecisionTime(iso);
  return t ? `${label} - ${t}` : label;
};
