import React, { useContext, useState } from 'react';
import { MaximizeFourArrow, Spinner, CheckTickSingle, MultipleCrossCancelDefault } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, SkillCreationProps } from '@xyne/shared';
import { ArtifactPreview, InsideArtifactPreviewContext } from './ArtifactPreview';
import { cn } from '../../../utils/classNames';

interface SkillCreationNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const SkillCreationNode: React.FC<SkillCreationNodeProps> = ({ node }) => {
  const props = node.props as SkillCreationProps | undefined;
  if (!props) return null;

  const { executeAction, conversationId, messageId } = useFlow();
  const insidePreview = useContext(InsideArtifactPreviewContext);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);

  const isPending = props.phase === 'pending';
  const isCreated = props.phase === 'created';
  const contentLineCount = props.content ? props.content.split('\n').length : 0;

  const submit = async (actionId: 'approve-write' | 'decline-write'): Promise<void> => {
    if (pending !== null) return;
    setPending(actionId === 'approve-write' ? 'approve' : 'decline');
    try {
      await executeAction({ type: 'submit', actionId });
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  const footerContent = isPending ? (
    <div className='flex flex-wrap items-center gap-2'>
      <button
        type='button'
        onClick={() => void submit('approve-write')}
        disabled={pending !== null}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='SKILL_CREATION_ARTIFACT'
        data-track-name='CLICK_APPROVE'
      >
        {pending === 'approve' && <Spinner size={14} className='animate-spin' />}
        {pending === 'approve' ? 'Creating...' : 'Approve'}
      </button>
      <button
        type='button'
        onClick={() => void submit('decline-write')}
        disabled={pending !== null}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5',
          'text-sm font-medium leading-[1.2] text-muted-foreground',
          'hover:bg-foreground/[0.04] hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='SKILL_CREATION_ARTIFACT'
        data-track-name='CLICK_DECLINE'
      >
        {pending === 'decline' && <Spinner size={14} className='animate-spin' />}
        {pending === 'decline' ? 'Declining...' : 'Decline'}
      </button>
    </div>
  ) : (
    <div className='flex items-center gap-2'>
      {isCreated ? (
        <span className='flex size-4 items-center justify-center rounded-full bg-emerald-600'>
          <CheckTickSingle size={12} strokeWidth={1.33} absoluteStrokeWidth className='text-white' />
        </span>
      ) : (
        <span className='flex size-4 items-center justify-center rounded-full bg-destructive'>
          <MultipleCrossCancelDefault size={10} className='text-white' />
        </span>
      )}
      <span className='text-xs leading-[1.2] text-muted-foreground'>
        {withDecisionTime(isCreated ? 'Created' : 'Declined', props.decidedAt)}
      </span>
    </div>
  );

  const previewBody = (
    <div className='flex flex-col gap-3'>
      {props.description && (
        <div className='rounded-lg border border-border bg-background/60 p-3'>
          <p className='text-xs font-medium uppercase tracking-[0.4px] text-muted-foreground'>Description</p>
          <p className='mt-1 text-sm leading-[1.5] text-foreground/85'>{props.description}</p>
        </div>
      )}
      <div className='flex flex-wrap gap-1.5'>
        <MetaChip>SKILL.md</MetaChip>
        {contentLineCount > 0 && <MetaChip>{contentLineCount} lines</MetaChip>}
      </div>
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className={cn('flex flex-col gap-3 p-4', props.phase === 'rejected' && 'opacity-70')}>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>Skill</span>
            <StatusChip
              label={isPending ? 'Review' : isCreated ? 'Created' : 'Rejected'}
              tone={isPending ? 'muted' : isCreated ? 'created' : 'rejected'}
            />
          </div>
          {!insidePreview && (
            <button
              type='button'
              onClick={() => setExpanded(true)}
              aria-label='Expand skill details'
              className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='SKILL_CREATION_ARTIFACT'
              data-track-name='EXPAND_SKILL'
            >
              <MaximizeFourArrow size={16} className='shrink-0' />
            </button>
          )}
        </div>

        <div className='flex flex-col gap-1.5'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-lg font-semibold leading-[1.2] text-foreground'>{props.name}</p>
            <SlugPill slug={props.slug} />
          </div>
          {props.description && (
            <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/80'>{props.description}</p>
          )}
        </div>

        <div className='flex flex-wrap gap-1.5'>
          <MetaChip>SKILL.md</MetaChip>
          {contentLineCount > 0 && <MetaChip>{contentLineCount} lines</MetaChip>}
        </div>
        {props.note && <p className='text-xs leading-[1.4] text-amber-600 dark:text-amber-400'>{props.note}</p>}
      </div>

      <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>{footerContent}</div>

      <ArtifactPreview
        open={expanded}
        onOpenChange={setExpanded}
        label='Skill'
        messageId={messageId ?? ''}
        title={props.name}
        desc={`@${props.slug}`}
        document={props.content}
        conversationId={conversationId ?? undefined}
        footer={footerContent}
        body={previewBody}
        trackCategory='SKILL_CREATION_ARTIFACT'
      />
    </CardShell>
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

const MetaChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className='rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-xs leading-[1.4] text-muted-foreground'>
    {children}
  </span>
);

const StatusChip: React.FC<{ label: string; tone: 'created' | 'muted' | 'rejected' }> = ({ label, tone }) => (
  <span className='flex h-[18px] items-center'>
    <span
      className={cn(
        'rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px]',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'rejected' && 'bg-destructive/10 text-destructive',
        tone === 'created' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
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
