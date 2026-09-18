import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChannelClawAgent } from '../../../../hooks/useChannelClawAgents';
import { useOnboardingTicketSearch } from '../../../../hooks/useDeskOnboarding';
import {
  ONBOARDING_MAX_TICKETS_PER_TOPIC,
  createOnboardingTopic,
  onboardingErrorMessage,
  setOnboardingTopicTickets,
  updateOnboardingTopic,
  type OnboardingState,
  type OnboardingTopicSummary,
} from '../../../../services/clients/onboardingApi';
import { TruncatedTooltip } from '../../../ui/Tooltip';
import { AutoDraftAgentPicker } from '../AutoDraftAgentPicker';
import {
  EmptyState,
  dangerButtonClass,
  iconButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './onboardingUi';

interface OnboardingTopicsViewProps {
  channelId: string;
  state: OnboardingState;
  clawAgents: ChannelClawAgent[];
  onChanged: () => Promise<void>;
}

export const OnboardingTopicsView: React.FC<OnboardingTopicsViewProps> = ({
  channelId,
  state,
  clawAgents,
  onChanged,
}) => {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  const createTopic = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) {
      setNameMissing(true);
      newNameInputRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const { id } = await createOnboardingTopic(channelId, { name });
      setNewName('');
      await onChanged();
      setExpandedId(id);
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't create the topic"));
    } finally {
      setCreating(false);
    }
  };

  if (!state.isAdmin) {
    return state.topics.length === 0 ? (
      <EmptyState title='No exams yet'>
        A desk admin hasn’t set up any onboarding topics.
      </EmptyState>
    ) : (
      <div className='flex flex-col divide-y divide-desk-border rounded-[12px] border border-desk-border dark:divide-border dark:border-border'>
        {state.topics.map(topic => (
          <div key={topic.id} className='flex items-center justify-between px-4 py-3'>
            <span className='text-sm font-medium text-foreground'>{topic.name}</span>
            <span className='text-desk-helper'>
              {topic.ticketCount} {topic.ticketCount === 1 ? 'ticket' : 'tickets'}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-[16px]'>
      <form
        className='flex flex-col gap-[6px]'
        onSubmit={e => {
          e.preventDefault();
          void createTopic();
        }}
      >
        <label htmlFor='desk-onboarding-new-topic' className='text-sm font-medium text-foreground'>
          New topic
        </label>
        <div className='flex items-center gap-2'>
          <input
            ref={newNameInputRef}
            id='desk-onboarding-new-topic'
            value={newName}
            onChange={e => {
              setNewName(e.target.value);
              if (e.target.value.trim()) setNameMissing(false);
            }}
            placeholder='Topic name, e.g. Refund requests'
            maxLength={200}
            data-track-category='DeskSettings'
            data-track-name='OnboardingNewTopicName'
            className={inputClass}
            disabled={creating}
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? 'desk-onboarding-new-topic-error' : undefined}
          />
          <button
            type='submit'
            className={primaryButtonClass}
            disabled={creating}
            data-track-category='DeskSettings'
            data-track-name='OnboardingCreateTopic'
          >
            <Plus size={14} />
            {creating ? 'Adding…' : 'Add topic'}
          </button>
        </div>
        {nameMissing && (
          <span
            id='desk-onboarding-new-topic-error'
            className='text-xs text-red-600 dark:text-red-400'
          >
            Type a topic name first.
          </span>
        )}
      </form>

      {state.topics.length === 0 ? (
        <EmptyState title='Add a topic'>
          A topic is a question paper: up to {ONBOARDING_MAX_TICKETS_PER_TOPIC} past tickets that
          new agents answer from the first email.
        </EmptyState>
      ) : (
        <div className='flex flex-col gap-[8px]'>
          {state.topics.map(topic => (
            <TopicCard
              key={topic.id}
              channelId={channelId}
              topic={topic}
              state={state}
              clawAgents={clawAgents}
              expanded={expandedId === topic.id}
              onToggle={() => setExpandedId(prev => (prev === topic.id ? null : topic.id))}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface TopicCardProps {
  channelId: string;
  topic: OnboardingTopicSummary;
  state: OnboardingState;
  clawAgents: ChannelClawAgent[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}

const TopicCard: React.FC<TopicCardProps> = ({
  channelId,
  topic,
  state,
  clawAgents,
  expanded,
  onToggle,
  onChanged,
}) => {
  const [name, setName] = useState(topic.name);
  // Follow renames that arrive with a refetch (another admin, or this rename's own save).
  const [syncedName, setSyncedName] = useState(topic.name);
  if (syncedName !== topic.name) {
    setSyncedName(topic.name);
    setName(topic.name);
  }
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState('');
  const { data: searchResults, isFetching: searching } = useOnboardingTicketSearch(
    expanded ? channelId : '',
    search,
  );

  const ticketsById = useMemo(() => new Map(state.tickets.map(t => [t.id, t])), [state.tickets]);
  const serverTicketIds = useMemo(
    () => (topic.tickets ?? []).map(t => t.ticketId),
    [topic.tickets],
  );
  // Reorder and remove apply here first, so the list moves under the cursor instead of after a
  // round trip; the server's list takes over again once it comes back (or a save fails).
  const [draftTicketIds, setDraftTicketIds] = useState<string[] | null>(null);
  const paperTicketIds = draftTicketIds ?? serverTicketIds;
  const isFull = paperTicketIds.length >= ONBOARDING_MAX_TICKETS_PER_TOPIC;
  const [moveAnnouncement, setMoveAnnouncement] = useState('');

  const run = async (action: () => Promise<void>, failure: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const saveTickets = async (ticketIds: string[]): Promise<void> => {
    setDraftTicketIds(ticketIds);
    try {
      await setOnboardingTopicTickets(channelId, topic.id, ticketIds);
      await onChanged();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't update the tickets"));
    } finally {
      setDraftTicketIds(null);
    }
  };

  const move = (index: number, delta: number): void => {
    const next = [...paperTicketIds];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + delta, 0, item);
    const title = ticketsById.get(item)?.title ?? 'Ticket';
    setMoveAnnouncement(`${title} moved to position ${index + delta + 1} of ${next.length}`);
    void saveTickets(next);
  };

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== '' && trimmedName !== topic.name;

  const saveName = (): void => {
    if (!nameChanged) return;
    void run(async () => {
      await updateOnboardingTopic(channelId, topic.id, { name: trimmedName });
      toast.success('Topic name saved');
    }, "Couldn't rename the topic");
  };

  return (
    <div className='rounded-[12px] border border-desk-border dark:border-border'>
      <button
        type='button'
        onClick={onToggle}
        className='flex w-full items-center gap-2 px-4 py-3 text-left'
        aria-expanded={expanded}
        data-track-category='DeskSettings'
        data-track-name='OnboardingToggleTopic'
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className='flex-1 truncate text-sm font-medium text-foreground'>{topic.name}</span>
        {topic.ticketCount === 0 && (
          <span className='shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300'>
            Add tickets to use it
          </span>
        )}
        <span className='text-desk-helper'>
          {topic.ticketCount}/{ONBOARDING_MAX_TICKETS_PER_TOPIC} tickets
        </span>
      </button>

      {expanded && (
        <div className='flex flex-col gap-[16px] border-t border-desk-border px-4 py-4 dark:border-border'>
          <div className='grid gap-[12px] md:grid-cols-2'>
            <div className='flex flex-col gap-[6px]'>
              <label
                className='text-sm font-medium text-foreground'
                htmlFor={`onboarding-topic-name-${topic.id}`}
              >
                Name
              </label>
              <div className='flex items-center gap-2'>
                <input
                  id={`onboarding-topic-name-${topic.id}`}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveName();
                    }
                    if (e.key === 'Escape') setName(topic.name);
                  }}
                  maxLength={200}
                  className={inputClass}
                  disabled={busy}
                  data-track-category='DeskSettings'
                  data-track-name='OnboardingTopicName'
                />
                {nameChanged && (
                  <>
                    <button
                      type='button'
                      className={primaryButtonClass}
                      onClick={saveName}
                      disabled={busy}
                      data-track-category='DeskSettings'
                      data-track-name='OnboardingSaveTopicName'
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type='button'
                      className={secondaryButtonClass}
                      onClick={() => setName(topic.name)}
                      disabled={busy}
                      data-track-category='DeskSettings'
                      data-track-name='OnboardingCancelTopicRename'
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
              {nameChanged && (
                <span className='text-desk-helper'>Press Enter to save, Esc to undo.</span>
              )}
            </div>
            <div className='flex flex-col gap-[6px]'>
              <span className='text-sm font-medium text-foreground'>Grading agent</span>
              <AutoDraftAgentPicker
                value={topic.graderAgentSlug ?? null}
                onChange={slug =>
                  void run(
                    () => updateOnboardingTopic(channelId, topic.id, { graderAgentSlug: slug }),
                    "Couldn't change the grading agent",
                  )
                }
                clawAgents={clawAgents}
                disabled={busy}
                defaultLabel={topic.defaultGraderAgentSlug ?? 'ask-ai'}
                emptyStateHelperText='Add a Claw agent to this channel to grade with it. Until then, the built-in ask-ai agent grades.'
              />
            </div>
          </div>

          <div className='flex flex-col gap-[8px]'>
            <div className='text-sm font-medium text-foreground'>Tickets</div>
            <div className='text-desk-helper'>
              Trainees see each ticket’s first email, in this order. Replies are graded against the
              rest of the thread as it is when they submit.
            </div>
            {paperTicketIds.length === 0 ? (
              <div className='text-desk-helper'>No tickets yet. Search below to add some.</div>
            ) : (
              <ol className='flex flex-col divide-y divide-desk-border rounded-[10px] border border-desk-border dark:divide-border dark:border-border'>
                {paperTicketIds.map((ticketId, index) => {
                  const ticket = ticketsById.get(ticketId);
                  const title = ticket?.title ?? 'Ticket unavailable';
                  // Different fallback on purpose: this one is read aloud, not displayed.
                  const label = ticket?.title ?? 'this ticket';
                  return (
                    <li key={ticketId} className='flex items-center gap-2 px-3 py-2'>
                      <span className='w-5 shrink-0 text-xs tabular-nums text-muted-foreground'>
                        {index + 1}
                      </span>
                      <span className='shrink-0 text-xs font-medium text-muted-foreground'>
                        {ticket?.xyneId ?? ''}
                      </span>
                      <TruncatedTooltip content={title}>
                        <span className='flex-1 truncate text-sm text-foreground'>{title}</span>
                      </TruncatedTooltip>
                      <button
                        type='button'
                        className={iconButtonClass}
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${label} up`}
                        data-track-category='DeskSettings'
                        data-track-name='OnboardingMoveTicketUp'
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type='button'
                        className={iconButtonClass}
                        onClick={() => move(index, 1)}
                        disabled={index === paperTicketIds.length - 1}
                        aria-label={`Move ${label} down`}
                        data-track-category='DeskSettings'
                        data-track-name='OnboardingMoveTicketDown'
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type='button'
                        className={iconButtonClass}
                        onClick={() =>
                          void saveTickets(paperTicketIds.filter(id => id !== ticketId))
                        }
                        aria-label={`Remove ${label} from this topic`}
                        data-track-category='DeskSettings'
                        data-track-name='OnboardingRemoveTicket'
                      >
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            <span className='sr-only' role='status' aria-live='polite'>
              {moveAnnouncement}
            </span>

            <label className='sr-only' htmlFor={`onboarding-ticket-search-${topic.id}`}>
              Search this desk’s tickets to add to this topic
            </label>
            <div className='relative'>
              <Search
                size={14}
                className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
              />
              <input
                id={`onboarding-ticket-search-${topic.id}`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={
                  isFull
                    ? `This topic is full (${ONBOARDING_MAX_TICKETS_PER_TOPIC} tickets)`
                    : 'Search this desk’s tickets by ID or title'
                }
                className={`${inputClass} pl-8`}
                disabled={busy || isFull}
                data-track-category='DeskSettings'
                data-track-name='OnboardingTicketSearch'
              />
            </div>
            {search.trim() && !isFull && (
              <div className='flex max-h-[240px] flex-col overflow-y-auto rounded-[10px] border border-desk-border dark:border-border'>
                {searching && !searchResults ? (
                  <div className='px-3 py-2 text-desk-helper'>Searching…</div>
                ) : (searchResults ?? []).length === 0 ? (
                  <div className='px-3 py-2 text-desk-helper'>No tickets match.</div>
                ) : (
                  (searchResults ?? []).map(result => {
                    const added = paperTicketIds.includes(result.id);
                    return (
                      <button
                        key={result.id}
                        type='button'
                        disabled={added}
                        onClick={() => void saveTickets([...paperTicketIds, result.id])}
                        className='flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 disabled:cursor-default disabled:opacity-60'
                        data-track-category='DeskSettings'
                        data-track-name='OnboardingAddTicket'
                      >
                        <span className='shrink-0 text-xs font-medium text-muted-foreground'>
                          {result.xyneId}
                        </span>
                        <span className='flex-1 truncate text-sm text-foreground'>
                          {result.title}
                        </span>
                        <span className='shrink-0 text-xs text-muted-foreground'>
                          {added ? 'Added' : 'Add'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className='flex items-center justify-between gap-2'>
            <span className='text-desk-helper'>
              {busy ? 'Saving…' : 'Ticket and grading agent changes save on their own.'}
            </span>
            <div className='flex items-center gap-2'>
              {confirmDelete ? (
                <>
                  <span className='text-desk-helper'>
                    Delete “{topic.name}”? Anyone mid-exam can still submit.
                  </span>
                  <button
                    type='button'
                    className={secondaryButtonClass}
                    onClick={() => setConfirmDelete(false)}
                    data-track-category='DeskSettings'
                    data-track-name='OnboardingKeepTopic'
                  >
                    Keep
                  </button>
                  <button
                    type='button'
                    className={dangerButtonClass}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => updateOnboardingTopic(channelId, topic.id, { deleted: true }),
                        "Couldn't delete the topic",
                      )
                    }
                    data-track-category='DeskSettings'
                    data-track-name='OnboardingDeleteTopic'
                  >
                    Delete topic
                  </button>
                </>
              ) : (
                <button
                  type='button'
                  className={secondaryButtonClass}
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  data-track-category='DeskSettings'
                  data-track-name='OnboardingConfirmDeleteTopic'
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
