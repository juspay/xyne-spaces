import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { User } from '@xyne/shared/machines';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, MultipleCrossCancelDefault, SearchBig, PhoneDefault } from '@xyne/icons';
import { format } from 'date-fns';
import { Button } from '../../../components/ui/Button/Button';
import { Checkbox } from '../../../components/ui/Checkbox/Checkbox';
import { Dialog } from '../../../components/ui/Dialog';
import { XyneAIStar } from '../../../components/icons/xyne-ai';
import {
  buildParticipantSummary,
  getPreviewParticipantUsers,
  type Call,
} from '../../CallHistoryScreen/callHistoryItem.utils';
import { cn } from '../../../utils/classNames';
import { formatDuration } from '../../../utils/dateUtils';
import { normalizeRecordingTags } from '../../../utils/recordingUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { buildDateGroupedRowsFromItems } from '../../../utils/dateGroupedList';

export interface CallAskAIModalProps {
  open: boolean;
  calls: Call[];
  users: User[];
  currentUserId: string | undefined;
  resolveLabel?: (label: string) => string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (calls: Call[]) => void;
}

interface SearchableCall {
  call: Call;
  participants: User[];
  haystack: string;
}

const MAX_SELECTED_CALLS = 25;

const LIMIT_NOTICE_MS = 3200;

/** Mirrors the list rows: two names, then a count for whoever is left. */
function formatParticipants(participants: User[]): string {
  if (participants.length === 0) return 'Just you';
  return buildParticipantSummary(
    participants.map(participant => getUserDisplayName(participant)),
    participants.length,
  );
}

