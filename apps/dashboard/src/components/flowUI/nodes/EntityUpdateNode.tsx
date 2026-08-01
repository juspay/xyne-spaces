import React, { useContext, useMemo, useState } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import { MaximizeFourArrow, Spinner, CheckTickSingle, MultipleCrossCancelDefault } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, EntityUpdateProps } from '@xyne/shared';
import { ArtifactPreview, InsideArtifactPreviewContext } from './ArtifactPreview';
import { McpServerIcon } from '../../ClawAgents/McpServerIcon';
import { useTheme } from '../../../hooks/useTheme';
import { cn } from '../../../utils/classNames';
import { getDiffThemeType } from './diffTheme';

/**
 * Entity-update artifact — the owner-facing approval card for a proposed
 * agent/subagent update. ONE component serves BOTH kinds (`props.kind` only
 * changes labels), and the card updates in place across phases on the same
 * message, exactly like the agentCreation card:
 *
 *   pending  → summary + field changes + system-prompt diff, with
 *              Approve / Decline. The buttons submit the existing
 *              `${kind}-update-approve` / `-decline` actionIds; the request
 *              identity (requestId, approverUserId) rides in flowJSON.data.
 *   approved → applied. "Approved" chip, no buttons.
 *   rejected → declined. "Rejected" chip, no buttons.
 *
 * The diff arrives as structured hunks (computed server-side); this component
 * owns ALL presentation. `truncated` marks a display-capped diff — the full
 * proposed content is applied via the request's integrity hash, not this view.
 *
 * Wire contract: one component of type 'entityUpdate'. Source of truth + zod:
 * packages/shared/src/validation/flowSchema.ts (`entityUpdateComponentSchema`).
 * Emitted by xyne-claw-shared's buildEntityUpdateApprovalFlow; phase
 * transitions updateMessage the SAME message (flow-action.ts).
 */
interface EntityUpdateNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const EntityUpdateNode: React.FC<EntityUpdateNodeProps> = ({ node }) => {
  const props = node.props as EntityUpdateProps | undefined;
  const { executeAction, conversationId, messageId } = useFlow();
  const insidePreview = useContext(InsideArtifactPreviewContext);
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const diff = props?.diff;
  const promptPatch = useMemo(() => (diff ? buildPromptPatch(diff.hunks) : null), [diff]);

  if (!props) return null;

  const kindLabel = props.kind === 'agent' ? 'Agent' : 'Subagent';
  const isPending = props.phase === 'pending';
  const isApproved = props.phase === 'approved';

