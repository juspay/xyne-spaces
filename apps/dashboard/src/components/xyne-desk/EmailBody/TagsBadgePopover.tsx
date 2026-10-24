/**
 * Desk-email wiring for the generic tag components.
 * All logic lives in dashboard/src/components/tags/TagsBadge.tsx and
 * dashboard/src/hooks/useSourceTags.ts.
 */
import { Fragment, JSX, useState, useMemo } from 'react';
import type { TicketPriority } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { ChevronDown, Frown, Meh, Smile, Sparkles, type LucideIcon } from 'lucide-react';
import { Popover } from '../../ui/Popover/Popover';
import { HoverCard } from '../../ui/HoverCard';
import { getPriorityIcon } from '../../Tickets/TicketCard/TicketCard.utils';
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

export const EmailTagsBadge = ({
  emailId,
  onClose,
}: {
  emailId: string;
  onClose?: () => void;
}): JSX.Element => <EntityTagsBadge sourceType={DESK_EMAIL} sourceId={emailId} onClose={onClose} />;

// Built-in priority / sentiment values in scale order (backend DEFAULT_DESK_EMAIL_CONFIG).
type Level = { text: string; tint: string };
const GREEN: Level = {
  text: 'text-emerald-600 dark:text-emerald-300',
  tint: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900',
};
const PRIORITY: Record<string, Level> = {
  low: GREEN,
  medium: {
    text: 'text-amber-600 dark:text-amber-300',
    tint: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900',
  },
  high: {
    text: 'text-orange-600 dark:text-orange-300',
    tint: 'bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-900',
  },
  critical: {
    text: 'text-red-600 dark:text-red-300',
    tint: 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900',
  },
};
const SENTIMENT: Record<string, Level & { icon: LucideIcon }> = {
  negative: {
    icon: Frown,
    text: 'text-rose-600 dark:text-rose-300',
    tint: 'bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900',
  },
  neutral: {
    icon: Meh,
    text: 'text-slate-600 dark:text-slate-300',
    tint: 'bg-slate-100 border-slate-200 dark:bg-slate-800/60 dark:border-slate-700',
  },
  positive: { icon: Smile, ...GREEN },
};
const SCALES: Record<string, Record<string, Level>> = { priority: PRIORITY, sentiment: SENTIMENT };

/** Priority reuses the ticket priority bars; sentiment is a face. */
const SignalIcon = ({
  category,
  value,
  size,
}: {
  category: string;
  value: string;
  size: number;
}): JSX.Element | null => {
  if (category === 'priority') {
    return PRIORITY[value] ? <>{getPriorityIcon(value.toUpperCase() as TicketPriority)}</> : null;
  }
  const Face = SENTIMENT[value]?.icon;
  return Face ? <Face size={size} aria-hidden='true' /> : null;
};

/** Sentiment face on the sender avatar's corner, in the sentiment colour. */
export const EmailAvatarSentiment = ({ emailId }: { emailId: string }): JSX.Element | null => {
  const { groups } = useEntityTags(DESK_EMAIL, emailId, true);
  const tag = groups.find(g => g.category === 'sentiment')?.tags[0]?.tag ?? '';
  const sentiment = SENTIMENT[tag];
  if (!sentiment) return null;
  return (
    <span
      title={`Sentiment: ${tag}`}
      className={cn(
        'absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border ring-2 ring-background',
        sentiment.tint,
        sentiment.text,
      )}
    >
      <sentiment.icon size={10} aria-hidden='true' />
    </span>
  );
};

/**
 * Insight capsule (priority + sentiment) for one email, fetched on mount so every email in an
 * opened thread loads in parallel; hover shows each scale and the tag's reason.
 */
export const EmailSignalTags = ({ emailId }: { emailId: string }): JSX.Element | null => {
  const { groups } = useEntityTags(DESK_EMAIL, emailId, true);
  const signals = Object.keys(SCALES).flatMap(category => {
    const tag = groups.find(g => g.category === category)?.tags[0];
    return tag ? [{ category, ...tag, level: SCALES[category]?.[tag.tag] }] : [];
  });
  if (!signals.length) return null;

  const trigger = (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      className='inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-background pl-1.5 pr-2 text-[11px] font-medium capitalize leading-none whitespace-nowrap hover:bg-muted/60'
      data-track-category='Support'
      data-track-name='HoverEmailInsights'
    >
      <Sparkles size={11} className='shrink-0 text-violet-500' aria-hidden='true' />
      {signals.map(({ category, tag, level }, i) => (
        <Fragment key={category}>
          {i > 0 && <span className='h-3 w-px bg-border' aria-hidden='true' />}
          <span
            className={cn('inline-flex items-center gap-1', level?.text ?? 'text-muted-foreground')}
          >
            <SignalIcon category={category} value={tag} size={12} />
            {tag}
          </span>
        </Fragment>
      ))}
    </button>
  );

  return (
    <HoverCard
      trigger={trigger}
      openDelay={150}
      side='bottom'
      align='start'
      sideOffset={6}
      className='w-72 p-0 overflow-hidden'
    >
      <div className='flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2'>
        <Sparkles size={12} className='text-violet-500' aria-hidden='true' />
        <span className='text-xs font-semibold text-foreground'>Insights</span>
        <span className='ml-auto text-[10px] text-muted-foreground'>this email</span>
      </div>
      <div className='divide-y divide-border'>
        {signals.map(({ category, tag, reason, level }) => (
          <div key={category} className='px-3 py-2.5'>
            <div className='flex items-center justify-between'>
              <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                {category}
              </span>
              <span
                className={cn(
                  'text-xs font-semibold capitalize',
                  level?.text ?? 'text-muted-foreground',
                )}
              >
                {tag}
              </span>
            </div>
            {level && (
              <div
                className={cn(
                  'mt-2 grid gap-1',
                  category === 'priority' ? 'grid-cols-4' : 'grid-cols-3',
                )}
              >
                {Object.entries(SCALES[category] ?? {}).map(([name, t]) => (
                  <span
                    key={name}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded-md border py-1.5 text-[10px] capitalize',
                      name === tag
                        ? cn(t.tint, t.text, 'font-semibold')
                        : 'border-transparent text-muted-foreground opacity-50',
                    )}
                  >
                    <SignalIcon category={category} value={name} size={14} />
                    {name}
                  </span>
                ))}
              </div>
            )}
            <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
              {reason || <span className='italic'>No reason given</span>}
            </p>
          </div>
        ))}
      </div>
    </HoverCard>
  );
};

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
