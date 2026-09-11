import { useState, useEffect, useRef, type ReactElement, type CSSProperties } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import { SavedConfigVisibility } from '@xyne/shared';
import {
  BookmarkDefault as Bookmark,
  Globe,
  LockClose as Lock,
  DeleteDustbin01 as Trash,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from '@xyne/icons';
import { cn } from '../../utils/classNames';
import { Switch } from '../ui/Switch';
import Dialog from '../ui/Dialog';
import { valuesToFilters } from '../../utils/savedViewSerialization';
import type { DeskTicketSavedView } from '../../hooks/useDeskTicketSavedViews';
import type { TicketFilters } from '../Tickets/TicketFilters/types';
import type { ResolvedDisplayFormField } from '../../utils/board/resolveDisplayFormFields';

interface DeskSavedViewsControlsProps {
  savedViews: DeskTicketSavedView[];
  activeViewId: string | null;
  onActiveViewChange: (id: string | null) => void;
  currentUserId: string;
  isChannelAdmin: boolean;
  onApply: (view: DeskTicketSavedView) => void;
  onSave: (name: string, visibility: SavedConfigVisibility) => Promise<string | undefined>;
  onUpdate: (viewId: string) => Promise<void>;
  onDelete: (viewId: string) => Promise<void>;
  currentFilters: TicketFilters;
  dynamicFieldDefs?: ResolvedDisplayFormField[];
  trackCategory?: string;
}

interface FilterRow {
  label: string;
  values: string[];
}

function buildFilterRows(
  values: DeskTicketSavedView['values'],
  fieldDefs?: ResolvedDisplayFormField[],
): FilterRow[] {
  if (!values || values.length === 0) return [];
  const f = valuesToFilters(values);
  const rows: FilterRow[] = [];
  if (f.priority?.length) rows.push({ label: 'Priority', values: f.priority });
  if (f.stages?.length) rows.push({ label: 'Stage', values: f.stages });
  if (f.assignee?.length)
    rows.push({ label: 'Assignee', values: [`${f.assignee.length} selected`] });
  if (f.assigned !== undefined)
    rows.push({ label: 'Assigned', values: [f.assigned ? 'Yes' : 'No'] });
  if (f.aiCategory?.length) rows.push({ label: 'AI Category', values: f.aiCategory });
  if (f.hasAiDraft !== undefined)
    rows.push({ label: 'Has AI Draft', values: [f.hasAiDraft ? 'Yes' : 'No'] });
  if (f.hasSubTickets !== undefined)
    rows.push({ label: 'Has Sub-tickets', values: [f.hasSubTickets ? 'Yes' : 'No'] });
  if (f.generatedTags?.length)
    rows.push({
      label: 'Tags',
      values: f.generatedTags.map(t => {
        const [cat, tag] = t.split(':');
        return tag ? `${cat}: ${tag}` : t;
      }),
    });
  if (f.conversationLabelId) rows.push({ label: 'Label', values: ['Set'] });
  if (f.lastEmailAtStart !== undefined || f.lastEmailAtEnd !== undefined)
    rows.push({ label: 'Last Email', values: ['Date range'] });
  if (f.dueDateStart !== undefined || f.dueDateEnd !== undefined)
    rows.push({ label: 'Due Date', values: ['Date range'] });
  if (f.createdDateStart !== undefined || f.createdDateEnd !== undefined)
    rows.push({ label: 'Created', values: ['Date range'] });
  if (f.dynamicFields) {
    for (const [fieldId, val] of Object.entries(f.dynamicFields)) {
      const def = fieldDefs?.find(d => d.id === fieldId);
      const label = def?.fieldName ?? `Custom: ${fieldId.slice(0, 8)}`;
      if (Array.isArray(val)) {
        rows.push({ label, values: val });
      } else {
        rows.push({ label, values: ['Date range'] });
      }
    }
  }
  return rows;
}

function FilterPreviewCard({
  view,
  style,
  fieldDefs,
}: {
  view: DeskTicketSavedView;
  style: CSSProperties;
  fieldDefs?: ResolvedDisplayFormField[];
}): ReactElement {
  const rows = buildFilterRows(view.values, fieldDefs);
  const isPublic = view.visibility === (SavedConfigVisibility.PUBLIC as string);

  return (
    <div
      style={style}
      className='absolute z-[80] w-52 bg-popover border border-border rounded-xl shadow-xl py-3 pointer-events-none'
    >
      {/* Header */}
      <div className='flex items-center gap-1.5 px-3 pb-2 border-b border-border'>
        {isPublic ? (
          <Globe size={11} className='shrink-0 text-muted-foreground' />
        ) : (
          <Lock size={11} className='shrink-0 text-muted-foreground' />
        )}
        <span className='text-xs font-semibold text-foreground truncate'>{view.name}</span>
      </div>
      {/* Filter rows */}
      <div className='flex flex-col gap-1.5 px-3 pt-2'>
        {rows.length === 0 ? (
          <p className='text-xs text-muted-foreground'>No filters</p>
        ) : (
          rows.map(row => (
            <div key={row.label} className='flex flex-col gap-0.5'>
              <span className='text-[10px] font-medium text-muted-foreground uppercase tracking-wide'>
                {row.label}
              </span>
              <div className='flex flex-wrap gap-1'>
                {row.values.map(v => (
                  <span
                    key={v}
                    className='text-xs px-1.5 py-0.5 rounded-md bg-muted text-foreground'
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Recursively sort object keys so JSON.stringify gives a stable result regardless of insertion order. */
function sortKeysDeep(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortKeysDeep);
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.keys(val as Record<string, unknown>)
        .sort()
        .map(k => [k, sortKeysDeep((val as Record<string, unknown>)[k])]),
    );
  }
  return val;
}

/** Stable signature for dirty-state comparison — handles nested objects like dynamicFields. */
function filtersSignature(filters: TicketFilters): string {
  return JSON.stringify(sortKeysDeep(filters));
}

export function DeskSavedViewsControls({
  savedViews,
  activeViewId,
  onActiveViewChange,
  currentUserId,
  isChannelAdmin,
  onApply,
  onSave,
  onUpdate,
  onDelete,
  currentFilters,
  dynamicFieldDefs,
  trackCategory = 'Support',
}: DeskSavedViewsControlsProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [viewToDelete, setViewToDelete] = useState<DeskTicketSavedView | null>(null);
  const [showViewsList, setShowViewsList] = useState(true);
  const [hoverPos, setHoverPos] = useState<{ viewId: string; top: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const activeView = savedViews.find(v => v.id === activeViewId) ?? null;
  const isOwnActiveView = activeView?.userId === currentUserId;

  // Dirty: current filters differ from what the active view has stored
  const isDirty = (() => {
    if (!activeView?.values) return false;
    const viewFilters = valuesToFilters(activeView.values);
    return filtersSignature(currentFilters) !== filtersSignature(viewFilters);
  })();

  // Reset inner state when popover closes
  useEffect(() => {
    if (!open) {
      setSaveViewName('');
      setIsPublic(false);
      setSaveError('');
      setShowUpdateConfirm(false);
      setShowSaveForm(false);
      setShowViewsList(true);
      // Clear stale hover so it doesn't show on next open without moving the cursor
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setHoverPos(null);
    }
  }, [open]);

  const hasFilters = Object.keys(currentFilters).some(k => {
    const v = currentFilters[k as keyof TicketFilters];
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object' && v !== null) return Object.keys(v).length > 0;
    return v !== undefined && v !== null;
  });

  // Auto-collapse views list when a banner/form or the "save filters" entry takes focus
  const hasBanner = (activeView !== null && isDirty) || showSaveForm || (!activeView && hasFilters);
  useEffect(() => {
    if (hasBanner) setShowViewsList(false);
  }, [hasBanner]);

  const handleApply = (view: DeskTicketSavedView): void => {
    onApply(view);
    onActiveViewChange(view.id);
    setOpen(false);
  };

  const handleSave = async (): Promise<void> => {
    const name = saveViewName.trim();
    if (!name) return;
    setSaveLoading(true);
    setSaveError('');
    try {
      const id = await onSave(
        name,
        isPublic ? SavedConfigVisibility.PUBLIC : SavedConfigVisibility.PRIVATE,
      );
      if (id) {
        onActiveViewChange(id);
        toast.success(`View "${name}" saved`);
      }
      setOpen(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save view');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdate = async (): Promise<void> => {
    if (!activeViewId) return;
    setUpdateLoading(true);
    try {
      await onUpdate(activeViewId);
      toast.success(`View "${activeView?.name ?? ''}" updated`);
      setShowUpdateConfirm(false);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update view');
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!viewToDelete) return;
    try {
      await onDelete(viewToDelete.id);
      if (activeViewId === viewToDelete.id) onActiveViewChange(null);
      toast.success(`View "${viewToDelete.name}" deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete view');
    } finally {
      setViewToDelete(null);
    }
  };

  const handleHoverEnter = (id: string, el: HTMLElement): void => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (!contentRef.current) return;
      const rowRect = el.getBoundingClientRect();
      const containerRect = contentRef.current.getBoundingClientRect();
      setHoverPos({ viewId: id, top: rowRect.top - containerRect.top });
    }, 200);
  };

  const handleHoverLeave = (): void => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverPos(null);
  };

  return (
    <div className='flex items-center gap-2'>
      {/* Active view pill */}
      {activeView && (
        <div className='flex items-center gap-1.5 px-2 h-8 rounded-lg border-2 border-border bg-muted text-foreground text-sm font-medium max-w-[220px]'>
          {activeView.visibility === (SavedConfigVisibility.PUBLIC as string) ? (
            <Globe size={11} className='shrink-0 text-muted-foreground' />
          ) : (
            <Lock size={11} className='shrink-0 text-muted-foreground' />
          )}
          <span className='truncate'>{activeView.name}</span>
          <span className='shrink-0 text-[11px] text-muted-foreground font-normal'>
            (
            {activeView.visibility === (SavedConfigVisibility.PUBLIC as string)
              ? 'Public'
              : 'Private'}
            )
          </span>
          <button
            onClick={() => onActiveViewChange(null)}
            className='flex-shrink-0 ml-0.5 rounded hover:bg-foreground/10 p-0.5 transition-colors text-muted-foreground hover:text-foreground'
            title='Exit view'
            data-track-category={trackCategory}
            data-track-name='ExitDeskView'
          >
            ×
          </button>
        </div>
      )}

      {/* Main Views popover */}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            className={cn(
              'flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-lg border border-border transition-colors',
              open || activeView
                ? 'bg-muted text-foreground'
                : hasFilters
                  ? 'bg-muted text-foreground font-medium border-foreground/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            data-track-category={trackCategory}
            data-track-name='OpenDeskViewsPopover'
          >
            <Bookmark size={14} />
            <span>Views{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</span>
            {(isDirty || (!activeView && hasFilters)) && (
              <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
            )}
          </button>
        </Popover.Trigger>

        <Popover.Content
          side='bottom'
          align='end'
          sideOffset={6}
          ref={contentRef}
          className='z-[60] w-80 bg-popover border border-border rounded-xl shadow-lg flex flex-col relative'
        >
          {/* Dirty-state banner — non-owner edited a public view */}
          {activeView && !isOwnActiveView && isDirty && !showSaveForm && (
            <div className='px-4 pt-4 pb-3 border-b border-border bg-muted/60'>
              <p className='text-xs text-muted-foreground mb-2'>
                You&apos;ve modified{' '}
                <span className='font-medium text-foreground'>&quot;{activeView.name}&quot;</span> —
                save a copy?
              </p>
              <button
                onClick={() => setShowSaveForm(true)}
                data-track-category={trackCategory}
                data-track-name='StartSaveAsFromPublicDeskView'
                className='text-xs font-semibold px-3 h-7 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors'
              >
                Save as new view
              </button>
            </div>
          )}

          {/* Dirty-state banner — own view + filters changed */}
          {activeView && isOwnActiveView && isDirty && !showSaveForm && (
            <div className='px-4 pt-4 pb-3 border-b border-border bg-muted/60'>
              <p className='text-xs text-muted-foreground mb-2'>
                Unsaved changes to{' '}
                <span className='font-medium text-foreground'>&quot;{activeView.name}&quot;</span>
              </p>
              {showUpdateConfirm ? (
                <div className='flex flex-col gap-2'>
                  <p className='text-xs text-muted-foreground'>
                    Save your filter changes back to this view?
                  </p>
                  <div className='flex items-center gap-2'>
                    <button
                      onClick={() => void handleUpdate()}
                      disabled={updateLoading}
                      data-track-category={trackCategory}
                      data-track-name='ConfirmUpdateDeskView'
                      className='text-xs font-semibold px-3 h-7 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors'
                    >
                      {updateLoading ? 'Saving…' : 'Yes, update'}
                    </button>
                    <button
                      onClick={() => setShowUpdateConfirm(false)}
                      data-track-category={trackCategory}
                      data-track-name='CancelUpdateDeskView'
                      className='text-xs font-medium px-2 h-7 text-muted-foreground hover:text-foreground transition-colors'
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => setShowUpdateConfirm(true)}
                    data-track-category={trackCategory}
                    data-track-name='StartUpdateDeskView'
                    className='text-xs font-medium px-3 h-7 rounded-md border border-border bg-background hover:bg-muted transition-colors'
                  >
                    Update view
                  </button>
                  <button
                    onClick={() => setShowSaveForm(true)}
                    data-track-category={trackCategory}
                    data-track-name='StartSaveNewDeskView'
                    className='text-xs font-medium px-3 h-7 rounded-md border border-border bg-background hover:bg-muted transition-colors'
                  >
                    Save as new
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Save new view form — only when explicitly opened */}
          {showSaveForm && !showUpdateConfirm && (
            <div className='px-4 pt-4 pb-3 border-b border-border flex flex-col gap-2'>
              <span className='text-[13px] font-medium text-foreground'>Save as new view</span>
              <input
                autoFocus
                type='text'
                placeholder='e.g. Open urgent bugs'
                value={saveViewName}
                onChange={e => {
                  setSaveViewName(e.target.value);
                  setSaveError('');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && saveViewName.trim()) void handleSave();
                }}
                data-track-category={trackCategory}
                data-track-name='DeskSaveViewNameInput'
                className='h-8 px-2 rounded-md border border-input bg-background text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50'
              />
              {saveError && <p className='text-xs text-destructive'>{saveError}</p>}
              {isChannelAdmin && (
                <Switch
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  label={isPublic ? 'Visible to everyone in this channel' : 'Only visible to you'}
                  id='desk-save-view-public-toggle'
                />
              )}
              <div className='flex justify-end gap-2 pt-1'>
                <button
                  onClick={() => {
                    setShowSaveForm(false);
                    setSaveViewName('');
                    setSaveError('');
                  }}
                  data-track-category={trackCategory}
                  data-track-name='CancelDeskSaveView'
                  className='text-[13px] font-medium text-muted-foreground px-2 h-7 hover:text-foreground'
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={!saveViewName.trim() || saveLoading}
                  data-track-category={trackCategory}
                  data-track-name='ConfirmDeskSaveView'
                  className='text-[13px] font-semibold px-4 h-7 rounded-md bg-secondary text-secondary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-secondary/80 transition-colors'
                >
                  {saveLoading ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* Save view entry point — no active view + filters exist */}
          {!activeView && !showSaveForm && hasFilters && (
            <div className='px-3 py-2.5 border-b border-border'>
              <button
                type='button'
                onClick={() => setShowSaveForm(true)}
                data-track-category={trackCategory}
                data-track-name='OpenDeskSaveViewForm'
                className='w-full flex items-center justify-between gap-2 px-3 h-9 rounded-lg border border-dashed border-border bg-muted/40 hover:bg-muted hover:border-border/80 transition-colors group'
              >
                <div className='flex items-center gap-2'>
                  <Bookmark size={13} className='text-muted-foreground shrink-0' />
                  <span className='text-[13px] font-medium text-foreground'>
                    Save current filters as a view
                  </span>
                </div>
                <ArrowRight
                  size={13}
                  className='text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform'
                />
              </button>
            </div>
          )}

          {/* Views list header — always visible, acts as collapse toggle when a banner/form is active */}
          {savedViews.length > 0 && (
            <button
              type='button'
              onClick={() => setShowViewsList(v => !v)}
              data-track-category={trackCategory}
              data-track-name='ToggleDeskViewsList'
              className='flex items-center justify-between w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-b border-border'
            >
              <span>Saved views ({savedViews.length})</span>
              {showViewsList ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}

          {/* Views list */}
          {savedViews.length === 0 ? (
            <p className='text-sm text-muted-foreground px-4 py-3'>No saved views yet</p>
          ) : (
            showViewsList && (
              <div className='flex flex-col py-1 max-h-56 overflow-y-auto overflow-x-visible'>
                {savedViews.map(view => {
                  const isOwn = view.userId === currentUserId;
                  const isPublicView = view.visibility === (SavedConfigVisibility.PUBLIC as string);
                  const isActive = view.id === activeViewId;

                  return (
                    <div
                      key={view.id}
                      role='button'
                      tabIndex={0}
                      className={cn(
                        'group flex items-center w-full cursor-pointer px-4 py-2 hover:bg-muted transition-colors',
                        isActive && 'bg-accent',
                      )}
                      onClick={() => handleApply(view)}
                      onMouseEnter={e => handleHoverEnter(view.id, e.currentTarget)}
                      onMouseLeave={handleHoverLeave}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') handleApply(view);
                      }}
                      data-track-category={trackCategory}
                      data-track-name='ApplyDeskSavedView'
                    >
                      <div className='flex items-center gap-1.5 min-w-0 flex-1'>
                        {isPublicView ? (
                          <Globe size={12} className='shrink-0 text-muted-foreground' />
                        ) : (
                          <Lock size={12} className='shrink-0 text-muted-foreground' />
                        )}
                        <span
                          className={cn(
                            'text-sm truncate',
                            isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {view.name}
                        </span>
                        {!isOwn && (
                          <span className='text-xs text-muted-foreground shrink-0'>· others</span>
                        )}
                      </div>
                      {isOwn && (
                        <button
                          type='button'
                          onClick={e => {
                            e.stopPropagation();
                            setViewToDelete(view);
                          }}
                          className='ml-2 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0 opacity-0 group-hover:opacity-100'
                          title='Delete view'
                          data-track-category={trackCategory}
                          data-track-name='OpenDeleteDeskViewDialog'
                          tabIndex={-1}
                        >
                          <Trash size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Floating filter preview card — shown to the left of the popover on row hover */}
          {hoverPos &&
            (() => {
              const view = savedViews.find(v => v.id === hoverPos.viewId);
              if (!view) return null;
              return (
                <FilterPreviewCard
                  view={view}
                  style={{ right: 'calc(100% + 8px)', top: hoverPos.top }}
                  {...(dynamicFieldDefs ? { fieldDefs: dynamicFieldDefs } : {})}
                />
              );
            })()}
        </Popover.Content>
      </Popover.Root>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!viewToDelete}
        onOpenChange={open => {
          if (!open) setViewToDelete(null);
        }}
        title='Delete saved view'
        zIndexClassName='z-[70]'
        className='max-w-sm'
      >
        {viewToDelete && (
          <div className='flex flex-col'>
            <div className='flex items-start gap-4 px-6 pt-6 pb-5'>
              <div className='flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10'>
                <AlertTriangle size={20} className='text-destructive' />
              </div>
              <div className='flex flex-col gap-1 min-w-0'>
                <h3 className='text-base font-semibold text-foreground'>Delete saved view</h3>
                <p className='text-sm text-muted-foreground'>
                  <span className='font-medium text-foreground'>
                    &quot;{viewToDelete.name}&quot;
                  </span>{' '}
                  will be permanently removed. This cannot be undone.
                </p>
              </div>
            </div>
            {viewToDelete.visibility === (SavedConfigVisibility.PUBLIC as string) && (
              <div className='mx-6 mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3'>
                <Globe size={14} className='mt-0.5 shrink-0 text-destructive' />
                <p className='text-sm text-destructive'>
                  This is a shared team view. Deleting it removes it for everyone in this channel.
                </p>
              </div>
            )}
            <div className='flex items-center justify-end gap-3 border-t border-border px-6 py-4'>
              <button
                onClick={() => setViewToDelete(null)}
                data-track-category={trackCategory}
                data-track-name='CancelDeleteDeskView'
                className='text-sm font-medium h-9 px-4 rounded-lg border border-border hover:bg-muted transition-colors'
              >
                Keep view
              </button>
              <button
                onClick={() => void handleDeleteConfirm()}
                data-track-category={trackCategory}
                data-track-name='ConfirmDeleteDeskView'
                className='text-sm font-semibold h-9 px-4 rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors'
              >
                Delete view
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
