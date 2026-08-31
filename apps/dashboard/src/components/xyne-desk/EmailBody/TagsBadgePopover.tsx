/**
 * Desk-email wiring for the generic tag components.
 * All logic lives in dashboard/src/components/tags/TagsBadge.tsx and
 * dashboard/src/hooks/useSourceTags.ts.
 */
import { JSX, useState, useMemo } from 'react';
import { cn } from '../../../utils/classNames';
import { ChevronDown } from 'lucide-react';
import { Popover } from '../../ui/Popover/Popover';
import { useEntityTags, useTicketLatestEmailTags } from '../../../hooks/useSourceTags';
import {
  EntityTagsBadge,
  EntityTagsReadBadge,
  InlineTagGroups,
  TagEditorContent,
  CategoryLabel,
  TagChip,
} from '../../tags/TagsBadge';
import type { TagGroup } from '../../../api/tagsApi';

const DESK_EMAIL = 'desk-email';

// ─── Desk-email specific badges ───────────────────────────────────────────────

export const EmailTagsBadge = ({ emailId }: { emailId: string }): JSX.Element => (
  <EntityTagsBadge sourceType={DESK_EMAIL} sourceId={emailId} />
);

export const EmailTagsRow = ({ emailId }: { emailId: string }): JSX.Element | null => {
  const { groups, isLoading } = useEntityTags('desk-email', emailId, true);
  if (isLoading || groups.every(g => g.tags.length === 0)) return null;
  return <InlineTagGroups groups={groups.filter(g => g.tags.length > 0)} />;
};

const MAX_VISIBLE_CHIPS = 4;

export const TicketTagsRow = ({ ticketId }: { ticketId: string }): JSX.Element | null => {
  const [expanded, setExpanded] = useState(false);
  const { groups, isLoading } = useTicketLatestEmailTags(ticketId, true);

  const filtered = useMemo(() => groups.filter(g => g.tags.length > 0), [groups]);

  const totalChips = useMemo(() => filtered.reduce((sum, g) => sum + g.tags.length, 0), [filtered]);

  const { displayGroups, hiddenCount } = useMemo(() => {
    if (expanded) return { displayGroups: filtered, hiddenCount: 0 };
    if (totalChips <= MAX_VISIBLE_CHIPS) return { displayGroups: filtered, hiddenCount: 0 };
    let remaining = MAX_VISIBLE_CHIPS;
    const truncated = filtered.reduce<typeof filtered>((acc, g) => {
      if (remaining <= 0) return acc;
      const take = Math.min(remaining, g.tags.length);
      remaining -= take;
      return [...acc, { ...g, tags: g.tags.slice(0, take) }];
    }, []);
    return { displayGroups: truncated, hiddenCount: totalChips - MAX_VISIBLE_CHIPS };
  }, [filtered, expanded, totalChips]);

  if (isLoading || filtered.every(g => g.tags.length === 0)) return null;

  return (
    <div className='flex items-center gap-2 flex-wrap'>
      <span className='text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0'>
        Auto-tagged
      </span>
      <InlineTagGroups groups={displayGroups} />
      {hiddenCount > 0 && (
        <button
          type='button'
          onClick={() => setExpanded(true)}
          className='inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
          data-track-category='Tags'
          data-track-name='ExpandTagChips'
        >
          +{hiddenCount}
        </button>
      )}
      {expanded && totalChips > MAX_VISIBLE_CHIPS && (
        <button
          type='button'
          onClick={() => setExpanded(false)}
          className='inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
          data-track-category='Tags'
          data-track-name='CollapseTagChips'
        >
          Show less
        </button>
      )}
    </div>
  );
};

// ─── Read-only popover (used by TicketTagsBadge in the right column) ─────────

export const TagsBadgePopover = ({
  groups,
  isLoading,
  open,
  onOpenChange,
}: {
  groups: TagGroup[];
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element => {
  const trigger = (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      className='inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
      aria-label={open ? 'Hide tags' : 'Show tags'}
      data-track-category='Tags'
      data-track-name='ToggleTagsBadge'
    >
      <span>Tags</span>
      <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      side='bottom'
      align='end'
      sideOffset={6}
      className='p-4 shadow-lg'
    >
      <div className='space-y-3 min-w-[13rem] max-w-[22rem]'>
        {isLoading ? (
          <div className='text-xs text-muted-foreground'>Loading tags…</div>
        ) : groups.length === 0 ? (
          <div className='text-xs text-muted-foreground'>No tags yet</div>
        ) : (
          groups.map(group => (
            <div key={group.category} className='space-y-1.5'>
              <CategoryLabel name={group.category} color={group.color} />
              <div className='flex flex-wrap gap-1 pl-3.5'>
                {group.tags.map(tag => (
                  <TagChip key={tag.tag} tag={tag.tag} color={group.color} reason={tag.reason} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
};

export const TicketTagsBadge = ({ ticketId }: { ticketId: string }): JSX.Element => {
  const [open, setOpen] = useState(false);
  const { groups, isLoading } = useTicketLatestEmailTags(ticketId, open);
  return (
    <TagsBadgePopover groups={groups} isLoading={isLoading} open={open} onOpenChange={setOpen} />
  );
};

// ─── Re-exports for consumers that import from this file ─────────────────────
export {
  TagChip,
  CategoryLabel,
  InlineTagGroups,
  TagEditorContent,
  EntityTagsBadge,
  EntityTagsReadBadge,
};
export type { TagGroup };
