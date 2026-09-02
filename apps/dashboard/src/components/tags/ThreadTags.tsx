import { JSX, useCallback, useEffect, useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { parseAppliedTags, visibleTags, type AppliedTag, type ThreadTypeEntry } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { useUser } from '../../hooks/useUsers';
import { useShowThreadTags } from '../../hooks/useShowThreadTags';
import { useThreadTypeVocabulary } from '../../hooks/useThreadTypeVocabulary';
import { useMyPendingTags } from '../../hooks/useTagReview';
import { mutators } from '../../zero/mutators';
import { Tooltip } from '../ui/Tooltip/Tooltip';
import { Button } from '../ui/Button/Button';
import { cn } from '../../utils/classNames';
import { colorForTagName } from './tagColors';

interface ThreadTagsProps {
  conversationId: string | undefined;
  /** `conversations.threadType` — a JSON array of applied tags, or null when unclassified. */
  threadType: string | null | undefined;
  /** Without this the chips render read-only, with no remove control. */
  canEdit?: boolean;
  /** The tag currently being inspected — that chip renders pressed. */
  inspectedTag?: string | null;
  /** Clicking a chip inspects it; clicking the active one clears. Omit to disable. */
  onInspect?: (name: string | null) => void;
}

/**
 * The tag names on a thread, for callers that only need names — the picker's tick marks and
 * its toggle handlers. Deactivated tags are excluded: they were removed, and offering them
 * back as already-applied would make the menu lie.
 */
export const parseThreadTypes = (raw: string | null | undefined): string[] =>
  visibleTags(parseAppliedTags(raw)).map(tag => tag.name);

/**
 * Writes the FULL desired set — the column is one value, so a partial add/remove would be
 * a read-modify-write race between two clients. The mutator merges rather than replaces, so
 * a tag already there keeps the provenance it was applied with.
 */
export const useSetThreadTypes = (
  conversationId: string | undefined,
): ((types: string[], note?: string) => Promise<void>) => {
  const zero = useZero();
  return useCallback(
    async (types: string[], note?: string): Promise<void> => {
      if (!conversationId) return;
      try {
        const result = await zero.mutate(
          mutators.threadTag.setTypes({
            conversationId,
            types: types as never,
            timestamp: Date.now(),
            ...(note ? { note } : {}),
          }),
        ).server;
        if (result.type === 'error') {
          throw new Error(result.error.message || 'Failed to update thread tags');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update thread tags');
      }
    },
    [zero, conversationId],
  );
};

// 0 is the sentinel for a legacy row that carried no timestamp — show nothing rather than
// 1970.
const appliedAt = (at: number): string =>
  at === 0
    ? ''
    : new Date(at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

/** The tooltip body: definition, then who applied it and when. */
const TagTooltip = ({
  tag,
  entry,
  pending,
}: {
  tag: AppliedTag;
  entry: ThreadTypeEntry | undefined;
  pending: boolean;
}): JSX.Element => {
  // `by` is set only when a person acts on a tag, so its absence means the classifier did.
  // Empty string is a deliberate no-op lookup for classifier tags.
  const author = useUser(tag.by ?? '');
  const who = tag.by ? `Added by ${author?.name ?? 'someone'}` : 'Tagged by AI';
  const when = appliedAt(tag.at);

  return (
    <span className='block max-w-[260px] text-left'>
      <span className='block font-medium'>{entry?.label ?? tag.name}</span>
      {/* The SUMMARY, not the description. The description is the classifier's instruction —
          long, and mostly "NOT" clauses that exist to stop the model on near-misses. Every
          one of them is noise to someone hovering a chip. */}
      {entry?.summary ? <span className='block mt-0.5 opacity-80'>{entry.summary}</span> : null}
      <span className='block mt-1 opacity-70'>
        {who}
        {when && ` · ${when}`}
      </span>
      {/* Only the author of a name sees this, and only until an admin decides it. The tag is
          on the thread for everyone either way — what is pending is whether the NAME joins
          the picker. */}
      {pending && <span className='block mt-1 opacity-70'>Under review</span>}
    </span>
  );
};

/**
 * What kind of thread this is. A thread can be several things at once, so this is a set.
 *
 * Display plus a remove control — adding lives in the thread panel's overflow menu, since
 * classifying a thread is rare next to reading one.
 */
export const ThreadTags = ({
  conversationId,
  threadType,
  canEdit = false,
  inspectedTag = null,
  onInspect,
}: ThreadTagsProps): JSX.Element | null => {
  const setTypes = useSetThreadTypes(conversationId);
  const { showThreadTags } = useShowThreadTags();
  // Labels, colours, definitions and chip order all come from the workspace's vocabulary —
  // an admin can rename, recolour, redefine or reorder a type and chips follow immediately.
  const { entry: vocabularyEntry, sort } = useThreadTypeVocabulary();
  // Their own undecided proposals, nobody else's: a name pending for someone else is not this
  // reader's business, and it would be a request per client for a list they cannot act on.
  const isPending = useMyPendingTags(showThreadTags);

  const applied = useMemo(() => {
    const tags = visibleTags(parseAppliedTags(threadType));
    const byName = new Map(tags.map(tag => [tag.name, tag]));
    return sort([...byName.keys()])
      .map(name => byName.get(name))
      .filter((tag): tag is AppliedTag => Boolean(tag));
  }, [threadType, sort]);

  // A tag that is no longer on the thread cannot stay inspected, or its evidence chips hang
  // around after the chip that summoned them is gone. Keyed on the applied set rather than on
  // the remove button, so unticking from the overflow menu — or any future path that drops a
  // tag — is covered by the same guard.
  const appliedNames = applied.map(tag => tag.name).join('\u0000');
  useEffect(() => {
    if (!inspectedTag || !onInspect) return;
    if (!appliedNames.split('\u0000').includes(inspectedTag)) onInspect(null);
  }, [appliedNames, inspectedTag, onInspect]);

  // Opt-in per user: the classifier tags every thread, so rendering by default would put a
  // chip on every thread for people who never asked for them.
  if (!showThreadTags || applied.length === 0) {
    return null;
  }

  return (
    <span className='inline-flex items-center gap-1 align-middle'>
      {applied.map(tag => {
        // Undefined for a free-form tag, or one an admin has since removed — both keep
        // rendering from the stored name rather than disappearing.
        const entry = vocabularyEntry(tag.name);
        const color = entry?.color ?? colorForTagName(tag.name);
        const inspecting = inspectedTag === tag.name;
        // An entry means the name is already in the vocabulary, so nothing is pending on it.
        const pending = !entry && isPending(tag.name);
        const inspect = (): void => onInspect?.(inspecting ? null : tag.name);
        return (
          <Tooltip
            key={tag.name}
            content={<TagTooltip tag={tag} entry={entry} pending={pending} />}
          >
            <span
              {...(onInspect && {
                role: 'button',
                tabIndex: 0,
                'aria-pressed': inspecting,
                onClick: (event: MouseEvent): void => {
                  event.stopPropagation();
                  inspect();
                },
                onKeyDown: (event: KeyboardEvent): void => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  inspect();
                },
              })}
              className={cn(
                'group/chip inline-flex items-center gap-0.5 rounded-full text-[11px] font-medium',
                'leading-[16px] whitespace-nowrap align-middle py-[1px]',
                canEdit ? 'pl-1.5 pr-1' : 'px-1.5',
                onInspect && 'cursor-pointer',
                // Dashed, not a second badge: it reads as provisional without adding anything
                // to the chip, which is in an already tight row.
                pending && 'border border-dashed',
              )}
              style={{
                backgroundColor: `${color}${inspecting ? '33' : pending ? '12' : '1f'}`,
                color,
                ...(pending ? { borderColor: `${color}80` } : {}),
                ...(inspecting ? { boxShadow: `inset 0 0 0 1px ${color}` } : {}),
              }}
            >
              {entry?.label ?? tag.name}
              {canEdit && (
                <Button
                  variant='ghost'
                  type='button'
                  aria-label={`Remove ${entry?.label ?? tag.name}`}
                  trackId='remove_thread_tag'
                  // Width reserved, only opacity changes, so the chip does not resize under
                  // the cursor. stopPropagation because the row opens the thread on click.
                  onClick={event => {
                    event.stopPropagation();
                    void setTypes(applied.filter(t => t.name !== tag.name).map(t => t.name));
                  }}
                  className='opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 transition-opacity rounded-full'
                  data-track-category='Tags'
                  data-track-name='RemoveThreadTag'
                >
                  <X className='size-2.5' />
                </Button>
              )}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
};
