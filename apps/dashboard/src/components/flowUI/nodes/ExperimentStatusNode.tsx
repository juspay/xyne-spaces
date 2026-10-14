import React, { useMemo, useState } from 'react';
import { Spinner } from '@xyne/icons';
import type { ExperimentKind, ExperimentStatusProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../FlowContext';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { cn } from '../../../utils/classNames';
import {
  CardShell,
  FindingList,
  LinkRow,
  Pill,
  ProgressBar,
  SectionLabel,
  formatClock,
  formatSpan,
  useNow,
  type PillTone,
} from './experimentCardParts';

function kindLabel(kind: ExperimentKind): string {
  switch (kind) {
    case 'understanding':
      return 'Understanding';
    case 'framework':
      return 'Framework';
    case 'security':
      return 'Security scan';
    case 'repo-history':
      return 'Repo history';
    default:
      return 'Experiment';
  }
}

const STATUS_META: Record<ExperimentStatusProps['status'], { label: string; tone: PillTone }> = {
  running: { label: 'Running', tone: 'live' },
  finishing: { label: 'Finishing', tone: 'warn' },
  done: { label: 'Done', tone: 'good' },
  stopped: { label: 'Stopped', tone: 'muted' },
};

const TIME_BOXED = new Set<ExperimentKind>(['experiment', 'security']);

export const ExperimentStatusNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({ node }) => {
  const props = node.props as ExperimentStatusProps | undefined;
  const { executeAction, messageId } = useFlow();
  const [focusOpen, setFocusOpen] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const live = props?.status === 'running' || props?.status === 'finishing';
  const now = useNow(Boolean(live));
  const markdownComponents = useMemo(
    () => createMarkdownComponents(messageId || 'experiment-report'),
    [messageId],
  );
  if (!props) return null;

  const status = STATUS_META[props.status];
  const started = new Date(props.startedAt).getTime();
  const deadline = new Date(props.deadlineAt).getTime();
  const end = props.endedAt ? new Date(props.endedAt).getTime() : live ? now : new Date(props.updatedAt).getTime();
  const elapsed = Math.max(0, end - started);
  const budget = Math.max(1, deadline - started);
  const closed = props.counts.proved + props.counts.refuted;
  const frontierTotal = closed + props.counts.open;
  const timeBoxed = TIME_BOXED.has(props.kind);

  const run = async (actionId: string): Promise<void> => {
    if (busy) return;
    setBusy(actionId);
    try {
      await executeAction({ type: 'submit', actionId });
    } finally {
      setBusy(null);
    }
  };

  return (
    <CardShell style={node.style} wide>
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex min-w-0 flex-col gap-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <Pill tone={status.tone} pulse={props.status === 'running'}>
                {status.label}
              </Pill>
              <span className='text-xs font-medium text-muted-foreground'>
                {kindLabel(props.kind)} · epoch {props.epoch} · {props.model}
              </span>
            </div>
            <p className='text-[15px] font-semibold leading-[1.3] text-foreground [text-wrap:balance]'>{props.title}</p>
            <p className='text-xs text-muted-foreground'>{props.exitRule}</p>
          </div>
          <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
            {live ? `updated ${formatClock(props.updatedAt)}` : `ended ${formatClock(props.endedAt ?? props.updatedAt)}`}
          </span>
        </div>

        {props.focus && props.focus !== props.title && (
          <div className='flex flex-col gap-1'>
            <p className={cn('whitespace-pre-wrap text-sm leading-[1.45] text-foreground/80', !focusOpen && 'line-clamp-2')}>
              {props.focus}
            </p>
            <button
              type='button'
              onClick={() => setFocusOpen(open => !open)}
              className='w-fit text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
              data-track-category='EXPERIMENT_CARD'
              data-track-name='TOGGLE_FOCUS'
            >
              {focusOpen ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}

        <div className='grid grid-cols-4 gap-2'>
          <Stat value={props.counts.proved} label='proved' />
          <Stat value={props.counts.refuted} label='refuted' />
          <Stat value={props.counts.open} label='open' />
          <Stat
            value={props.epochs.completed}
            label={props.epochs.failed > 0 ? `epochs · ${props.epochs.failed} failed` : 'epochs done'}
          />
        </div>

        {timeBoxed ? (
          <div className='flex flex-col gap-1.5'>
            <ProgressBar value={elapsed / budget} tone={live ? 'live' : 'done'} />
            <p className='text-xs tabular-nums text-muted-foreground'>
              {formatSpan(Math.min(elapsed, budget))} of {formatSpan(budget)} used
              {live && deadline > now ? ` · ${formatSpan(deadline - now)} left` : ''}
            </p>
          </div>
        ) : props.kind === 'repo-history' ? (
          <p className='text-xs tabular-nums text-muted-foreground'>
            Running for {formatSpan(elapsed)} · walking commits toward HEAD
          </p>
        ) : (
          <div className='flex flex-col gap-1.5'>
            <ProgressBar value={frontierTotal > 0 ? closed / frontierTotal : 0} tone={live ? 'live' : 'done'} />
            <p className='text-xs tabular-nums text-muted-foreground'>
              {closed} of {frontierTotal} closed · running for {formatSpan(elapsed)}
            </p>
          </div>
        )}

        {props.hypothesis && (
          <div className='flex flex-col gap-1'>
            <SectionLabel>Now testing</SectionLabel>
            <p className='text-sm leading-[1.45] text-foreground/90'>{props.hypothesis}</p>
          </div>
        )}

        {props.needsYou.length > 0 && (
          <div
            role='status'
            className='flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5'
          >
            <p className='text-sm font-semibold text-amber-800 dark:text-amber-200'>
              Needs you ({props.needsYou.length})
            </p>
            <ul className='flex list-disc flex-col gap-1 pl-4 text-sm leading-[1.4] text-amber-900 dark:text-amber-100'>
              {props.needsYou.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {props.findings.length > 0 && (
          <div className='flex flex-col gap-2'>
            <button
              type='button'
              onClick={() => setFindingsOpen(open => !open)}
              aria-expanded={findingsOpen}
              className='flex w-fit items-center gap-1.5 text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
              data-track-category='EXPERIMENT_CARD'
              data-track-name='TOGGLE_FINDINGS'
            >
              <span className={cn('inline-block transition-transform motion-reduce:transition-none', findingsOpen && 'rotate-90')}>
                ›
              </span>
              Findings ({props.totalFindings}) — newest first
            </button>
            {findingsOpen && (
              <>
                <FindingList rows={props.findings} />
                {props.totalFindings > props.findings.length && (
                  <p className='text-xs text-muted-foreground'>
                    + {props.totalFindings - props.findings.length} more in the findings report
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {props.links && live && (
          <div className='flex flex-col gap-1.5'>
            <SectionLabel>Live sandbox</SectionLabel>
            <LinkRow links={props.links} trackCategory='EXPERIMENT_CARD' />
          </div>
        )}

        {props.report && (
          <div className='flex flex-col gap-1.5'>
            <SectionLabel>Final report</SectionLabel>
            <div className='max-h-72 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm'>
              <MarkdownMessageRenderer content={props.report} markdownComponents={markdownComponents} />
            </div>
          </div>
        )}
      </div>

      <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <ActionButton
          label='Findings report'
          busy={busy === 'experiment-findings'}
          onClick={() => void run('experiment-findings')}
          track='POST_FINDINGS'
          primary
        />
        {live && (
          <ActionButton
            label='Stop run'
            busy={busy === 'experiment-stop'}
            onClick={() => void run('experiment-stop')}
            track='STOP_RUN'
          />
        )}
      </div>
    </CardShell>
  );
};

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className='flex flex-col gap-0.5 rounded-lg border border-border bg-background px-3 py-2'>
    <span className='text-lg font-semibold tabular-nums leading-none text-foreground'>{value}</span>
    <span className='truncate text-[11px] text-muted-foreground'>{label}</span>
  </div>
);

const ActionButton: React.FC<{
  label: string;
  busy: boolean;
  onClick: () => void;
  track: string;
  primary?: boolean;
}> = ({ label, busy, onClick, track, primary }) => (
  <button
    type='button'
    onClick={onClick}
    disabled={busy}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium leading-[1.2] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      primary ? 'bg-foreground text-background' : 'border border-border bg-background text-foreground',
    )}
    data-track-category='EXPERIMENT_CARD'
    data-track-name={track}
  >
    {busy && <Spinner size={14} className='animate-spin' />}
    {label}
  </button>
);
