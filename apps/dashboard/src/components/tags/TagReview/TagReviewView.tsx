/**
 * The tag review queue.
 *
 * Free-form tags people invent on threads land here as proposals. An admin decides whether a
 * name earns a place in the workspace vocabulary — which is what the picker offers and what
 * the classifier is allowed to apply — or is turned down.
 *
 * List plus a right-hand reading pane, the shape Desk already uses: deciding a tag needs four
 * authored fields, so it cannot be a click in the row, and a modal would lose the queue.
 *
 * Filtering, counting and paging all happen on the server. Candidates are unbounded — anyone
 * can invent a name on any thread — so the client never holds the full set and therefore
 * cannot derive any of the three for itself.
 */
import { JSX, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Tags } from 'lucide-react';
import { useTagReview, type TagReviewFilters } from '../../../hooks/useTagReview';
import { Button } from '../../ui/Button/Button';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../../utils/classNames';
import { TagReviewRow } from './TagReviewRow';
import { TagDecisionPane } from './TagDecisionPane';
import { ClearFiltersPill, TagReviewFilter } from './TagReviewFilters';
import { TAG_REVIEW_COLUMNS, tagReviewAlignClass, tagReviewGridTemplate } from './tagReviewColumns';

const PAGE_SIZE = 20;

type GroupKey = keyof TagReviewFilters;

const GROUPS: GroupKey[] = ['proposedBy', 'status'];

const GROUP_LABEL: Record<GroupKey, string> = {
  proposedBy: 'Proposed by',
  status: 'Status',
};

// Opens on the only thing a reviewer has to act on. Everything else is history.
const initialFilters = (): TagReviewFilters => ({
  proposedBy: [],
  status: ['UNDER_REVIEW'],
});

const isDefault = (filters: TagReviewFilters): boolean =>
  filters.proposedBy.length === 0 &&
  filters.status.length === 1 &&
  filters.status[0] === 'UNDER_REVIEW';

