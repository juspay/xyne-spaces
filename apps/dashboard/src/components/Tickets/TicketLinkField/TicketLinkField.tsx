import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Globe } from 'lucide-react';
import {
  CheckTickCircle as CircleCheck,
  LinkChainHorizontal as LinkIcon,
  Spinner as Loader2,
} from '@xyne/icons';
import { isManualSubTicketBoard } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import {
  useTicketFieldSearch,
  type TicketFieldSearchResult,
} from '../../../hooks/useTicketFieldSearch';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';
import { SubTicketModal } from '../SubTicketModal/SubTicketModal';
import { TicketLinkChip } from './TicketLinkChip';
import {
  TicketLinkPicker,
  type ExistingSubTicketOption,
  type TicketLinkHighlight,
} from './TicketLinkPicker';
import {
  extractTicketRefFromUrl,
  formatShortDate,
  isExternalHttpUrl,
  looksLikeXyneId,
  type PastedTicketRef,
} from './ticketLinkUtils';

type TicketLinkHighlightValue = Exclude<TicketLinkHighlight, null>;

const isSameHighlight = (a: TicketLinkHighlightValue, b: TicketLinkHighlightValue): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'create' || b.kind === 'create') return true;
  return a.index === b.index;
};

interface ExistingSubEntry {
  mappingId: string;
  addedAt: number;
  ticket: {
    id: string;
    xyneId?: string | null;
    title?: string | null;
    assignedTo?: string | null;
    statusV2?: string | null;
  };
}

interface TicketLinkFieldProps {
  /** The desk ticket whose form contains this field — drives sub-ticket context. */
  parentTicketId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  isOptional: boolean;
  disabled?: boolean;
  trackName: string;
}

/**
 * Rich TICKET form-field control: search a ticket, paste a link, or create one;
 * the selection becomes a sub-ticket of the parent desk ticket on form submit.
 */
