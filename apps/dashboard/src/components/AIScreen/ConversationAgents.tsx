import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Check, ListFilter, Loader2, X } from 'lucide-react';
import type { ConversationHistory } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import {
  agentIdentity,
  agentNamesLabel,
  conversationAgents,
  type AgentIdentity,
} from '../Chat/XyneAISidebar/utils/XyneAIUtils';
import { fetchAccessibleClawAgents } from '../../services/clawAgentListService';
import type { AgentConversationCount } from '../../services/XyneAI/XyneAISessionsV2Service';
import { cn } from '../../utils/classNames';
import { formatRelativeTime } from '../../utils/dateUtils';
import { Popover } from '../ui/Popover';
import { AgentGlyph } from './AIAgentSelector';

/**
 * Agents in the chat UI: who a conversation was with (history rows and their
 * filter) and who each of the user's messages went to. One agent per message
 * is the source of truth (`Message.agentSlug`); the directory resolves it to a
 * name and the avatar Spaces shows for that agent.
 */

const ASK_AI_SLUG = 'ask-ai';

export function useAgentDirectory(): Map<string, AgentIdentity> {
  const { data: agents = [] } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => {
    const directory = new Map<string, AgentIdentity>();
    directory.set(ASK_AI_SLUG, { name: 'Ask AI' });
    for (const agent of agents) {
      directory.set(agent.slug, {
        name: agent.name,
        color: agent.color,
        ...(agent.botUserId ? { userId: agent.botUserId } : {}),
      });
    }
    return directory;
  }, [agents]);
}

function IdentityGlyph({
  identity,
  size,
}: {
  identity: AgentIdentity;
  size: number;
}): ReactElement {
  return (
    <AgentGlyph name={identity.name} color={identity.color} userId={identity.userId} size={size} />
  );
}

interface ConversationAgentsAvatarProps {
  slugs: string[];
  /** Ring that separates stacked avatars — match the row's background. */
  ringClassName?: string;
}

/**
 * The leading avatar of a history row: the agent's avatar, or — for a chat
 * that switched agents — the first two stacked diagonally in the same 20px
 * box, so every row's title starts at the same x.
 */
function ConversationAgentsAvatar({
  slugs,
  ringClassName = 'ring-background',
}: ConversationAgentsAvatarProps): ReactElement {
  const directory = useAgentDirectory();
  const [first, second] = slugs.slice(0, 2).map(slug => agentIdentity(directory, slug));
  if (!first) {
    return <span aria-hidden className='size-5 shrink-0 rounded-sm bg-muted' />;
  }
  if (!second) {
    return (
      <span className='flex size-5 shrink-0 items-center justify-center' aria-hidden>
        <IdentityGlyph identity={first} size={20} />
      </span>
    );
  }
  return (
    <span className='relative size-5 shrink-0' aria-hidden data-testid='conversation-agents'>
      <span className='absolute left-0 top-0 flex'>
        <IdentityGlyph identity={first} size={13} />
      </span>
      <span className={cn('absolute bottom-0 right-0 flex rounded-sm ring-[1.5px]', ringClassName)}>
        <IdentityGlyph identity={second} size={13} />
      </span>
    </span>
  );
}

interface ConversationRowContentProps {
  conversation: ConversationHistory;
  /** The title node — surfaces keep their own title treatment (marquee, bold). */
  title: ReactNode;
  /** Status after the title, e.g. a spinner or "Responding". */
  trailing?: ReactNode;
  /** Ring between stacked avatars; match the row background. */
  ringClassName?: string;
}

/**
 * The body of a chat-history row, shared by the AI screen, the sidebar and the
 * overlay: who the chat was with (avatar), what it was about (title), then the
 * agent name and when — the two facts needed to recognise a chat at a glance,
 * with the secondary one quieter so the title stays the thing you read.
 */
export function ConversationRowContent({
  conversation,
  title,
  trailing,
  ringClassName,
}: ConversationRowContentProps): ReactElement {
  const directory = useAgentDirectory();
  const slugs = conversationAgents(conversation);
  const names = agentNamesLabel(slugs.map(slug => agentIdentity(directory, slug).name));
  const when = formatRelativeTime(conversation.lastUpdated);
  return (
    <span className='flex min-w-0 flex-1 items-center gap-2.5'>
      {slugs.length > 0 && (
        <ConversationAgentsAvatar slugs={slugs} {...(ringClassName ? { ringClassName } : {})} />
      )}
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='flex min-w-0 items-center gap-1.5'>
          {title}
          {trailing}
        </span>
        <span className='truncate text-xs font-normal leading-4 text-muted-foreground'>
          {names ? `${names} · ${when}` : when}
        </span>
      </span>
    </span>
  );
}

interface AgentRecipientProps {
  slug: string;
  className?: string;
}

