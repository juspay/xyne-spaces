import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Globe } from 'lucide-react';
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
import { CreateTicketModal } from '../CreateTicketModal/CreateTicketModal';
import { TicketLinkChip } from './TicketLinkChip';
import { TicketLinkPicker, type TicketLinkHighlight } from './TicketLinkPicker';
import {
  extractTicketRefFromUrl,
  formatShortDate,
  isExternalHttpUrl,
  looksLikeXyneId,
  type PastedTicketRef,
} from './ticketLinkUtils';

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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
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

  // Close the dropdown/sub-picker when the user clicks outside the field.
  useEffect(() => {
    if (!isDropdownOpen && !isPickerOpen) return;
    const handleDocumentMouseDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setIsPickerOpen(false);
        setHighlight(null);
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return (): void => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isDropdownOpen, isPickerOpen]);

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
    setIsPickerOpen(false);
    setIsDropdownOpen(true);
    inputRef.current?.focus();
  }, []);

  const handleSelectSearchOption = (ticket: TicketFieldSearchResult): void => {
    onChange(ticket.xyneId || ticket.id);
    setIsDropdownOpen(false);
    setHighlight(null);
    setInputValue('');
    handleSearchChange('');
  };

  const handleClear = (): void => {
    onChange(null);
    setInputValue('');
    handleSearchChange('');
    setResolveErrorUrl(null);
    setIsDropdownOpen(false);
  };

  const openCreateTicket = useCallback(
    (seed: { initialTitle?: string; initialDescription?: string } = {}): void => {
      if (!parentTicket?.channelId) return;
      setCreateSeed(seed);
      setIsDropdownOpen(false);
      setIsPickerOpen(false);
      setResolveErrorUrl(null);
      setIsCreateModalOpen(true);
    },
    [parentTicket?.channelId],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!isDropdownOpen && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIsDropdownOpen(true);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlight(previous =>
          previous === null
            ? parentChannelId
              ? 'create'
              : 0
            : previous === 'create'
              ? 0
              : Math.min(previous + 1, searchResults.length - 1),
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight(previous =>
          previous === null
            ? searchResults.length - 1
            : previous === 0
              ? parentChannelId
                ? 'create'
                : searchResults.length - 1
              : previous === 'create'
                ? searchResults.length - 1
                : previous - 1,
        );
        break;
      case 'Enter': {
        event.preventDefault();
        if (highlight === 'create') {
          openCreateTicket(inputValue.trim() ? { initialTitle: inputValue.trim() } : {});
          return;
        }
        const target = highlight === null ? searchResults[0] : searchResults[highlight];
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

      {/* ── Linked ticket (Design 1b/2a) ── */}
      {linkedValue ? (
        <>
          <TicketLinkChip
            xyneId={linkedTicket?.xyneId || linkedValue}
            title={linkedTicket?.title || 'Resolving ticket…'}
            assignedTo={linkedTicket?.assignedTo}
            statusV2={linkedTicket?.statusV2}
            removable={!disabled}
            onClear={disabled ? undefined : handleClear}
            onClick={
              disabled
                ? undefined
                : (): void => {
                    if (existingSubEntries.length > 1) {
                      setIsPickerOpen(previous => !previous);
                      setIsDropdownOpen(false);
                    } else {
                      openSearch();
                    }
                  }
            }
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

      {/* ── Search input (Design 1a/1d/1e) + paste-error state (1h) ── */}
      {!linkedValue && !externalUrl && !isResolving ? (
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
            <TicketLinkPicker
              query={searchQuery}
              results={searchResults}
              isLoading={isSearchLoading}
              hasMore={hasMore}
              totalCount={totalCount}
              boardsSearched={boardsSearched}
              highlight={highlight}
              onHighlight={setHighlight}
              onSelect={handleSelectSearchOption}
              onScrollEnd={handleScrollEnd}
              onCreateTicket={() =>
                openCreateTicket(inputValue.trim() ? { initialTitle: inputValue.trim() } : {})
              }
              canCreateTicket={Boolean(parentChannelId)}
            />
          ) : null}
        </>
      ) : null}

      {/* ── Sub-ticket chooser (Design 2b/1c) ── */}
      {isPickerOpen && existingSubEntries.length > 1 ? (
        <div className='mt-1 rounded-lg border border-border bg-background'>
          <p className='px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground'>
            If there is more than one
          </p>
          <ul className='py-1'>
            {existingSubEntries.map((entry, index) => {
              const checked = entry.ticket.id === value;
              return (
                <li key={entry.mappingId}>
                  <button
                    type='button'
                    onClick={() => {
                      if (entry.ticket.xyneId || entry.ticket.id) {
                        onChange(entry.ticket.xyneId || entry.ticket.id);
                      }
                      setIsPickerOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                      checked ? 'bg-accent/60' : 'hover:bg-muted',
                    )}
                    data-track-category='Tickets'
                    data-track-name={`${trackName}PickExistingSubTicket`}
                    data-track-metadata={JSON.stringify({ ticketId: entry.ticket.id })}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-full border',
                        checked ? 'border-blue-600' : 'border-input',
                      )}
                    >
                      {checked ? <span className='size-2 rounded-full bg-blue-600' /> : null}
                    </span>
                    <span className='w-[96px] shrink-0 truncate font-mono text-[13px] text-muted-foreground'>
                      {entry.ticket.xyneId || entry.ticket.id}
                    </span>
                    <span className='min-w-0 flex-1 truncate text-sm text-foreground'>
                      {entry.ticket.title || entry.ticket.xyneId || entry.ticket.id}
                    </span>
                    <span className='shrink-0 text-[11px] text-muted-foreground'>
                      {index === 0 ? 'most recent' : formatShortDate(entry.addedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type='button'
            onClick={openSearch}
            className='flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted'
            data-track-category='Tickets'
            data-track-name={`${trackName}LinkDifferentTicket`}
          >
            <Plus className='size-4 shrink-0' />
            Link a different ticket instead
          </button>
          <p className='px-3 pb-2.5 pt-1 text-xs text-muted-foreground'>
            The newest sub-ticket is filled in; pick another if this move is waiting on that one
            instead.
          </p>
        </div>
      ) : null}

      {isCreateModalOpen && parentTicket?.channelId ? (
        <CreateTicketModal
          isOpen
          onClose={() => setIsCreateModalOpen(false)}
          channelId={parentTicket.channelId}
          {...(parentProjectId ? { projectId: parentProjectId } : {})}
          parentTicketId={parentTicketId}
          {...(createSeed.initialTitle ? { initialTitle: createSeed.initialTitle } : {})}
          {...(createSeed.initialDescription
            ? { initialDescription: createSeed.initialDescription }
            : {})}
          onTicketCreated={created => {
            setIsCreateModalOpen(false);
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
