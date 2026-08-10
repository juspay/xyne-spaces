import React, { useEffect, useState } from 'react';
import { CheckTickSingle, Spinner } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, AskQuestionProps } from '@xyne/shared';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';

/**
 * Ask-question artifact — a single-question HITL card.
 *
 * `props.phase` is the discriminant:
 *   pending  → user picks one option and submits.
 *   answered → read-only outcome showing the selected answer.
 *
 * Source-of-truth schema: shared/src/validation/flowSchema.ts
 * (`askQuestionComponentSchema`). Backend emits this component and later
 * updates the same message in place (same screenId + same component id
 * `ask-question`) to flip from pending → answered.
 */
interface AskQuestionNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const AskQuestionNode: React.FC<AskQuestionNodeProps> = ({ node }) => {
  const props = node.props as AskQuestionProps | undefined;
  if (!props) return null;

  if (props.phase === 'answered') {
    return <AnsweredQuestion node={node} props={props} />;
  }
  return <PendingQuestion node={node} props={props} />;
};

const PendingQuestion: React.FC<{
  node: FlowComponent;
  props: Extract<AskQuestionProps, { phase: 'pending' }>;
}> = ({ node, props }) => {
  const { state, updateFieldValue, executeAction, isSubmitting, validateAllFields } = useFlow();
  const [submitting, setSubmitting] = useState(false);

  const selectedValue = (state.values[node.id] as string) || '';

  useEffect(() => {
    if (state.values[node.id] === undefined && props.options[0]) {
      updateFieldValue(node.id, props.options[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const handleSubmit = async (): Promise<void> => {
    if (!selectedValue || submitting || isSubmitting) return;
    const isValid = validateAllFields();
    if (!isValid) return;
    setSubmitting(true);
    try {
      await executeAction({ type: 'submit', actionId: 'user-answer' });
    } finally {
      setSubmitting(false);
    }
  };

  const locked = submitting || isSubmitting;

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex flex-col gap-1'>
          <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
            Question
          </span>
          <p className='text-base font-medium leading-[1.3] text-foreground'>{props.question}</p>
        </div>

        <div className='flex flex-col gap-2'>
          {props.options.map(option => (
            <label
              key={option}
              className={cn(
                'flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                !locked && 'hover:bg-foreground/[0.03] cursor-pointer',
                locked && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type='radio'
                name={node.id}
                value={option}
                checked={selectedValue === option}
                disabled={locked}
                onChange={() => updateFieldValue(node.id, option)}
                className='mt-0.5 h-4 w-4 shrink-0 text-primary border-border focus:ring-ring'
              />
              <span className='text-sm leading-[1.4] text-foreground/90'>{option}</span>
            </label>
          ))}
        </div>
      </div>

      <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <Button
          onClick={() => void handleSubmit()}
          disabled={!selectedValue || locked}
          variant='default'
          size='sm'
          loading={locked}
        >
          {locked ? (
            <>
              <Spinner size={14} className='animate-spin mr-1.5' />
              Submitting…
            </>
          ) : (
            'Submit'
          )}
        </Button>
      </div>
    </CardShell>
  );
};

const AnsweredQuestion: React.FC<{
  node: FlowComponent;
  props: Extract<AskQuestionProps, { phase: 'answered' }>;
}> = ({ node, props }) => {
  const auditText = props.answeredBy
    ? withAnswerTime(`Answered by ${props.answeredBy}`, props.answeredAt)
    : withAnswerTime('Answered', props.answeredAt);

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 p-4'>
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
              Question
            </span>
            <span className='rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] bg-[var(--plan-chip-approved-bg)] text-[var(--plan-chip-approved-fg)]'>
              Answered
            </span>
          </div>
          <p className='text-base font-medium leading-[1.3] text-foreground'>{props.question}</p>
        </div>

        <div className='flex items-start gap-3 rounded-lg bg-foreground/[0.03] px-3 py-2.5'>
          <span className='mt-0.5 flex size-4 items-center justify-center rounded-full bg-foreground/80'>
            <CheckTickSingle size={12} strokeWidth={1.33} absoluteStrokeWidth className='text-background' />
          </span>
          <div className='flex flex-col gap-0.5'>
            <span className='text-sm font-medium text-foreground'>{props.answer}</span>
            {auditText && <span className='text-xs text-muted-foreground'>{auditText}</span>}
          </div>
        </div>
      </div>
    </CardShell>
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

const formatAnswerTime = (iso?: string): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const diffMs = Date.now() - d.getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (diffMs >= 0 && diffMs < ONE_DAY_MS) {
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ago`;
  }

  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const withAnswerTime = (label: string, iso?: string): string => {
  const t = formatAnswerTime(iso);
  return t ? `${label} · ${t}` : label;
};
