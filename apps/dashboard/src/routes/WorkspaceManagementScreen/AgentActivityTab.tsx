import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import {
  proactivityApi,
  type MessageTraceResponse,
  type WorkspaceDecisionView,
  type WorkspaceDecisionsResponse,
} from '../../api/proactivityApi';
import { cn } from '../../utils/classNames';
import { AgentTrace, describe } from './AgentTrace';
import { OUTCOMES as OUTCOME_WORDS, reasonLabel } from './agentActivityWords';

const ALL = 'all';

const OUTCOMES = [
  { value: ALL, label: 'All outcomes' },
  { value: 'posted', label: OUTCOME_WORDS.posted },
  { value: 'reacted', label: OUTCOME_WORDS.reacted },
  { value: 'held', label: OUTCOME_WORDS.held },
  { value: 'shadow', label: `${OUTCOME_WORDS.shadow} (test only)` },
  { value: 'quiet', label: OUTCOME_WORDS.quiet },
  { value: 'drafting', label: OUTCOME_WORDS.drafting },
];

const PAGE_SIZE = 8;

const DOT: Record<string, string> = {
  posted: 'bg-emerald-500',
  reacted: 'bg-emerald-500',
  held: 'bg-amber-500',
  shadow: 'bg-amber-500',
  quiet: 'bg-muted-foreground/30',
};

/** The outcome in a few words, for the right side of a row. */
const outcomeLabel = (decision: WorkspaceDecisionView): string => {
  const what =
    decision.outcome && decision.outcome in OUTCOME_WORDS
      ? OUTCOME_WORDS[decision.outcome as keyof typeof OUTCOME_WORDS]
      : OUTCOME_WORDS.drafting;
  return decision.outcome === 'held' || decision.outcome === 'quiet'
    ? `${what} · ${reasonLabel(decision.reason)}`
    : decision.agentSlug && decision.outcome
      ? `${what} · ${decision.agentSlug}`
      : what;
};