export const TicketLinkField: React.FC<TicketLinkFieldProps> = ({
  parentTicketId,
  value,
  onChange,
  label,
  isOptional,
  disabled = false,
  trackName,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [highlight, setHighlight] = useState<TicketLinkHighlight>(null);
  const [resolveTarget, setResolveTarget] = useState<PastedTicketRef | null>(null);
  const [resolveErrorUrl, setResolveErrorUrl] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<{
    initialTitle?: string;
    initialDescription?: string;
  }>({});
  const hasPrefilledRef = useRef(false);
  // Set when the input is about to mount (opened from the chip or after clear);
  // focuses it once the dropdown renders.
  const shouldFocusInputRef = useRef(false);

  // ── Parent ticket + board context ──────────────────────────────────────────
  const [parentTicket] = useCachedQuery(queries.ticketRowById({ ticketId: parentTicketId }), {
    enabled: Boolean(parentTicketId),
  });
  const parentXyneId = parentTicket?.xyneId ?? '';
  const parentChannelId = parentTicket?.channelId ?? '';
  const parentProjectId = parentTicket?.projectId ?? undefined;
  const workspaceId = parentTicket?.workspaceId ?? '';

  const [parentBoard] = useCachedQuery(
    queries.boardDetailById({ boardId: parentTicket?.boardId ?? '' }),
    { enabled: Boolean(parentTicket?.boardId) },
  );
  const manualLinksAllowed = isManualSubTicketBoard(parentBoard?.boardType);

  // ── Existing sub-tickets of the parent ─────────────────────────────────────
  const [subTicketMappings] = useCachedQuery(
    queries.subTicketsForTicket({ ticketId: parentTicketId }),
    {
      enabled: Boolean(parentTicketId) && manualLinksAllowed,
    },
  );

  const existingSubEntries = useMemo<ExistingSubEntry[]>(() => {
    const rows: ExistingSubEntry[] = [];
    subTicketMappings?.forEach(mapping => {
      const ticket = mapping.subTicket?.mappedTicket;
      if (!ticket) return;
      rows.push({
        mappingId: mapping.id,
        addedAt: mapping.subTicket?.createdAt ?? 0,
        ticket: {
          id: ticket.id,
          xyneId: ticket.xyneId ?? null,
          title: ticket.title ?? null,
          assignedTo: ticket.assignedTo ?? null,
          statusV2: ticket.statusV2 ?? null,
        },
      });
    });
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  }, [subTicketMappings]);

  // Selectable form of the existing sub-tickets, shown inside the dropdown so
  // they stay pickable (single-select) whenever it is open — including right
  // after clearing the current selection.
  const existingSubTicketOptions = useMemo<ExistingSubTicketOption[]>(
    () =>
      existingSubEntries.map(entry => ({
        value: entry.ticket.xyneId || entry.ticket.id,
        title: entry.ticket.title || entry.ticket.xyneId || entry.ticket.id,
        addedAt: entry.addedAt,
      })),
    [existingSubEntries],
  );

  // ── Value modes ────────────────────────────────────────────────────────────
  // The stored value is the ticket's xyneId ("TOKEN-4127") — what users search
  // and see across the dashboard. Legacy values (ticket uuids) still resolve.
  const externalUrl = value && isExternalHttpUrl(value) ? value : null;
  const linkedValue = value && !isExternalHttpUrl(value) ? value : null;
  const linkedIsXyneId = linkedValue ? looksLikeXyneId(linkedValue) : false;

  const [linkedTicketById] = useCachedQuery(
    queries.ticketRowById({ ticketId: linkedValue && !linkedIsXyneId ? linkedValue : '' }),
    { enabled: Boolean(linkedValue) && !linkedIsXyneId },
  );
  const [linkedTicketByXyneId] = useCachedQuery(
    queries.ticketByXyneIdV3({
      xyneId: linkedIsXyneId ? (linkedValue ?? '') : '',
      workspaceId,
    }),
    { enabled: linkedIsXyneId && Boolean(workspaceId) },
  );
  const linkedTicket = linkedIsXyneId ? linkedTicketByXyneId : linkedTicketById;

  const existingEntryForValue = useMemo(
    () =>
      linkedValue
        ? existingSubEntries.find(
            e => e.ticket.id === linkedValue || e.ticket.xyneId === linkedValue,
          )
        : undefined,
    [linkedValue, existingSubEntries],
  );

  // ── Design 2a/2b: prefill the newest existing sub-ticket on open ───────────
  useEffect(() => {
    if (
      disabled ||
      value ||
      hasPrefilledRef.current ||
      !manualLinksAllowed ||
      existingSubEntries.length === 0
    ) {
      return;
    }
    const newest = existingSubEntries[0]?.ticket;
    if (!newest) return;
    hasPrefilledRef.current = true;
    onChange(newest.xyneId ?? newest.id);
  }, [disabled, value, manualLinksAllowed, existingSubEntries, onChange]);

  // ── Vespa search (Design 1d/1e) ────────────────────────────────────────────
  const {
    results: searchResults,
    isLoading: isSearchLoading,
    hasMore,
    totalCount,
    boardsSearched,
    searchQuery,
    handleSearchChange,
    handleScrollEnd,
  } = useTicketFieldSearch({ isActive: isDropdownOpen, projectId: parentProjectId });

  // ── Pasted link resolution (Design 1f/1h) ──────────────────────────────────
  const resolvingId = resolveTarget?.kind === 'id' ? resolveTarget.value : '';
  const resolvingXyneId = resolveTarget?.kind === 'xyneId' ? resolveTarget.value : '';
  const [resolvedById, byIdDetails] = useCachedQuery(
    queries.ticketRowById({ ticketId: resolvingId }),
    {
      enabled: resolveTarget?.kind === 'id',
    },
  );
  const [resolvedByXyneId, byXyneIdDetails] = useCachedQuery(
    queries.ticketByXyneIdV3({ xyneId: resolvingXyneId, workspaceId }),
    { enabled: resolveTarget?.kind === 'xyneId' && Boolean(workspaceId) },
  );

  const [pendingResolveUrl, setPendingResolveUrl] = useState('');

  // Close the dropdown when the user clicks outside the field.
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleDocumentMouseDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setHighlight(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return (): void => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isDropdownOpen]);

  // Focus the freshly mounted input when the dropdown was opened from the chip
  // or via the clear (×) button — at click time the input is not yet rendered.
  useEffect(() => {
    if (!shouldFocusInputRef.current || !isDropdownOpen) return;
    shouldFocusInputRef.current = false;
    inputRef.current?.focus();
  }, [isDropdownOpen]);

  // The dropdown is in-flow; when the field sits low in the modal, bring the
  // freshly opened dropdown into the visible area.
  useEffect(() => {
    if (!isDropdownOpen) return;
    const frame = requestAnimationFrame(() => {
      dropdownRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return (): void => cancelAnimationFrame(frame);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!resolveTarget) return;
    const details = resolveTarget.kind === 'id' ? byIdDetails : byXyneIdDetails;
    if (details.type !== 'complete') return;
    const resolved = resolveTarget.kind === 'id' ? resolvedById : resolvedByXyneId;

    if (resolved) {
      onChange(resolved.xyneId || resolved.id);
      setResolveTarget(null);
      setPendingResolveUrl('');
      setResolveErrorUrl(null);
      setInputValue('');
      handleSearchChange('');
    } else {
      setResolveErrorUrl(pendingResolveUrl);
      setInputValue(pendingResolveUrl);
      setResolveTarget(null);
      setPendingResolveUrl('');
    }
  }, [
    resolveTarget,
    resolvedById,
    resolvedByXyneId,
    byIdDetails,
    byXyneIdDetails,
    onChange,
    pendingResolveUrl,
    handleSearchChange,
  ]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setInputValue(next);
    setHighlight(null);

    const trimmed = next.trim();
    if (isExternalHttpUrl(trimmed)) {
      const ref = extractTicketRefFromUrl(trimmed);
      if (ref) {
        setPendingResolveUrl(trimmed);
        setResolveTarget(ref);
        setResolveErrorUrl(null);
        setIsDropdownOpen(false);
      } else {
        // Design 1g — non-Xyne URL: kept as an external link.
        setResolveErrorUrl(null);
        setResolveTarget(null);
        setIsDropdownOpen(false);
        onChange(trimmed);
      }
    } else {
      setResolveTarget(null);
      setResolveErrorUrl(null);
      handleSearchChange(next);
    }
  };

  const openSearch = useCallback((): void => {
    inputRef.current?.focus();
    if (!inputRef.current) shouldFocusInputRef.current = true;
    setIsDropdownOpen(true);
  }, []);

  const handleSelectSearchOption = (ticket: TicketFieldSearchResult): void => {
    onChange(ticket.xyneId || ticket.id);
    setIsDropdownOpen(false);
    setHighlight(null);
    setInputValue('');
    handleSearchChange('');
  };

  const handleSelectExistingSubTicket = (option: ExistingSubTicketOption): void => {
    onChange(option.value);
    setIsDropdownOpen(false);
    setHighlight(null);
    setInputValue('');
    handleSearchChange('');
  };

  const handleClear = (): void => {
    // An explicit removal stops the auto-prefill from re-selecting a sub-ticket.
    hasPrefilledRef.current = true;
    onChange(null);
    setInputValue('');
    handleSearchChange('');
    setResolveErrorUrl(null);
    // Show the search input again with the existing sub-tickets ready to pick.
    shouldFocusInputRef.current = true;
    setIsDropdownOpen(true);
  };

  const openCreateTicket = useCallback(
    (seed: { initialTitle?: string; initialDescription?: string } = {}): void => {
      if (!parentTicket?.channelId) return;
      setCreateSeed(seed);
      setIsDropdownOpen(false);
      setResolveErrorUrl(null);
      setIsCreateModalOpen(true);
    },
    [parentTicket?.channelId],
  );

  // Keyboard order: create row → existing sub-tickets → search results.
  const buildHighlightSequence = useCallback((): TicketLinkHighlightValue[] => {
    const sequence: TicketLinkHighlightValue[] = [];
    if (parentChannelId) sequence.push({ kind: 'create' });
    existingSubTicketOptions.forEach((_, index) => sequence.push({ kind: 'sub', index }));
    searchResults.forEach((_, index) => sequence.push({ kind: 'result', index }));
    return sequence;
  }, [parentChannelId, existingSubTicketOptions, searchResults]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!isDropdownOpen && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIsDropdownOpen(true);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const sequence = buildHighlightSequence();
        if (sequence.length === 0) break;
        const currentIndex =
          highlight === null ? -1 : sequence.findIndex(item => isSameHighlight(item, highlight));
        const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, sequence.length - 1);
        setHighlight(sequence[nextIndex] ?? null);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const sequence = buildHighlightSequence();
        if (sequence.length === 0) break;
        const currentIndex =
          highlight === null ? -1 : sequence.findIndex(item => isSameHighlight(item, highlight));
        const nextIndex = currentIndex <= 0 ? sequence.length - 1 : currentIndex - 1;
        setHighlight(sequence[nextIndex] ?? null);
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const active: TicketLinkHighlight =
          highlight ??
          (existingSubTicketOptions.length > 0
            ? { kind: 'sub', index: 0 }
            : searchResults.length > 0
              ? { kind: 'result', index: 0 }
              : parentChannelId
                ? { kind: 'create' }
                : null);
        if (!active) return;
        if (active.kind === 'create') {
          openCreateTicket(inputValue.trim() ? { initialTitle: inputValue.trim() } : {});
          return;
        }
        if (active.kind === 'sub') {
          const option = existingSubTicketOptions[active.index];
          if (option) handleSelectExistingSubTicket(option);
          return;
        }
        const target = searchResults[active.index];
        if (target) {
          handleSelectSearchOption(target);
        } else if (parentChannelId) {
          openCreateTicket(inputValue.trim() ? { initialTitle: inputValue.trim() } : {});
        }
        break;
      }
      case 'Escape':
        setIsDropdownOpen(false);
        setHighlight(null);
        break;
      default:
        break;
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const isResolving = resolveTarget !== null;
  const showErrorState = resolveErrorUrl !== null;

  return (
    <div ref={rootRef} className='relative'>
      <div className='mb-1 flex items-center gap-2'>
        <label className='text-sm font-medium text-foreground'>
          {label}
          {!isOptional && <span className='text-red-500'>*</span>}
        </label>
        {existingEntryForValue ? (
          <span className='rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-700'>
            Existing sub-ticket
          </span>
        ) : null}
        {existingSubEntries.length > 1 ? (
          <span className='ml-auto text-xs text-muted-foreground'>
            {existingSubEntries.length} on this ticket
          </span>
        ) : null}
      </div>

      {/* ── Linked ticket (Design 1b/2a) — hidden while the dropdown is open ── */}
      {linkedValue && !isDropdownOpen ? (
        <>
          <TicketLinkChip
            xyneId={linkedTicket?.xyneId || linkedValue}
            title={linkedTicket?.title || 'Resolving ticket…'}
            assignedTo={linkedTicket?.assignedTo}
            statusV2={linkedTicket?.statusV2}
            removable={!disabled}
            onClear={disabled ? undefined : handleClear}
            onClick={disabled ? undefined : openSearch}
          />
          {manualLinksAllowed ? (
            <p className='mt-1 flex items-center gap-1 text-xs text-muted-foreground'>
              <CircleCheck className='size-3.5 text-green-600' />
              {existingEntryForValue
                ? `Already a sub-ticket of ${parentXyneId}, added ${formatShortDate(existingEntryForValue.addedAt)}.`
                : `Will be added as a sub-ticket of ${parentXyneId}.`}
            </p>
          ) : null}
        </>
      ) : null}

      {/* ── External link (Design 1g) ── */}
      {externalUrl ? (
        <>
          <div className='flex w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2'>
            <Globe className='size-4 shrink-0 text-muted-foreground' />
            <ExternalLinkBits url={externalUrl} />
            {!disabled ? (
              <button
                type='button'
                onClick={handleClear}
                className='ml-auto rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                aria-label='Clear link'
                data-track-category='Tickets'
                data-track-name={`${trackName}ClearExternalLink`}
              >
                ×
              </button>
            ) : null}
          </div>
          <p className='mt-1 flex items-start gap-1 text-xs text-muted-foreground'>
            <AlertTriangle className='mt-0.5 size-3 shrink-0 text-amber-500' />
            Kept as an external link — no status comes back.{' '}
            {parentTicket?.channelId ? (
              <button
                type='button'
                onClick={() => {
                  try {
                    const parsed = new URL(externalUrl);
                    openCreateTicket({
                      initialTitle: `${parsed.host}${parsed.pathname}`,
                      initialDescription: externalUrl,
                    });
                  } catch {
                    openCreateTicket({ initialTitle: externalUrl });
                  }
                }}
                className='font-medium text-red-600 underline-offset-2 hover:underline'
                data-track-category='Tickets'
                data-track-name={`${trackName}CreateTicketFromExternalLink`}
              >
                Create a ticket from it
              </button>
            ) : null}{' '}
            to get updates on this ticket.
          </p>
        </>
      ) : null}

      {/* ── Resolving (Design 1f) ── */}
      {isResolving ? (
        <div className='flex w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2'>
          <Loader2 className='size-4 animate-spin text-muted-foreground' />
          <span className='min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground'>
            {pendingResolveUrl || inputValue}
          </span>
          <span className='shrink-0 text-xs text-muted-foreground'>Resolving…</span>
        </div>
      ) : null}

      {/* ── Search input (Design 1a/1d/1e) + paste-error state (1h) ──
          Also rendered while a value is linked and the dropdown is open, so
          clicking the chip (or ×) swaps the chip for the searchable picker. */}
      {!externalUrl && !isResolving && (!linkedValue || isDropdownOpen) ? (
        <>
          <div
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border bg-background px-3 shadow-sm transition-colors',
              showErrorState
                ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-200'
                : 'border-input focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
            )}
          >
            {showErrorState ? (
              <AlertTriangle className='size-4 shrink-0 text-red-500' />
            ) : (
              <LinkIcon className='size-4 shrink-0 text-muted-foreground' />
            )}
            <input
              ref={inputRef}
              type='text'
              value={inputValue}
              disabled={disabled}
              onChange={handleInputChange}
              onFocus={() => setIsDropdownOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder='Search, paste a link, or create a ticket'
              className='w-full bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed'
              data-track-category='Tickets'
              data-track-name={trackName}
            />
            {inputValue ? (
              <button
                type='button'
                onClick={handleClear}
                className='shrink-0 text-sm text-muted-foreground hover:text-foreground'
                aria-label='Clear input'
                data-track-category='Tickets'
                data-track-name={`${trackName}ClearInput`}
              >
                ×
              </button>
            ) : null}
          </div>

          {showErrorState ? (
            <div className='mt-2'>
              <p className='mb-2 text-xs text-red-600'>
                Couldn&rsquo;t resolve this link. Check it, search by ticket ID, or create the
                ticket.
              </p>
              <div className='flex gap-2'>
                <button
                  type='button'
                  onClick={() => {
                    const ref = extractTicketRefFromUrl(resolveErrorUrl);
                    if (ref) {
                      setPendingResolveUrl(resolveErrorUrl);
                      setResolveTarget(ref);
                      setResolveErrorUrl(null);
                    }
                  }}
                  className='rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted'
                  data-track-category='Tickets'
                  data-track-name={`${trackName}RetryResolve`}
                >
                  Try again
                </button>
                <button
                  type='button'
                  onClick={() => {
                    handleSearchChange(resolveErrorUrl);
                    setResolveErrorUrl(null);
                    setIsDropdownOpen(true);
                    inputRef.current?.focus();
                  }}
                  className='rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted'
                  data-track-category='Tickets'
                  data-track-name={`${trackName}SearchInstead`}
                >
                  Search instead
                </button>
              </div>
            </div>
          ) : null}

          {!showErrorState && !isDropdownOpen ? (
            <p className='mt-1 text-xs text-muted-foreground'>
              A Xyne ticket is linked as a sub-ticket, so its status shows up on this ticket.
            </p>
          ) : null}

          {isDropdownOpen ? (
            <div ref={dropdownRef}>
              <TicketLinkPicker
                query={searchQuery}
                results={searchResults}
                existingSubTickets={existingSubTicketOptions}
                selectedValue={linkedValue}
                isLoading={isSearchLoading}
                hasMore={hasMore}
                totalCount={totalCount}
                boardsSearched={boardsSearched}
                highlight={highlight}
                onHighlight={setHighlight}
                onSelect={handleSelectSearchOption}
                onSelectExisting={handleSelectExistingSubTicket}
                onScrollEnd={handleScrollEnd}
                onCreateTicket={() =>
                  openCreateTicket(inputValue.trim() ? { initialTitle: inputValue.trim() } : {})
                }
                canCreateTicket={Boolean(parentChannelId)}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {isCreateModalOpen ? (
        <SubTicketModal
          isOpen
          onClose={() => setIsCreateModalOpen(false)}
          ticketId={parentTicketId}
          conversationId={parentTicket?.conversationId ?? ''}
          {...(createSeed.initialTitle ? { initialTitle: createSeed.initialTitle } : {})}
          {...(createSeed.initialDescription
            ? { initialDescription: createSeed.initialDescription }
            : {})}
          onSuccess={created => {
            onChange(created.xyneId || created.id);
          }}
        />
      ) : null}
    </div>
  );
};

const ExternalLinkBits: React.FC<{ url: string }> = ({ url }) => {
  let host = url;
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.host;
    path = parsed.pathname;
  } catch {
    // raw string — show as-is
  }
  return (
    <>
      <span className='shrink-0 text-sm font-medium text-foreground'>{host}</span>
      {path && path !== '/' ? (
        <span className='min-w-0 truncate font-mono text-[12px] text-muted-foreground'>{path}</span>
      ) : null}
    </>
  );
};
