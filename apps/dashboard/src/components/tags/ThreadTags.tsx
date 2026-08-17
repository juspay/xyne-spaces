import { JSX, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { threadTypeEntry } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { useShowThreadTags } from '../../hooks/useShowThreadTags';
import { mutators } from '../../zero/mutators';
import { cn } from '../../utils/classNames';
import { colorForTagName } from './tagColors';

interface ThreadTagsProps {
  conversationId: string | undefined;
  /** `conversations.threadType` — a stringified JSON array, or null when unclassified. */
  threadType: string | null | undefined;
  /** Without this the chips render read-only, with no remove control. */
  canEdit?: boolean;
}

/** Plain TEXT in the database, so parse defensively — nothing guarantees the shape. */
export const parseThreadTypes = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // Any non-empty string is valid — tags are free-form beyond the built-in vocabulary.
    if (!Array.isArray(parsed)) return typeof parsed === 'string' && parsed ? [parsed] : [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    // Rows written before the column held an array stored a bare name rather than JSON.
    return raw.trim() ? [raw] : [];
  }
};

/**
 * Writes the FULL desired set — the column is one value, so a partial add/remove would be
 * a read-modify-write race between two clients.
 */
export const useSetThreadTypes = (
  conversationId: string | undefined,
): ((types: string[]) => Promise<void>) => {
  const zero = useZero();
  return useCallback(
    async (types: string[]): Promise<void> => {
      if (!conversationId) return;
      try {
        const result = await zero.mutate(
          mutators.threadTag.setTypes({ conversationId, types: types as never }),
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

/**
 * What kind of thread this is. A thread can be several things at once, so this is a set.
 *
 * Display plus a remove control — adding lives in the message overflow menu, since
 * classifying a thread is rare next to reading one.
 */
export const ThreadTags = ({
  conversationId,
  threadType,
  canEdit = false,
}: ThreadTagsProps): JSX.Element | null => {
  const applied = useMemo(() => parseThreadTypes(threadType), [threadType]);
  const setTypes = useSetThreadTypes(conversationId);
  const { showThreadTags } = useShowThreadTags();

  // Opt-in per user: the classifier tags every thread, so rendering by default would put a
  // chip on every row for people who never asked for them.
  if (!showThreadTags || applied.length === 0) {
    return null;
  }

  return (
    <span className='inline-flex items-center gap-1 align-middle'>
      {applied.map(name => {
        const entry = threadTypeEntry(name);
        const color = entry?.color ?? colorForTagName(name);
        return (
          <span
            key={name}
            className={cn(
              'group/chip inline-flex items-center gap-0.5 rounded-full text-[11px] font-medium',
              'leading-[16px] whitespace-nowrap align-middle py-[1px]',
              canEdit ? 'pl-1.5 pr-1' : 'px-1.5',
            )}
            style={{ backgroundColor: `${color}1f`, color }}
            title={entry?.description ?? name}
          >
            {entry?.label ?? name}
            {canEdit && (
              <button
                type='button'
                aria-label={`Remove ${entry?.label ?? name}`}
                // Width reserved, only opacity changes, so the chip does not resize under
                // the cursor. stopPropagation because the row opens the thread on click.
                onClick={event => {
                  event.stopPropagation();
                  void setTypes(applied.filter(value => value !== name));
                }}
                className='opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 transition-opacity rounded-full'
                data-track-category='Tags'
                data-track-name='RemoveThreadTag'
              >
                <X className='size-2.5' />
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
};