const shortTime = (at: string): string => {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

/** A trace fetched when its row opens. */
const RowTrace = ({
  decision,
  base,
}: {
  decision: WorkspaceDecisionView;
  base: string;
}): ReactElement => {
  const [trace, setTrace] = useState<MessageTraceResponse | null>(null);
  const messageId = decision.messageIds[0];

  useEffect(() => {
    if (!messageId) return;
    proactivityApi
      .trace(messageId)
      .then(setTrace)
      .catch((error: Error) => toast.error(error.message));
  }, [messageId]);

  return (
    <div className='border-t border-border bg-muted/20 px-5 py-5'>
      {trace ? (
        <AgentTrace trace={trace} />
      ) : (
        <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
      )}
      {decision.conversationId ? (
        <Link
          to={`${base}/chat/${decision.channelId}?conversationId=${decision.conversationId}`}
          className='mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
          data-track-category='workspace-management'
          data-track-name='AGENT_ACTIVITY_OPEN_THREAD'
        >
          Open in #{decision.channelName ?? 'channel'}
          <ArrowUpRight className='h-3 w-3' />
        </Link>
      ) : null}
    </div>
  );
};

/**
 * Administration → Agent activity: what agents decided when nobody tagged them, across
 * the workspace's channels, for tuning and for "why didn't it answer this?".
 */
export const AgentActivityTab = ({ isActive }: { isActive: boolean }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const base = workspaceId ? `/${workspaceId}` : '';
  const [channelId, setChannelId] = useState(ALL);
  const [outcome, setOutcome] = useState(ALL);
  const [page, setPage] = useState<WorkspaceDecisionsResponse | null>(null);
  // The cursors of the pages before this one, for Newer.
  const [cursors, setCursors] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [traceId, setTraceId] = useState('');
  const [trace, setTrace] = useState<MessageTraceResponse | null>(null);
  const [isTracing, setIsTracing] = useState(false);

  const runTrace = async (messageId: string): Promise<void> => {
    const id = messageId.trim();
    if (!id) return;
    setIsTracing(true);
    try {
      setTrace(await proactivityApi.trace(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not trace the message');
    } finally {
      setIsTracing(false);
    }
  };

  const load = useCallback(
    async (before?: string): Promise<void> => {
      setIsLoading(true);
      try {
        setPage(
          await proactivityApi.workspaceDecisions({
            limit: PAGE_SIZE,
            ...(channelId !== ALL ? { channelId } : {}),
            ...(outcome !== ALL ? { outcome } : {}),
            ...(before ? { before } : {}),
          }),
        );
        setOpenId(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not load agent activity');
      } finally {
        setIsLoading(false);
      }
    },
    [channelId, outcome],
  );

  useEffect(() => {
    if (!isActive) return;
    setCursors([]);
    void load();
  }, [isActive, load]);

  const older = (): void => {
    if (!page?.nextBefore) return;
    setCursors([...cursors, page.nextBefore]);
    void load(page.nextBefore);
  };

  const newer = (): void => {
    const rest = cursors.slice(0, -1);
    setCursors(rest);
    void load(rest[rest.length - 1]);
  };

  const decisions = page?.decisions ?? [];

  return (
    <div className='space-y-6'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Agent activity</h2>
          <p className='text-sm text-muted-foreground'>
            Every time an agent considered replying to a message nobody tagged it in: whether it
            replied, and why. Open one to see each step, or paste a message id to trace it.
          </p>
        </div>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => void load(cursors[cursors.length - 1])}
          disabled={isLoading}
          aria-label='Refresh'
          data-track-category='workspace-management'
          data-track-name='RELOAD_AGENT_ACTIVITY'
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      <form
        className='relative'
        onSubmit={event => {
          event.preventDefault();
          void runTrace(traceId);
        }}
      >
        {isTracing ? (
          <Loader2 className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground' />
        ) : (
          <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
        )}
        <Input
          value={traceId}
          onChange={event => setTraceId(event.target.value)}
          placeholder='Trace a message: paste its id and press Enter'
          aria-label='Message id'
          className='pl-9 pr-16'
        />
        {trace ? (
          <button
            type='button'
            onClick={() => {
              setTrace(null);
              setTraceId('');
            }}
            className='absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground'
            data-track-category='workspace-management'
            data-track-name='AGENT_ACTIVITY_TRACE_CLEAR'
          >
            Clear
          </button>
        ) : null}
      </form>
      {trace ? <AgentTrace trace={trace} /> : null}

      <section className='overflow-hidden rounded-2xl bg-card ring-1 ring-border'>
        <div className='flex flex-wrap items-center gap-2 border-b border-border px-4 py-3'>
          <span className='mr-auto text-sm font-medium text-foreground'>Recent decisions</span>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger className='h-8 w-[180px] text-xs' aria-label='Channel'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All channels</SelectItem>
              {(page?.channels ?? []).map(channel => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className='h-8 w-[170px] text-xs' aria-label='Decision'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {decisions.length === 0 ? (
          <p className='px-4 py-10 text-center text-sm text-muted-foreground'>
            {isLoading ? 'Loading…' : 'Nothing for these filters.'}
          </p>
        ) : (
          <ul className={cn('divide-y divide-border', isLoading && 'opacity-60')}>
            {decisions.map(decision => {
              const open = openId === decision.id;
              return (
                <li key={decision.id}>
                  <button
                    type='button'
                    onClick={() => setOpenId(open ? null : decision.id)}
                    className='flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40'
                    data-track-category='workspace-management'
                    data-track-name='AGENT_ACTIVITY_OPEN_DECISION'
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        DOT[decision.outcome ?? ''] ?? 'animate-pulse bg-sky-500',
                      )}
                    />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm text-foreground'>
                        {decision.question || 'Message no longer available'}
                      </p>
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        #{decision.channelName ?? 'unknown'} · {shortTime(decision.createdAt)}
                        {decision.messageIds.length > 1
                          ? ` · ${decision.messageIds.length} messages`
                          : ''}
                      </p>
                    </div>
                    <span
                      className='hidden max-w-[40%] shrink-0 truncate text-xs text-muted-foreground sm:block'
                      title={describe(decision)}
                    >
                      {outcomeLabel(decision)}
                    </span>
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform',
                        open && 'rotate-90',
                      )}
                    />
                  </button>
                  {open ? <RowTrace decision={decision} base={base} /> : null}
                </li>
              );
            })}
          </ul>
        )}

        {cursors.length > 0 || page?.nextBefore ? (
          <div className='flex items-center justify-between border-t border-border px-4 py-2.5'>
            <span className='text-xs text-muted-foreground'>Page {cursors.length + 1}</span>
            <div className='flex gap-1'>
              <Button
                variant='ghost'
                size='sm'
                onClick={newer}
                disabled={isLoading || cursors.length === 0}
                className='gap-1 text-xs'
                data-track-category='workspace-management'
                data-track-name='AGENT_ACTIVITY_NEWER'
              >
                <ChevronLeft className='h-3.5 w-3.5' />
                Newer
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={older}
                disabled={isLoading || !page?.nextBefore}
                className='gap-1 text-xs'
                data-track-category='workspace-management'
                data-track-name='AGENT_ACTIVITY_OLDER'
              >
                Older
                <ChevronRight className='h-3.5 w-3.5' />
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};

export default AgentActivityTab;
