import React, { useMemo, useState } from 'react';
import type { ExperimentEpochProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../FlowContext';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { cn } from '../../../utils/classNames';
import {
  CardShell,
  ExecDot,
  FindingList,
  LinkRow,
  Pill,
  SectionLabel,
  formatSpan,
  useNow,
  type PillTone,
} from './experimentCardParts';

const STATUS_META: Record<ExperimentEpochProps['status'], { label: string; tone: PillTone }> = {
  running: { label: 'Running', tone: 'live' },
  done: { label: 'Done', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

const SUMMARY_PREVIEW_CHARS = 420;

function summaryPreview(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('|') && !line.startsWith('```') && !/^[-*_]{3,}$/.test(line))
    .map(line =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '• ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
    );
  const text = lines.join('\n');
  return text.length > SUMMARY_PREVIEW_CHARS ? `${text.slice(0, SUMMARY_PREVIEW_CHARS).trimEnd()}…` : text;
}

export const ExperimentEpochNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({ node }) => {
  const props = node.props as ExperimentEpochProps | undefined;
  const { messageId } = useFlow();
  const running = props?.status === 'running';
  const now = useNow(Boolean(running));
  const [planOpen, setPlanOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const markdownComponents = useMemo(
    () => createMarkdownComponents(messageId || 'experiment-epoch'),
    [messageId],
  );
  if (!props) return null;

  const status = STATUS_META[props.status];
  const started = new Date(props.startedAt).getTime();
  const ended = props.endedAt ? new Date(props.endedAt).getTime() : now;
  const doneSteps = props.plan.filter(step => step.status === 'done').length;
  const showPlan = props.plan.length > 0 && (running || planOpen);
  const summary = props.summary ?? '';
  const longSummary = summary.length > SUMMARY_PREVIEW_CHARS;

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-semibold text-foreground'>Epoch {props.epoch}</span>
          <Pill tone={status.tone} pulse={running}>
            {status.label}
          </Pill>
          <span className='text-xs tabular-nums text-muted-foreground'>
            {running ? `${formatSpan(now - started)} so far` : formatSpan(ended - started)}
          </span>
          {props.retries > 0 && (
            <Pill tone='warn'>
              {props.retries} provider {props.retries === 1 ? 'retry' : 'retries'}
            </Pill>
          )}
        </div>

        {props.hypothesis && (
          <p className='text-sm leading-[1.45] text-foreground/90'>
            <span className='text-muted-foreground'>Testing: </span>
            {props.hypothesis}
          </p>
        )}

        {props.plan.length > 0 && (
          <div className='flex flex-col gap-2'>
            <button
              type='button'
              onClick={() => setPlanOpen(open => !open)}
              disabled={running}
              aria-expanded={showPlan}
              className='flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground enabled:hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
              data-track-category='EXPERIMENT_EPOCH_CARD'
              data-track-name='TOGGLE_PLAN'
            >
              {!running && (
                <span className={cn('inline-block transition-transform motion-reduce:transition-none', planOpen && 'rotate-90')}>
                  ›
                </span>
              )}
              Plan · {doneSteps} of {props.plan.length} steps done
            </button>
            {showPlan && (
              <ul className='flex flex-col gap-2'>
                {props.plan.map(step => (
                  <li key={step.id} className='flex items-start gap-[7px]'>
                    <span className='flex size-4 shrink-0 items-center justify-center pt-px'>
                      <ExecDot status={step.status} />
                    </span>
                    <span className='text-sm leading-[1.25] text-foreground/80'>{step.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {props.error && (
          <p className='rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive'>
            {props.error}
          </p>
        )}

        {summary && (
          <div className='flex flex-col gap-1'>
            <SectionLabel>Result</SectionLabel>
            {summaryOpen || !longSummary ? (
              <div className='text-sm'>
                <MarkdownMessageRenderer content={summary} markdownComponents={markdownComponents} />
              </div>
            ) : (
              <p className='whitespace-pre-wrap text-sm leading-[1.5] text-foreground/90'>{summaryPreview(summary)}</p>
            )}
            {longSummary && (
              <button
                type='button'
                onClick={() => setSummaryOpen(open => !open)}
                className='w-fit text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'
                data-track-category='EXPERIMENT_EPOCH_CARD'
                data-track-name='TOGGLE_SUMMARY'
              >
                {summaryOpen ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        {!running && !summary && !props.error && props.status === 'done' && (
          <p className='text-sm text-muted-foreground'>The epoch ended without a written summary.</p>
        )}

        {props.findings.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <SectionLabel>Recorded this epoch</SectionLabel>
            <FindingList rows={props.findings} showEpoch={false} />
          </div>
        )}

        {props.attachments.length > 0 && (
          <p className='text-xs text-muted-foreground'>
            Proof attached: <span className='font-mono'>{props.attachments.join(', ')}</span>
          </p>
        )}
      </div>

      {props.links && running && (
        <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <LinkRow links={props.links} trackCategory='EXPERIMENT_EPOCH_CARD' />
        </div>
      )}
    </CardShell>
  );
};