/** "To <agent>" above a user message — who the question was sent to. */
export function AgentRecipient({ slug, className }: AgentRecipientProps): ReactElement {
  const directory = useAgentDirectory();
  const identity = agentIdentity(directory, slug);
  return (
    <div
      data-testid='message-recipient'
      className={cn(
        'flex items-center justify-end gap-1 text-[11px] leading-4 text-muted-foreground',
        className,
      )}
    >
      <span>To</span>
      <IdentityGlyph identity={identity} size={14} />
      <span className='font-medium text-foreground/80'>{identity.name}</span>
    </div>
  );
}

interface ConversationAgentFilterProps {
  /** Every agent in the user's history, most recently used first — never the
   *  full agent catalogue, which would offer choices that lead nowhere. */
  options: AgentConversationCount[];
  value: string | null;
  onChange: (agentSlug: string | null) => void;
  className?: string;
}

/**
 * Narrow the chat history to one agent. Idle it is a single icon button, so
 * the default all-agents list carries no extra chrome; once a filter is on it
 * becomes a labelled chip with its own clear button, so the reason rows are
 * missing is always on screen.
 */
export function ConversationAgentFilter({
  options,
  value,
  onChange,
  className,
}: ConversationAgentFilterProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const directory = useAgentDirectory();

  const select = (slug: string | null): void => {
    onChange(slug);
    setOpen(false);
  };

  // One agent in the whole history: there is nothing to narrow.
  if (options.length < 2 && !value) return null;

  const active = value ? agentIdentity(directory, value) : null;
  const trigger = active ? (
    <button
      type='button'
      aria-label={`Showing ${active.name} chats. Change filter`}
      className='flex h-6 min-w-0 max-w-[150px] items-center gap-1.5 rounded-full border border-border bg-background pl-1 pr-6 text-xs font-medium text-foreground transition-colors hover:bg-accent'
      data-track-category='XyneAI'
      data-track-name='OPEN_AGENT_FILTER'
    >
      <IdentityGlyph identity={active} size={16} />
      <span className='truncate'>{active.name}</span>
    </button>
  ) : (
    <button
      type='button'
      aria-label='Filter chats by agent'
      title='Filter by agent'
      className='flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
      data-track-category='XyneAI'
      data-track-name='OPEN_AGENT_FILTER'
    >
      <ListFilter className='size-3.5' aria-hidden />
    </button>
  );

  return (
    <div
      className={cn('relative flex shrink-0 items-center', className)}
      data-testid='agent-filter'
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side='bottom'
        align='end'
        sideOffset={4}
        trigger={trigger}
        className='w-60 rounded-lg border border-border bg-popover p-1 shadow-lg'
      >
        <div role='listbox' aria-label='Filter chats by agent' className='max-h-72 overflow-y-auto'>
          <FilterOption selected={!value} onSelect={() => select(null)} label='All agents' />
          <div className='my-1 h-px bg-border' />
          {options.map(option => {
            const identity = agentIdentity(directory, option.slug);
            return (
              <FilterOption
                key={option.slug}
                selected={value === option.slug}
                onSelect={() => select(option.slug)}
                label={identity.name}
                count={option.count}
                glyph={<IdentityGlyph identity={identity} size={18} />}
              />
            );
          })}
        </div>
      </Popover>
      {active && (
        <button
          type='button'
          onClick={() => onChange(null)}
          aria-label='Clear agent filter'
          className='absolute right-1 flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          data-track-category='XyneAI'
          data-track-name='CLEAR_AGENT_FILTER'
        >
          <X className='size-3' aria-hidden />
        </button>
      )}
    </div>
  );
}

interface FilterOptionProps {
  selected: boolean;
  onSelect: () => void;
  label: string;
  count?: number;
  glyph?: ReactElement;
}

function FilterOption({
  selected,
  onSelect,
  label,
  count,
  glyph,
}: FilterOptionProps): ReactElement {
  return (
    <button
      type='button'
      role='option'
      aria-selected={selected}
      onClick={onSelect}
      data-track-category='XyneAI'
      data-track-name='SELECT_AGENT_FILTER'
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        selected && 'bg-accent/60',
      )}
    >
      {glyph ?? <span className='size-[18px] shrink-0' aria-hidden />}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {count !== undefined && (
        <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{count}</span>
      )}
      <Check
        className={cn('size-3.5 shrink-0', selected ? 'text-foreground' : 'invisible')}
        aria-hidden
      />
    </button>
  );
}

interface ConversationListEndProps {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * The bottom of a paged history list: loads the next page as it scrolls into
 * view (a little early, so scrolling rarely waits), with a spinner while it
 * does. Nothing renders once the whole history is loaded.
 */
export function ConversationListEnd({
  hasMore,
  isLoadingMore,
  onLoadMore,
}: ConversationListEndProps): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore]);

  if (!hasMore) return null;
  return (
    <div ref={ref} className='flex h-10 items-center justify-center' aria-live='polite'>
      {isLoadingMore && (
        <Loader2
          aria-label='Loading more chats'
          className='size-4 animate-spin text-muted-foreground'
        />
      )}
    </div>
  );
}