export const TagReviewView = (): JSX.Element => {
  const [filters, setFilters] = useState<TagReviewFilters>(initialFilters);
  const [offset, setOffset] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const {
    entries,
    total,
    facets,
    isLoading,
    isFetching,
    reject,
    reconsider,
    save,
    remove,
    seed,
    isDeciding,
  } = useTagReview(filters, offset, PAGE_SIZE);

  // Facet counts ignore the status filter, so an absent APPROVED bucket means the workspace
  // has no approved types AT ALL — not merely that the current filter hides them. Nothing
  // seeds implicitly any more, so that is a state an admin has to be offered a way out of.
  const hasApproved = facets.status.some(option => option.value === 'APPROVED');

  // Page 4 of one filter almost never exists under the next, and landing on an empty page
  // reads as "no results" rather than "you are past the end".
  const setGroup =
    (group: GroupKey) =>
    (next: string[]): void => {
      setFilters(current => ({ ...current, [group]: next }));
      setOffset(0);
    };

  const clear = (): void => {
    setFilters(initialFilters());
    setOffset(0);
  };

  // The pane is keyed by name, and a name that is no longer on this page has nothing to show.
  useEffect(() => {
    if (selectedName && !entries.some(entry => entry.name === selectedName)) setSelectedName(null);
  }, [entries, selectedName]);

  const selected = useMemo(
    () => entries.find(entry => entry.name === selectedName) ?? null,
    [entries, selectedName],
  );

  const filtered = !isDefault(filters);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + entries.length, total);
  const hasPrev = offset > 0;
  const hasNext = offset + entries.length < total;

  return (
    <div className='flex h-full min-h-0 w-full'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='shrink-0 px-6 pt-5'>
          <h1 className='text-lg font-semibold text-foreground'>Tag review</h1>
          <p className='mt-0.5 text-sm text-muted-foreground'>
            Names people invented on threads. Approving one adds it to the picker and lets the
            classifier apply it; turning it down leaves it on the threads that already carry it.
          </p>
        </div>

        {/* Sits above the toolbar rather than inside the empty list: the list is empty on
            the default filter for an ordinary reason (nothing to review), and this is a
            different, rarer condition that must not be confused with it. */}
        {!isLoading && !hasApproved && (
          <div className='mx-6 mt-3 flex items-center gap-3 rounded-lg border border-border px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-medium text-foreground'>No thread types yet</p>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                Nothing can be tagged and the classifier is skipping every thread until this
                workspace has at least one type. Start from the standard set, or approve a proposal
                below to author your own.
              </p>
            </div>
            <Button
              size='sm'
              onClick={seed}
              loading={isDeciding}
              data-track-category='TagReview'
              data-track-name='SeedVocabulary'
            >
              Add the standard types
            </Button>
          </div>
        )}

        <div className='flex shrink-0 flex-wrap items-center gap-2 px-6 py-3'>
          {GROUPS.map(group => (
            <TagReviewFilter
              key={group}
              label={GROUP_LABEL[group]}
              options={facets[group]}
              selected={filters[group]}
              onChange={setGroup(group)}
              searchable={group === 'proposedBy'}
              searchPlaceholder='Search name or email'
            />
          ))}
          {filtered && <ClearFiltersPill onClear={clear} />}
          <span className='ml-auto text-xs tabular-nums text-muted-foreground'>
            {total === 0 ? '0 tags' : `${from}–${to} of ${total}`}
          </span>
        </div>

        <div
          className='grid shrink-0 items-center gap-x-3 px-6 pb-1.5'
          style={{ gridTemplateColumns: tagReviewGridTemplate(false) }}
        >
          {TAG_REVIEW_COLUMNS.map(column => (
            <div
              key={column.key}
              className={cn(
                'flex h-6 min-w-0 items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
                tagReviewAlignClass(column.key),
              )}
            >
              <span className='min-w-0 truncate'>{column.label}</span>
            </div>
          ))}
        </div>

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto border-t border-border transition-opacity',
            // The previous page stays on screen while the next loads, dimmed so the click
            // registers as having done something.
            isFetching && !isLoading && 'opacity-60',
          )}
        >
          {isLoading ? (
            <div className='space-y-2 px-6 py-4'>
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className='h-10 w-full' />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className='flex flex-col items-center gap-2 py-20 text-center'>
              <Tags className='size-6 text-muted-foreground/50' />
              <p className='text-sm text-muted-foreground'>
                {filtered ? 'No tags match these filters' : 'Nothing waiting to be reviewed'}
              </p>
            </div>
          ) : (
            entries.map(entry => (
              <TagReviewRow
                key={entry.name}
                entry={entry}
                isSelected={entry.name === selectedName}
                onSelect={name => setSelectedName(current => (current === name ? null : name))}
              />
            ))
          )}
        </div>

        {/* Offset paging, not infinite scroll: a reviewer works a queue and needs to know how
            much is left, which a scroll position cannot tell them. */}
        {total > PAGE_SIZE && (
          <div className='flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-2'>
            <span className='mr-auto text-xs tabular-nums text-muted-foreground'>
              {from}–{to} of {total}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={!hasPrev || isFetching}
              onClick={() => setOffset(current => Math.max(current - PAGE_SIZE, 0))}
              data-track-category='TagReview'
              data-track-name='PrevPage'
            >
              <ChevronLeft className='size-3.5' />
              Previous
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={!hasNext || isFetching}
              onClick={() => setOffset(current => current + PAGE_SIZE)}
              data-track-category='TagReview'
              data-track-name='NextPage'
            >
              Next
              <ChevronRight className='size-3.5' />
            </Button>
          </div>
        )}
      </div>

      {selected && (
        <TagDecisionPane
          entry={selected}
          onClose={() => setSelectedName(null)}
          onReject={() => reject([selected.name])}
          onReconsider={() => reconsider([selected.name])}
          onSave={save}
          onRemove={() => remove(selected.name)}
          isDeciding={isDeciding}
        />
      )}
    </div>
  );
};

export default TagReviewView;