  const submit = async (decision: 'approve' | 'decline'): Promise<void> => {
    if (pending !== null) return;
    setPending(decision);
    try {
      await executeAction({ type: 'submit', actionId: `${props.kind}-update-${decision}` });
      // On a decision, drop the expanded preview back to the thread view.
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  // A large deletion with little addition smells like a truncated "full
  // replacement" — warn the owner to check the tail before approving.
  const shrinkWarning = !!diff && diff.removed > 30 && diff.removed > diff.added * 3;
  // Compact card shows the first hunks; the full diff lives in the expanded view.
  const visibleHunks = diff ? diff.hunks.slice(0, 3) : [];
  const hiddenHunkCount = diff ? diff.hunks.length - visibleHunks.length : 0;
  const fieldChanges = props.fieldChanges ?? [];
  const toolChange = fieldChanges.find(fc => fc.label.toLowerCase() === 'tools');
  const scalarFieldChanges = fieldChanges.filter(fc => fc.label.toLowerCase() !== 'tools');

  // Footer controls — shared by the compact card AND the preview footer.
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
        data-track-category='ENTITY_UPDATE_ARTIFACT'
        data-track-name='CLICK_APPROVE'
      >
        {pending === 'approve' && <Spinner size={14} className='animate-spin' />}
        {pending === 'approve' ? 'Applying…' : 'Approve'}
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
        data-track-category='ENTITY_UPDATE_ARTIFACT'
        data-track-name='CLICK_DECLINE'
      >
        {pending === 'decline' && <Spinner size={14} className='animate-spin' />}
        {pending === 'decline' ? 'Declining…' : 'Decline'}
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
        {withDecisionTime(
          `${isApproved ? 'Approved & applied' : 'Declined'}${props.decidedBy ? ` by ${props.decidedBy}` : ''}`,
          props.decidedAt,
        )}
      </span>
    </div>
  );

  // Full-diff content for the expanded view: field changes + shrink warning +
  // EVERY hunk (the compact card caps at 3).
  const previewBody = (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-mono text-xs leading-[1.3] text-muted-foreground'>{kindLabel.toLowerCase()}</span>
          <span className='rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs leading-[1.4] text-muted-foreground'>
            @{props.targetKey}
          </span>
          <StatusChip
            label={isPending ? 'Review' : isApproved ? 'Approved' : 'Rejected'}
            tone={isPending ? 'muted' : isApproved ? 'approved' : 'rejected'}
          />
        </div>
        {props.summary && (
          <p className='text-sm leading-[1.55] text-foreground/85'>{props.summary}</p>
        )}
      </div>

      {toolChange && <CapabilityDelta from={toolChange.from} to={toolChange.to} />}
      {scalarFieldChanges.length > 0 && <FieldChangesPanel changes={scalarFieldChanges} />}
      {shrinkWarning && diff && (
        <div className='rounded-lg border border-destructive/60 bg-destructive/5 p-2.5 text-sm leading-[1.5] text-destructive'>
          ⚠️ This update removes {diff.removed} lines but adds only {diff.added}. Verify the tail before approving.
        </div>
      )}
      {diff && diff.hunks.length > 0 && (
        <div className='flex flex-col gap-2'>
          <DiffSectionHeader added={diff.added} removed={diff.removed} diffStyle={diffStyle} onDiffStyleChange={setDiffStyle} />
          {promptPatch && <PromptPatchDiff patch={promptPatch} diffStyle={diffStyle} />}
          {props.truncated && (
            <p className='text-xs leading-[1.4] text-muted-foreground'>
              Diff truncated for display — the full proposed content is stored on the request and applied exactly as
              reviewed (integrity-hashed).
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className={cn('flex flex-col gap-3 p-4', props.phase === 'rejected' && 'opacity-70')}>
        {/* Header: mono kind label + phase chip + expand */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
              {kindLabel} update
            </span>
            {isPending ? (
              <StatusChip label='Review' tone='muted' />
            ) : isApproved ? (
              <StatusChip label='Approved' tone='approved' />
            ) : (
              <StatusChip label='Rejected' tone='rejected' />
            )}
          </div>
          {!insidePreview && (
            <button
              type='button'
              onClick={() => setExpanded(true)}
              aria-label='Expand update details'
              className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='ENTITY_UPDATE_ARTIFACT'
              data-track-name='EXPAND_UPDATE'
            >
              <MaximizeFourArrow size={16} className='shrink-0' />
            </button>
          )}
        </div>

        {/* Target + proposer + diff stats */}
        <div className='flex flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-lg font-semibold leading-[1.2] text-foreground'>{props.targetName}</p>
            <span className='rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs leading-[1.4] text-muted-foreground'>
              @{props.targetKey}
            </span>
          </div>
          <p className='text-xs leading-[1.4] text-muted-foreground tabular-nums'>
            proposed by {props.proposerName}
            {diff && (
              <>
                {'  ·  '}
                <span className='text-emerald-600 dark:text-emerald-400'>+{diff.added}</span>
                {' / '}
                <span className='text-destructive'>−{diff.removed}</span>
              </>
            )}
          </p>
        </div>

        {props.summary && (
          <p className='text-sm leading-[1.5] text-foreground/80'>
            <span className='font-medium'>Summary:</span> {props.summary}
          </p>
        )}

        {/* Scalar field changes — visible at a glance, before the prompt diff */}
        {toolChange && <CapabilityDelta from={toolChange.from} to={toolChange.to} compact />}
        {scalarFieldChanges.length > 0 && <FieldChangesPanel changes={scalarFieldChanges} compact />}

        {shrinkWarning && diff && (
          <div className='rounded-lg border border-destructive/60 bg-destructive/5 p-2.5 text-sm leading-[1.5] text-destructive'>
            ⚠️ This update removes {diff.removed} lines but adds only {diff.added}. If the proposer claimed a
            &quot;full replacement&quot;, the prompt may have been truncated — verify the tail before approving.
          </div>
        )}

        {/* System-prompt diff */}
        {diff && diff.hunks.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <DiffSectionHeader added={diff.added} removed={diff.removed} diffStyle={diffStyle} onDiffStyleChange={setDiffStyle} />
            {promptPatch && (
              <div className='max-h-[280px] overflow-auto rounded-lg border border-border'>
                <PromptPatchDiff patch={buildPromptPatch(visibleHunks)} diffStyle={diffStyle} />
              </div>
            )}
            {hiddenHunkCount > 0 && !insidePreview && (
              <button
                type='button'
                onClick={() => setExpanded(true)}
                className='self-start text-xs font-medium text-muted-foreground underline hover:text-foreground'
                data-track-category='ENTITY_UPDATE_ARTIFACT'
                data-track-name='SHOW_FULL_DIFF'
              >
                View full diff ({hiddenHunkCount} more hunk{hiddenHunkCount === 1 ? '' : 's'})
              </button>
            )}
            {props.truncated && (
              <p className='text-xs leading-[1.4] text-muted-foreground'>
                Diff truncated for display — the full proposed content is stored on the request and applied exactly as
                reviewed (integrity-hashed).
              </p>
            )}
          </div>
        )}

        {props.note && <p className='text-xs leading-[1.4] text-amber-600 dark:text-amber-400'>{props.note}</p>}
      </div>

      {/* Footer — Approve/Decline while pending, audit line once decided */}
      <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>{footerContent}</div>

      <ArtifactPreview
        open={expanded}
        onOpenChange={setExpanded}
        label={`${kindLabel} update`}
        messageId={messageId ?? ''}
        title={props.targetName}
        desc={`@${props.targetKey} · proposed by ${props.proposerName}`}
        conversationId={conversationId ?? undefined}
        footer={footerContent}
        body={previewBody}
        trackCategory='ENTITY_UPDATE_ARTIFACT'
      />
    </CardShell>
  );
};

interface FieldChange {
  label: string;
  from: string;
  to: string;
}

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const CapabilityDelta: React.FC<{ from: string; to: string; compact?: boolean }> = ({ from, to, compact = false }) => {
  const before = splitList(from);
  const after = splitList(to);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter(tool => !beforeSet.has(tool));
  const removed = before.filter(tool => !afterSet.has(tool));
  const kept = after.filter(tool => beforeSet.has(tool));

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-background/60',
        compact ? 'p-2.5' : 'p-3',
      )}
    >
      <div className='flex items-center justify-between gap-3'>
        <p className='text-xs font-medium uppercase tracking-[0.4px] text-muted-foreground'>Capabilities</p>
        <p className='text-xs leading-[1.3] text-muted-foreground tabular-nums'>
          {before.length} → {after.length}
        </p>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {added.map(tool => <ToolDeltaChip key={`add-${tool}`} label={tool} tone='added' />)}
        {removed.map(tool => <ToolDeltaChip key={`remove-${tool}`} label={tool} tone='removed' />)}
        {!compact && kept.map(tool => <ToolDeltaChip key={`keep-${tool}`} label={tool} tone='kept' />)}
        {added.length === 0 && removed.length === 0 && kept.length === 0 && (
          <span className='text-sm leading-[1.5] text-muted-foreground'>No tools selected.</span>
        )}
      </div>
    </div>
  );
};

const ToolDeltaChip: React.FC<{ label: string; tone: 'added' | 'removed' | 'kept' }> = ({ label, tone }) => (
  <span
    className={cn(
      'inline-flex h-9 max-w-full items-center gap-1.5 rounded-[10px] border py-1 pl-1 pr-2',
      'text-sm font-semibold leading-none',
      tone === 'added' && 'border-emerald-500/25 bg-emerald-500/10 text-foreground',
      tone === 'removed' && 'border-destructive/25 bg-destructive/10 text-muted-foreground',
      tone === 'kept' && 'border-border bg-foreground/[0.06] text-foreground',
    )}
  >
    <McpServerIcon server={serverFromToolLabel(label)} size='chip' />
    <span className={cn('truncate', tone === 'removed' && 'line-through')}>{label}</span>
    {tone === 'removed' ? (
      <MultipleCrossCancelDefault size={12} className='shrink-0 text-muted-foreground/70' />
    ) : (
      <CheckTickSingle
        size={16}
        strokeWidth={1.33}
        absoluteStrokeWidth
        className={cn(
          'shrink-0',
          tone === 'added' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#0062ff]',
        )}
      />
    )}
  </span>
);

const TOOL_TYPE_ALIASES: Record<string, string> = {
  google: 'google',
  gmail: 'gmail',
  mail: 'gmail',
  gdrive: 'google-drive',
  drive: 'google-drive',
  'google-drive': 'google-drive',
  microsoft: 'microsoft',
  outlook: 'microsoft',
  office: 'microsoft',
  slack: 'slack',
  github: 'github',
  gitlab: 'gitlab',
  figma: 'figma',
  notion: 'notion',
  salesforce: 'salesforce',
  stripe: 'stripe',
  bitbucket: 'bitbucket',
};

const serverFromToolLabel = (label: string): { type: string; name: string } => {
  const normalized = label.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return {
    type: TOOL_TYPE_ALIASES[normalized] ?? normalized,
    name: label,
  };
};

const FieldChangesPanel: React.FC<{ changes: FieldChange[]; compact?: boolean }> = ({ changes, compact = false }) => (
  <div
    className={cn(
      'flex flex-col gap-1 rounded-lg border border-border bg-background/60',
      compact ? 'p-2.5' : 'p-3',
    )}
  >
    <p className='text-xs font-medium uppercase tracking-[0.4px] text-muted-foreground'>Field changes</p>
    {changes.map((fc, i) => (
      <div key={`${fc.label}-${i}`} className='flex flex-col gap-1 py-0.5'>
        <p className='text-sm font-medium leading-[1.4] text-foreground/85'>{fc.label}</p>
        <div className='flex flex-wrap items-center gap-1.5 text-sm leading-[1.5]'>
          <ValuePill value={fc.from || '∅'} tone='old' />
          <span className='text-muted-foreground'>→</span>
          <ValuePill value={fc.to || '∅'} tone='new' />
        </div>
      </div>
    ))}
  </div>
);

const ValuePill: React.FC<{ value: string; tone: 'old' | 'new' }> = ({ value, tone }) => (
  <span
    className={cn(
      'max-w-full rounded-md px-1.5 py-0.5 text-xs leading-[1.4]',
      tone === 'old' && 'bg-muted text-muted-foreground line-through',
      tone === 'new' && 'bg-foreground/[0.06] text-foreground',
    )}
  >
    {value}
  </span>
);

type DiffHunk = NonNullable<EntityUpdateProps['diff']>['hunks'][number];

const buildPromptPatch = (hunks: DiffHunk[]): string => [
  'diff --git a/system-prompt.md b/system-prompt.md',
  '--- a/system-prompt.md',
  '+++ b/system-prompt.md',
  ...hunks.flatMap(hunk => [
    hunk.header,
    ...hunk.lines.map(line => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`),
  ]),
].join('\n');

const DiffSectionHeader: React.FC<{
  added: number;
  removed: number;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
}> = ({ added, removed, diffStyle, onDiffStyleChange }) => (
  <div className='flex flex-wrap items-center justify-between gap-3'>
    <p className='text-xs font-medium uppercase tracking-[0.4px] text-muted-foreground'>System prompt changes</p>
    <div className='flex items-center gap-2'>
      <div className='inline-flex rounded-md border border-border bg-muted/50 p-0.5'>
        {(['unified', 'split'] as const).map(style => (
          <button
            key={style}
            type='button'
            onClick={() => onDiffStyleChange(style)}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium capitalize leading-[1.4] transition-colors',
              diffStyle === style
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-track-category='ENTITY_UPDATE_ARTIFACT'
            data-track-name={style === 'split' ? 'VIEW_SPLIT_DIFF' : 'VIEW_UNIFIED_DIFF'}
          >
            {style}
          </button>
        ))}
      </div>
      <p className='font-mono text-xs leading-[1.3] tabular-nums'>
        <span className='text-emerald-600 dark:text-emerald-400'>+{added}</span>
        <span className='text-muted-foreground'> / </span>
        <span className='text-destructive'>-{removed}</span>
      </p>
    </div>
  </div>
);

const PromptPatchDiff: React.FC<{ patch: string; diffStyle: 'unified' | 'split' }> = ({ patch, diffStyle }) => {
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

const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}> = ({ children, style }) => (
  <div
    className='flex w-[450px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
    style={style}
  >
    {children}
  </div>
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

// Relative within a day, absolute after — same convention as the plan card.
const withDecisionTime = (label: string, iso?: string): string => {
  if (!iso) return label;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return label;
  const diffMs = Date.now() - d.getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (diffMs >= 0 && diffMs < ONE_DAY_MS) {
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return `${label} · just now`;
    if (mins < 60) return `${label} · ${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
    const hrs = Math.floor(mins / 60);
    return `${label} · ${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ago`;
  }
  return `${label} · ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
};
