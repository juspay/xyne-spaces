import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement, type ReactNode } from 'react';
import { BarChart3, Bug, ChevronDown, Settings2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useClawAgentDetail } from '../../hooks/useClawAgentDetail';
import { listConversationRuns } from '../../services/claw/clawRunsService';
import {
  agentPagePath,
  agentScopeLabel,
  formatTokenCount,
  summarizeConversationRuns,
  type ConversationUsage,
} from '../../services/claw/conversationUsage';
import { agentIdentity } from '../Chat/XyneAISidebar/utils/XyneAIUtils';
import { cn } from '../../utils/classNames';
import { Popover } from '../ui/Popover';
import { Link } from '../ui/WorkspaceLink';
import { AgentGlyph } from './AIAgentSelector';
import { useAgentDirectory } from './ConversationAgents';

const VISIBLE_TOOLS = 8;

interface AboutAgentPanelProps {
  agentSlug: string;
  conversationId: string;
  running: boolean;
  onOpenDebugger: () => void;
}

export function AboutAgentPanel({
  agentSlug,
  conversationId,
  running,
  onOpenDebugger,
}: AboutAgentPanelProps): ReactElement {
  const [open, setOpen] = useState(false);
  const identity = agentIdentity(useAgentDirectory(), agentSlug);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='start'
      sideOffset={6}
      collisionPadding={12}
      className='w-[340px] rounded-xl border border-border bg-popover p-0 shadow-lg'
      trigger={
        <button
          type='button'
          aria-label={`About ${identity.name}`}
          title='About this agent'
          data-testid='about-agent-button'
          className='flex h-8 min-w-0 max-w-[260px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60 data-[state=open]:bg-secondary/60'
          data-track-category='XyneAI'
          data-track-name='OPEN_ABOUT_AGENT'
        >
          <AgentGlyph
            name={identity.name}
            color={identity.color}
            userId={identity.userId}
            size={20}
            rounded
          />
          <span className='truncate'>{identity.name}</span>
          <ChevronDown className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
        </button>
      }
    >
      {open && (
        <AboutAgentContent
          agentSlug={agentSlug}
          conversationId={conversationId}
          running={running}
          onOpenDebugger={(): void => {
            setOpen(false);
            onOpenDebugger();
          }}
          onNavigate={(): void => setOpen(false)}
        />
      )}
    </Popover>
  );
}

function AboutAgentContent({
  agentSlug,
  conversationId,
  running,
  onOpenDebugger,
  onNavigate,
}: AboutAgentPanelProps & { onNavigate: () => void }): ReactElement {
  const { user } = useAuth();
  const userId = user?.id;
  const identity = agentIdentity(useAgentDirectory(), agentSlug);
  const { data: agent, isLoading: agentLoading } = useClawAgentDetail(agentSlug);
  const usageQuery = useQuery({
    queryKey: ['claw-conversation-usage', conversationId, agentSlug, userId],
    queryFn: async () =>
      summarizeConversationRuns(await listConversationRuns(userId!, conversationId, agentSlug)),
    enabled: Boolean(userId && conversationId),
    staleTime: 0,
    refetchInterval: running ? 5000 : false,
  });

  const tools = agent?.tools ?? [];
  const hiddenTools = tools.length - VISIBLE_TOOLS;

  return (
    <div data-testid='about-agent-panel' className='flex flex-col'>
      <div className='flex items-start gap-3 border-b border-border px-4 py-3'>
        <AgentGlyph
          name={identity.name}
          color={identity.color}
          userId={identity.userId}
          size={32}
          rounded
        />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <p className='truncate text-sm font-semibold text-foreground'>{identity.name}</p>
            {agent && (
              <span
                data-testid='about-agent-scope'
                className='shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground'
              >
                {agentScopeLabel(agent.scope)}
              </span>
            )}
          </div>
          {agentLoading ? (
            <div className='mt-1 h-3 w-40 animate-pulse rounded bg-muted' />
          ) : (
            <p className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>
              {agent?.description || 'No description set yet.'}
            </p>
          )}
        </div>
      </div>

      <Section title='This chat'>
        <UsageSummary
          hasConversation={Boolean(conversationId)}
          loading={usageQuery.isLoading}
          failed={usageQuery.isError}
          usage={usageQuery.data}
          onRetry={(): void => {
            void usageQuery.refetch();
          }}
        />
      </Section>

      {tools.length > 0 && (
        <Section title={`Tools (${tools.length})`}>
          <div data-testid='about-agent-tools' className='flex flex-wrap gap-1'>
            {tools.slice(0, VISIBLE_TOOLS).map(t => (
              <span
                key={t.id}
                title={t.tool.description || t.tool.name}
                className='max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'
              >
                {t.tool.name}
              </span>
            ))}
            {hiddenTools > 0 && (
              <span className='rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                +{hiddenTools} more
              </span>
            )}
          </div>
        </Section>
      )}

      <div className='flex flex-col gap-0.5 border-t border-border p-1.5'>
        <PanelAction
          icon={<Bug className='size-4' aria-hidden />}
          label='Open debugger'
          hint='Every turn in this chat'
          disabled={!conversationId}
          onClick={onOpenDebugger}
          testId='about-agent-debugger'
        />
        <PanelLink
          icon={<BarChart3 className='size-4' aria-hidden />}
          label='Activity'
          hint='All runs of this agent'
          to={agentPagePath(agentSlug, 'activity')}
          onClick={onNavigate}
          testId='about-agent-activity'
        />
        <PanelLink
          icon={<Settings2 className='size-4' aria-hidden />}
          label='Configure agent'
          hint='Persona, tools, knowledge'
          to={agentPagePath(agentSlug, 'persona')}
          onClick={onNavigate}
          testId='about-agent-configure'
        />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className='flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0'>
      <p className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
        {title}
      </p>
      {children}
    </div>
  );
}