const CallAskAIModal = ({
  open,
  calls,
  users,
  currentUserId,
  resolveLabel = (label: string): string => label,
  onOpenChange,
  onConfirm,
}: CallAskAIModalProps): ReactElement => {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [limitNotice, setLimitNotice] = useState(0);
  const [isLimitNoticeVisible, setIsLimitNoticeVisible] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (limitNotice === 0) return;

    setIsLimitNoticeVisible(true);
    const timer = window.setTimeout(() => setIsLimitNoticeVisible(false), LIMIT_NOTICE_MS);
    return (): void => window.clearTimeout(timer);
  }, [limitNotice]);

  const searchable = useMemo<SearchableCall[]>(
    () =>
      calls.map(call => {
        const participants = getPreviewParticipantUsers(
          call.participantPreviewUserIds,
          users,
          currentUserId,
        );
        const labels = normalizeRecordingTags(call.labels).map(resolveLabel);
        return {
          call,
          participants,
          haystack: [
            call.title ?? '',
            ...participants.map(participant => getUserDisplayName(participant)),
            ...labels,
          ]
            .join(' ')
            .toLowerCase(),
        };
      }),
    [calls, users, currentUserId, resolveLabel],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return searchable;
    return searchable.filter(entry => entry.haystack.includes(needle));
  }, [searchable, query]);

  const participantsByCallId = useMemo(
    () => new Map(searchable.map(entry => [entry.call.id, entry.participants])),
    [searchable],
  );

  const rows = useMemo(
    () => buildDateGroupedRowsFromItems(filtered.map(entry => entry.call)),
    [filtered],
  );

  const filteredIds = useMemo(() => filtered.map(entry => entry.call.id), [filtered]);
  const selectedFilteredCount = filteredIds.filter(id => selectedIds.has(id)).length;
  const allFilteredSelected =
    filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;

  const toggleCall = useCallback(
    (callId: string): void => {
      const isSelected = selectedIds.has(callId);
      if (!isSelected && selectedIds.size >= MAX_SELECTED_CALLS) {
        setLimitNotice(value => value + 1);
        return;
      }

      setSelectedIds(previous => {
        const next = new Set(previous);
        if (isSelected) next.delete(callId);
        else next.add(callId);
        return next;
      });
    },
    [selectedIds],
  );

  /** Fills up to the cap rather than refusing outright, then says what it left out. */
  const handleToggleAll = useCallback(
    (checked: boolean): void => {
      const next = new Set(selectedIds);

      if (!checked) {
        for (const id of filteredIds) next.delete(id);
        setSelectedIds(next);
        return;
      }

      let refused = false;
      for (const id of filteredIds) {
        if (next.has(id)) continue;
        if (next.size >= MAX_SELECTED_CALLS) {
          refused = true;
          break;
        }
        next.add(id);
      }

      setSelectedIds(next);
      if (refused) setLimitNotice(value => value + 1);
    },
    [filteredIds, selectedIds],
  );

  const handleClose = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleConfirm = useCallback((): void => {
    if (selectedIds.size === 0) return;
    onConfirm(calls.filter(call => selectedIds.has(call.id)));
    onOpenChange(false);
  }, [onConfirm, onOpenChange, calls, selectedIds]);

  const selectedCount = selectedIds.size;
  const isAtLimit = selectedCount >= MAX_SELECTED_CALLS;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Choose context'
      description='Pick the calls Ask AI should answer from'
      className='max-w-xl overflow-hidden rounded-[18px] p-0'
      testId='call-ask-ai-modal'
    >
      <div className='flex max-h-[90vh] w-full flex-col'>
        {/* Header, search and select-all stay put; only the list below scrolls. */}
        <div className='flex items-center gap-3 border-b border-border px-4 py-3.5'>
          <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted'>
            <XyneAIStar size={15} />
          </span>
          <span className='min-w-0 flex-1'>
            <span className='block text-sm font-semibold text-foreground'>Choose context</span>
            <span className='block truncate text-xs text-muted-foreground'>
              Pick the calls Ask AI should answer from
            </span>
          </span>
          <Button
            type='button'
            variant='ghost'
            size='iconSm'
            onClick={handleClose}
            aria-label='Close'
            className='shrink-0 text-muted-foreground hover:text-foreground'
            data-track-category='CALLS'
            data-track-name='close_ask_ai_context_modal'
          >
            <MultipleCrossCancelDefault size={16} />
          </Button>
        </div>

        <div className='flex items-center gap-2.5 border-b border-border px-4 py-2.5'>
          <SearchBig
            size={14}
            className='shrink-0 text-muted-foreground/70'
            strokeWidth={2.5}
            aria-hidden='true'
          />
          <input
            type='text'
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='Search calls, people or labels...'
            aria-label='Search calls, people or labels'
            className='w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
            data-track-category='CALLS'
            data-track-name='search_ask_ai_context_calls'
          />
        </div>

        <div className='flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2'>
          <Checkbox
            checked={allFilteredSelected}
            onChange={handleToggleAll}
            disabled={filteredIds.length === 0}
            label='Select all'
          />
          <span className='flex shrink-0 items-center gap-3 text-xs text-muted-foreground'>
            {/* Re-keyed on each refusal so the nudge replays even when the count
                itself hasn't changed — that's the whole point at the cap. */}
            <motion.span
              key={limitNotice}
              animate={shouldReduceMotion || limitNotice === 0 ? {} : { x: [0, -4, 4, -2, 2, 0] }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className={cn(isAtLimit && 'text-status-pending')}
            >
              {selectedCount === 0
                ? 'None selected'
                : `${selectedCount} of ${calls.length} selected`}
            </motion.span>
            {selectedCount > 0 && (
              <button
                type='button'
                onClick={() => setSelectedIds(new Set())}
                className='font-medium text-foreground underline-offset-2 hover:underline'
                data-track-category='CALLS'
                data-track-name='clear_ask_ai_context_selection'
              >
                Clear
              </button>
            )}
          </span>
        </div>
        <div className='min-h-xs flex-1 overflow-y-auto px-2.5 py-2 no-scrollbar'>
          {rows.length === 0 ? (
            <p className='flex min-h-[160px] items-center justify-center px-6 text-center text-sm text-muted-foreground'>
              No calls match that search.
            </p>
          ) : (
            <ul
              className='flex flex-col'
              role='listbox'
              aria-multiselectable='true'
              data-theme-tokens
            >
              {rows.map(row =>
                row.type === 'group' ? (
                  <li
                    key={row.id}
                    role='presentation'
                    className='px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70'
                  >
                    {row.label}
                  </li>
                ) : (
                  <CallOption
                    key={row.id}
                    call={row.item}
                    participants={participantsByCallId.get(row.item.id) ?? []}
                    checked={selectedIds.has(row.item.id)}
                    blocked={isAtLimit && !selectedIds.has(row.item.id)}
                    onToggle={toggleCall}
                  />
                ),
              )}
            </ul>
          )}
        </div>
        <div className='flex items-center gap-3 border-t border-border px-4 py-3'>
          <span className='min-w-0 flex-1'>
            <AnimatePresence mode='wait' initial={false}>
              <motion.span
                key={isLimitNoticeVisible ? 'limit' : 'hint'}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.16, ease: 'easeOut' }}
                className={cn(
                  'flex items-center gap-1.5 truncate text-xs',
                  isLimitNoticeVisible ? 'text-status-pending' : 'text-muted-foreground/70',
                )}
                {...(isLimitNoticeVisible && { role: 'status', 'aria-live': 'polite' })}
              >
                {isLimitNoticeVisible ? (
                  <>
                    <AlertTriangle size={13} className='shrink-0' aria-hidden='true' />
                    <span className='truncate'>Limit is {MAX_SELECTED_CALLS} calls</span>
                  </>
                ) : selectedCount === 0 ? (
                  'Select at least one call'
                ) : (
                  'Answers will cite only these calls'
                )}
              </motion.span>
            </AnimatePresence>
          </span>
          <Button
            type='button'
            variant='outline'
            onClick={handleClose}
            className='h-8 shrink-0 rounded-lg px-3 text-xs font-semibold'
            data-track-category='CALLS'
            data-track-name='cancel_ask_ai_context'
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={handleConfirm}
            disabled={selectedCount === 0}
            className='h-8 shrink-0 gap-2.5 rounded-lg px-5 text-xs font-semibold bg-foreground text-background hover:bg-foreground/80 transition-opacity duration-300'
            data-track-category='CALLS'
            data-track-name='send_calls_to_ask_ai'
            data-track-metadata={JSON.stringify({ callCount: selectedCount })}
          >
            <XyneAIStar size={12} />
            {selectedCount === 0
              ? 'Send to Ask AI'
              : selectedCount === 1
                ? 'Ask this call'
                : `Ask across ${selectedCount} calls`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

interface CallOptionProps {
  call: Call;
  participants: User[];
  checked: boolean;
  blocked: boolean;
  onToggle: (callId: string) => void;
}

const CallOption = ({
  call,
  participants,
  checked,
  blocked,
  onToggle,
}: CallOptionProps): ReactElement => {
  const title = call.title || formatParticipants(participants);
  const durationMs = call.endedAt ? Math.max(0, call.endedAt - call.startedAt) : undefined;
  const startedAt = call.startsAt || call.startedAt;

  return (
    <li
      role='option'
      aria-selected={checked}
      aria-disabled={blocked}
      data-theme-tokens
      onClick={() => onToggle(call.id)}
      onKeyDown={event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onToggle(call.id);
      }}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-2 transition-[background-color,opacity] duration-200',
        checked ? 'bg-accent' : 'hover:bg-accent/60',
        blocked ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
      )}
      data-track-category='CALLS'
      data-track-name='toggle_ask_ai_context_call'
    >
      <span className='pointer-events-none shrink-0'>
        <Checkbox checked={checked} onChange={() => onToggle(call.id)} label='' />
      </span>

      <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
        <PhoneDefault size={15} strokeWidth={2.2} />
      </span>

      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium text-foreground'>{title}</span>
        <span className='mt-0.5 block truncate text-xs text-muted-foreground'>
          {formatParticipants(participants)} · {format(new Date(startedAt), 'h:mm a')}
        </span>
      </span>

      <span className='shrink-0 font-mono text-xs text-muted-foreground/70'>
        {formatDuration(durationMs)}
      </span>
    </li>
  );
};

export default CallAskAIModal;
