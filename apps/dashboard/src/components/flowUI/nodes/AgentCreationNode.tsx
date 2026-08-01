import React, { useContext, useState } from 'react';
import {
  MaximizeFourArrow,
  Spinner,
  CheckTickSingle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { useFlow } from '../FlowContext';
import type { FlowComponent, AgentCreationProps } from '@xyne/shared';
import { ArtifactPreview, InsideArtifactPreviewContext } from './ArtifactPreview';
import { McpServerIcon } from '../../ClawAgents/McpServerIcon';
import { useAgentProgress } from '../../../hooks/useAgentProgress';
import { cn } from '../../../utils/classNames';

interface AgentCreationNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

type AgentConnectLink = {
  serverType: string;
  displayName: string;
  authUrl: string;
};

export const AgentCreationNode: React.FC<AgentCreationNodeProps> = ({ node }) => {
  const props = node.props as AgentCreationProps | undefined;
  const { executeAction, conversationId, messageId } = useFlow();
  const insidePreview = useContext(InsideArtifactPreviewContext);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);
  const { agents } = useAgentProgress(conversationId || undefined);

  if (!props) return null;

  const agentRunning = agents.length > 0;

  const isPending = props.phase === 'pending';
  const isCreated = props.phase === 'created';

  const submit = async (actionId: 'approve-write' | 'decline-write'): Promise<void> => {
    if (pending !== null) return;
    if (actionId === 'approve-write' && agentRunning) return;
    setPending(actionId === 'approve-write' ? 'approve' : 'decline');
    try {
      await executeAction({ type: 'submit', actionId });
      // On a decision, drop the expanded preview back to the thread view.
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  const chip = isCreated ? (
    <StatusChip label='Created' tone='created' />
  ) : props.phase === 'rejected' ? (
    <StatusChip label='Rejected' tone='rejected' />
  ) : (
    <StatusChip label='Review' tone='muted' />
  );

  const capabilityChips = (props.tools?.length || props.modelId) && (
    <div className='flex flex-wrap items-center gap-1.5'>
      {props.modelId && <MetaChip>{props.modelId}</MetaChip>}
      {props.tools?.map(t => (
        <ToolChip key={t} label={t} />
      ))}
    </div>
  );

  const connectLinks: AgentConnectLink[] = Array.isArray(props.connectLinks)
    ? props.connectLinks
    : [];
  const setupLinks = connectLinks.length > 0 ? (
    <div className='flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3'>
      <p className='text-xs font-medium uppercase tracking-[0.4px] text-muted-foreground'>Connect accounts</p>
      <div className='flex flex-wrap gap-2'>
        {connectLinks.map(link => (
          <a
            key={link.serverType}
            href={link.authUrl}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(
              'inline-flex items-center rounded-lg border border-border bg-background px-2.5 py-1.5',
              'text-sm font-medium leading-[1.2] text-foreground',
              'hover:bg-foreground/[0.04]',
            )}
            data-track-category='AGENT_CREATION_ARTIFACT'
            data-track-name='CONNECT_MCP'
          >
            Connect {link.displayName}
          </a>
        ))}
      </div>
    </div>
  ) : null;

  const footerContent = isPending ? (
    <div className='flex flex-wrap items-center gap-2'>
      <button
        type='button'
        onClick={() => void submit('approve-write')}
        disabled={pending !== null || agentRunning}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5',
          'text-sm font-medium leading-[1.2] text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='AGENT_CREATION_ARTIFACT'
        data-track-name='CLICK_APPROVE'
      >
        {(pending === 'approve' || agentRunning) && <Spinner size={14} className='animate-spin' />}
        {pending === 'approve' ? 'Creating…' : agentRunning ? 'Agent is working…' : 'Approve'}
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
        data-track-category='AGENT_CREATION_ARTIFACT'
        data-track-name='CLICK_DECLINE'
      >
        {pending === 'decline' && <Spinner size={14} className='animate-spin' />}
        {pending === 'decline' ? 'Declining…' : 'Decline'}
      </button>
      {agentRunning && (
        <span className='text-xs text-muted-foreground'>Approve once it finishes.</span>
      )}
    </div>
  ) : isCreated ? (
    <div className='flex items-center gap-2'>
      <span className='flex size-4 items-center justify-center rounded-full bg-emerald-600'>
        <CheckTickSingle size={12} strokeWidth={1.33} absoluteStrokeWidth className='text-white' />
      </span>
      <AuditLine
        text={withDecisionTime(
          props.decidedBy ? `Created by ${props.decidedBy}` : 'Finish setup (create + install its app) to start chatting.',
          props.decidedAt,
        )}
      />
    </div>
  ) : (
    <div className='flex items-center gap-2'>
      <span className='flex size-4 items-center justify-center rounded-full bg-destructive'>
        <MultipleCrossCancelDefault size={10} className='text-white' />
      </span>
      <AuditLine text={withDecisionTime(props.decidedBy ? `Declined by ${props.decidedBy}` : 'Declined', props.decidedAt)} />
    </div>
  );

  return (
    <CardShell style={node.style}>
      <div className={cn('flex flex-col gap-3 p-4', props.phase === 'rejected' && 'opacity-70')}>
        <div className='flex flex-col gap-[9px]'>
          <Header
            chip={chip}
            onExpand={insidePreview ? undefined : (): void => setExpanded(true)}
          />
          <div className='flex flex-col gap-1.5'>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='text-lg font-semibold leading-[1.2] text-foreground'>{props.name}</p>
              <SlugPill slug={props.slug} />
            </div>
            {props.description && (
              <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/80'>
                {props.description}
              </p>
            )}
          </div>
        </div>

        {capabilityChips}
        {setupLinks}

        {props.note && isCreated && (
          <p className='text-xs leading-[1.3] text-amber-600 dark:text-amber-400'>{props.note}</p>
        )}
      </div>

      <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>{footerContent}</div>

      <ArtifactPreview
        open={expanded}
        onOpenChange={setExpanded}
        label='Agent'
        messageId={messageId ?? ''}
        title={props.name}
        desc={props.description}
        document={props.systemPrompt}
        conversationId={conversationId ?? undefined}
        footer={footerContent}
        body={capabilityChips || setupLinks ? (
          <div className='flex flex-col gap-3'>
            {capabilityChips}
            {setupLinks}
          </div>
        ) : undefined}
        trackCategory='AGENT_CREATION_ARTIFACT'
      />
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

const Header: React.FC<{
  chip?: React.ReactNode;
  onExpand?: (() => void) | undefined;
}> = ({ chip, onExpand }) => (
  <div className='flex items-center justify-between'>
    <div className='flex items-center gap-2'>
      <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
        Agent
      </span>
      {chip}
    </div>
    {onExpand && (
      <button
        type='button'
        onClick={onExpand}
        aria-label='Expand agent details'
        className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        data-track-category='AGENT_CREATION_ARTIFACT'
        data-track-name='EXPAND_AGENT'
      >
        <MaximizeFourArrow size={16} className='shrink-0' />
      </button>
    )}
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

const ToolChip: React.FC<{ label: string }> = ({ label }) => (
  <span className='inline-flex h-9 max-w-full items-center gap-1.5 rounded-[10px] border border-emerald-500/25 bg-emerald-500/10 py-1 pl-1 pr-2 text-sm font-semibold leading-none text-foreground'>
    <McpServerIcon server={serverFromToolLabel(label)} size='chip' />
    <span className='truncate'>{label}</span>
    <CheckTickSingle
      size={16}
      strokeWidth={1.33}
      absoluteStrokeWidth
      className='shrink-0 text-emerald-600 dark:text-emerald-400'
    />
  </span>
);

const TOOL_TYPE_ALIASES = new Map<string, string>([
  ['google', 'google'],
  ['gmail', 'gmail'],
  ['mail', 'gmail'],
  ['gdrive', 'google-drive'],
  ['drive', 'google-drive'],
  ['google-drive', 'google-drive'],
  ['microsoft', 'microsoft'],
  ['outlook', 'microsoft'],
  ['office', 'microsoft'],
  ['slack', 'slack'],
  ['github', 'github'],
  ['gitlab', 'gitlab'],
  ['figma', 'figma'],
  ['notion', 'notion'],
  ['salesforce', 'salesforce'],
  ['stripe', 'stripe'],
  ['bitbucket', 'bitbucket'],
]);

const serverFromToolLabel = (label: string): { type: string; name: string } => {
  const normalized = label.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return {
    type: TOOL_TYPE_ALIASES.get(normalized) ?? normalized,
    name: label,
  };
};

const StatusChip: React.FC<{ label: string; tone: 'created' | 'muted' | 'rejected' }> = ({
  label,
  tone,
}) => (
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

const AuditLine: React.FC<{ text: string }> = ({ text }) => (
  <span className='text-xs leading-[1.2] text-muted-foreground'>{text}</span>
);

const formatDecisionTime = (iso?: string): string | null => {
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

const withDecisionTime = (label: string, iso?: string): string => {
  const t = formatDecisionTime(iso);
  return t ? `${label} · ${t}` : label;
};