function UsageSummary({
  hasConversation,
  loading,
  failed,
  usage,
  onRetry,
}: {
  hasConversation: boolean;
  loading: boolean;
  failed: boolean;
  usage: ConversationUsage | undefined;
  onRetry: () => void;
}): ReactElement {
  if (!hasConversation) {
    return <p className='text-xs text-muted-foreground'>Send a message to start tracking usage.</p>;
  }
  if (loading) {
    return <div className='h-12 w-full animate-pulse rounded-lg bg-muted' />;
  }
  if (failed || !usage) {
    return (
      <p className='text-xs text-muted-foreground'>
        Couldn’t load usage.{' '}
        <button
          type='button'
          onClick={onRetry}
          className='font-medium text-foreground underline'
          data-track-category='XyneAI'
          data-track-name='ABOUT_AGENT_RETRY_USAGE'
        >
          Retry
        </button>
      </p>
    );
  }
  if (usage.runs === 0) {
    return <p className='text-xs text-muted-foreground'>No usage recorded yet.</p>;
  }
  return (
    <div data-testid='about-agent-usage' className='flex flex-col gap-2'>
      <div className='flex items-baseline gap-1.5'>
        <span className='text-xl font-semibold tabular-nums text-foreground'>
          {formatTokenCount(usage.total)}
        </span>
        <span className='text-xs text-muted-foreground'>tokens</span>
        <span className='ml-auto text-xs text-muted-foreground'>
          {usage.runs} run{usage.runs === 1 ? '' : 's'}
        </span>
      </div>
      <div className='grid grid-cols-3 gap-1.5'>
        <UsageStat label='In' value={usage.tokensIn} />
        <UsageStat label='Out' value={usage.tokensOut} />
        <UsageStat label='Cached' value={usage.tokensCached} />
      </div>
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className='flex flex-col rounded-lg bg-muted/60 px-2 py-1.5'>
      <span className='text-[10px] text-muted-foreground'>{label}</span>
      <span
        className='text-sm font-medium tabular-nums text-foreground'
        title={value.toLocaleString()}
      >
        {formatTokenCount(value)}
      </span>
    </div>
  );
}

const ACTION_CLASS =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary/60';

function ActionBody({
  icon,
  label,
  hint,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
}): ReactElement {
  return (
    <>
      <span className='text-muted-foreground'>{icon}</span>
      <span className='flex-1'>{label}</span>
      <span className='text-[11px] text-muted-foreground'>{hint}</span>
    </>
  );
}

function PanelAction({
  icon,
  label,
  hint,
  disabled,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(ACTION_CLASS, 'disabled:cursor-not-allowed disabled:opacity-50')}
      data-track-category='XyneAI'
      data-track-name='ABOUT_AGENT_OPEN_DEBUGGER'
    >
      <ActionBody icon={icon} label={label} hint={hint} />
    </button>
  );
}

function PanelLink({
  icon,
  label,
  hint,
  to,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  to: string;
  onClick: () => void;
  testId: string;
}): ReactElement {
  return (
    <Link
      to={to}
      onClick={onClick}
      data-testid={testId}
      className={ACTION_CLASS}
      data-track-category='XyneAI'
      data-track-name={`ABOUT_AGENT_${label.toUpperCase().replace(/\s+/g, '_')}`}
    >
      <ActionBody icon={icon} label={label} hint={hint} />
    </Link>
  );
}
