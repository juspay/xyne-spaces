import { ChevronDown, Loader2, Plus, Tag, X } from 'lucide-react';
import { JSX, useState } from 'react';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button/Button';
import { Popover } from '../ui/Popover/Popover';
import { useTagEditor, useEntityTags } from '../../hooks/useSourceTags';
import type { TagGroup } from '../../api/tagsApi';

const safeColor = (c?: string): string => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#6b7280');

// ─── Shared primitives ────────────────────────────────────────────────────────

export const TagChip = ({
  tag,
  color,
  reason,
}: {
  tag: string;
  color?: string | undefined;
  reason?: string | null | undefined;
}): JSX.Element => {
  const c = safeColor(color);
  return (
    <span
      title={reason ?? undefined}
      className='inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none border'
      style={{ color: c, backgroundColor: c + '1a', borderColor: c + '4d' }}
    >
      {tag}
    </span>
  );
};

export const CategoryLabel = ({
  name,
  color,
}: {
  name: string;
  color?: string | undefined;
}): JSX.Element => (
  <div className='flex items-center gap-1.5'>
    <span
      className='size-1.5 rounded-full shrink-0'
      style={{ backgroundColor: safeColor(color) }}
    />
    <span className='text-[10px] font-bold uppercase tracking-widest text-muted-foreground'>
      {name}
    </span>
  </div>
);

// ─── Inline tag groups (read-only) ───────────────────────────────────────────

export const InlineTagGroups = ({ groups }: { groups: TagGroup[] }): JSX.Element => (
  <div className='flex items-center gap-x-3 gap-y-1.5 flex-wrap'>
    {groups.map(group => (
      <div key={group.category} className='flex items-center gap-1 flex-wrap'>
        <span
          className='size-1.5 rounded-full shrink-0'
          style={{ backgroundColor: safeColor(group.color) }}
        />
        <span className='text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0'>
          {group.category}
        </span>
        {group.tags.map(t => (
          <TagChip key={t.tag} tag={t.tag} color={group.color} reason={t.reason} />
        ))}
      </div>
    ))}
  </div>
);

// ─── Generic interactive tag editor (inside the popover) ─────────────────────

export const TagEditorContent = ({
  sourceType,
  sourceId,
}: {
  sourceType: string;
  sourceId: string;
}): JSX.Element => {
  const { groups, isLoading, mutating, error, addTag, removeTag } = useTagEditor({
    sourceType,
    sourceId,
    enabled: true,
  });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState<Record<string, string>>({});

  if (isLoading) {
    return (
      <div className='flex items-center gap-2 text-xs text-muted-foreground py-1'>
        <Loader2 size={12} className='animate-spin' />
        Loading…
      </div>
    );
  }

  const visibleGroups = groups.filter(g => g.tags.length > 0 || g.configOptions);

  if (visibleGroups.length === 0) {
    return <div className='text-xs text-muted-foreground py-1'>No tags configured.</div>;
  }

  return (
    <div className='space-y-3'>
      {error && (
        <div className='text-[11px] text-red-500 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1'>
          {error}
        </div>
      )}

      {visibleGroups.map(group => {
        const opts = group.configOptions;
        const isManual = opts?.method === 'manual';
        const currentTags = group.tags.map(t => t.tag);
        const maxCount = opts?.maxCount;
        const atMax = maxCount !== null && maxCount !== undefined && currentTags.length >= maxCount;
        const availableToAdd = (opts?.allowedTags ?? []).filter(t => !currentTags.includes(t));
        const canAddMore = !atMax && (availableToAdd.length > 0 || opts?.isNewTagAllowed);
        const isDropdownOpen = openDropdown === group.category;

        return (
          <div key={group.category} className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <CategoryLabel name={group.category} color={group.color} />
              {maxCount !== null && maxCount !== undefined && (
                <span className='text-[9px] text-muted-foreground/70 tabular-nums'>
                  {currentTags.length}/{maxCount}
                </span>
              )}
            </div>

            {isManual && opts?.allowedTags && opts.allowedTags.length > 0 ? (
              <div className='flex flex-wrap gap-1 pl-3.5'>
                {opts.allowedTags.map(allowedTag => {
                  const isActive = currentTags.includes(allowedTag);
                  const key = `${group.category}:${allowedTag}`;
                  const isMutating = mutating.has(key);
                  const wouldExceedMax = !isActive && atMax;
                  return (
                    <Button
                      key={allowedTag}
                      variant='ghost'
                      type='button'
                      disabled={isMutating || wouldExceedMax}
                      trackId='toggle_tag'
                      data-track-category='Support'
                      data-track-name='ToggleTag'
                      onClick={() => {
                        void (isActive
                          ? removeTag(group.category, allowedTag)
                          : addTag(group.category, allowedTag));
                      }}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all',
                        'disabled:opacity-40 disabled:cursor-not-allowed',
                        isActive
                          ? 'text-white'
                          : 'text-muted-foreground bg-muted/50 hover:bg-muted border border-border',
                      )}
                      style={isActive ? { backgroundColor: safeColor(group.color) } : undefined}
                      title={wouldExceedMax ? `Max ${maxCount} tags` : undefined}
                    >
                      {isMutating ? <Loader2 size={9} className='animate-spin' /> : null}
                      {allowedTag}
                      {isActive && !isMutating && <X size={9} />}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className='pl-3.5 space-y-1.5'>
                {currentTags.length > 0 && (
                  <div className='flex flex-wrap gap-1'>
                    {group.tags.map(t => {
                      const key = `${group.category}:${t.tag}`;
                      const isMutating = mutating.has(key);
                      return (
                        <span
                          key={t.tag}
                          className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white'
                          style={{ backgroundColor: safeColor(group.color) }}
                        >
                          {t.tag}
                          <Button
                            variant='ghost'
                            type='button'
                            disabled={isMutating}
                            trackId='remove_tag'
                            data-track-category='Support'
                            data-track-name='RemoveTag'
                            onClick={() => {
                              void removeTag(group.category, t.tag);
                            }}
                            className='ml-0.5 opacity-70 hover:opacity-100 disabled:opacity-40'
                            aria-label={`Remove ${t.tag}`}
                          >
                            {isMutating ? (
                              <Loader2 size={9} className='animate-spin' />
                            ) : (
                              <X size={9} />
                            )}
                          </Button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {canAddMore && (
                  <div className='relative'>
                    <button
                      type='button'
                      data-track-category='Support'
                      data-track-name='OpenAddTag'
                      onClick={() => setOpenDropdown(isDropdownOpen ? null : group.category)}
                      className='inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors'
                    >
                      <Plus size={11} />
                      Add tag
                    </button>

                    {isDropdownOpen && (
                      <div className='absolute top-5 left-0 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px] max-h-48 overflow-y-auto'>
                        {availableToAdd.map(t => (
                          <Button
                            key={t}
                            variant='ghost'
                            type='button'
                            trackId='add_tag'
                            data-track-category='Support'
                            data-track-name='AddTag'
                            onClick={() => {
                              setOpenDropdown(null);
                              void addTag(group.category, t);
                            }}
                            className='w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors'
                          >
                            {t}
                          </Button>
                        ))}

                        {opts?.isNewTagAllowed && (
                          <div className='px-2 pt-1 pb-1.5 border-t border-border mt-1'>
                            <input
                              autoFocus
                              type='text'
                              placeholder='custom-tag'
                              data-track-category='Support'
                              data-track-name='AddCustomTag'
                              value={customInput[group.category] ?? ''}
                              onChange={e =>
                                setCustomInput(prev => ({
                                  ...prev,
                                  [group.category]: e.target.value,
                                }))
                              }
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const val = (customInput[group.category] ?? '')
                                    .trim()
                                    .toLowerCase()
                                    .replace(/\s+/g, '-');
                                  if (val) {
                                    setOpenDropdown(null);
                                    setCustomInput(prev => ({ ...prev, [group.category]: '' }));
                                    void addTag(group.category, val);
                                  }
                                }
                                if (e.key === 'Escape') setOpenDropdown(null);
                              }}
                              className='w-full text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-desk-accent font-mono'
                            />
                            <p className='text-[10px] text-muted-foreground mt-1'>Enter to add</p>
                          </div>
                        )}

                        {availableToAdd.length === 0 && !opts?.isNewTagAllowed && (
                          <div className='px-3 py-1.5 text-xs text-muted-foreground'>
                            No more options
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {currentTags.length === 0 && !canAddMore && (
                  <span className='text-[11px] text-muted-foreground/60 italic'>No tags</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── Generic entity badge (interactive editor popover) ───────────────────────

export const EntityTagsBadge = ({
  sourceType,
  sourceId,
}: {
  sourceType: string;
  sourceId: string;
}): JSX.Element => {
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type='button'
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      className='inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap'
      aria-label={open ? 'Hide tags' : 'Show tags'}
      data-track-category='Tags'
      data-track-name='ToggleTagsBadge'
    >
      <Tag size={11} className='shrink-0' />
      <span>Tags</span>
      <ChevronDown
        size={11}
        className={cn('opacity-60 transition-transform', open && 'rotate-180')}
      />
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      side='bottom'
      align='end'
      sideOffset={6}
      className='p-4 shadow-lg'
    >
      <div className='min-w-[16rem] max-w-[24rem]'>
        {open && <TagEditorContent sourceType={sourceType} sourceId={sourceId} />}
      </div>
    </Popover>
  );
};

// ─── Read-only popover shell (for TicketTagsBadge) ───────────────────────────

const TagsPopoverShell = ({
  groups,
  isLoading,
  open,
  onOpenChange,
  trigger,
}: {
  groups: TagGroup[];
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: JSX.Element;
}): JSX.Element => (
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

// ─── Read-only entity tags popover (for ticket right column etc.) ────────────

export const EntityTagsReadBadge = ({
  sourceType,
  sourceId,
}: {
  sourceType: string;
  sourceId: string;
}): JSX.Element => {
  const [open, setOpen] = useState(false);
  const { groups, isLoading } = useEntityTags(sourceType, sourceId, open);

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
    <TagsPopoverShell
      trigger={trigger}
      groups={groups}
      isLoading={isLoading}
      open={open}
      onOpenChange={setOpen}
    />
  );
};
