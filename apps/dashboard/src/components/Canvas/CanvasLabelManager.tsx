import type { KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import Input from '../ui/Input';
import { Popover } from '../ui/Popover';
import { cn } from '../../utils/classNames';
import { canvasLabelsApi } from '../../api/canvasLabelsApi';
import type { Canvas } from './Canvas.types';
import {
  type CanvasLabelChip,
  getCanvasLabelDotClassName,
  getCanvasLabelKey,
  getCanvasLabels,
  getDedupedCanvasLabelNames,
  normalizeCanvasLabelName,
} from './canvasLabelUtils';
import { notifyCanvasLabelsChanged } from './useCanvasLabels';

interface CanvasLabelManagerProps {
  canvas: Canvas;
  workspaceId?: string | undefined;
  canEdit: boolean;
  revealTriggerOnParentHover?: boolean;
}

export const CanvasLabelManager = ({
  canvas,
  workspaceId,
  canEdit,
  revealTriggerOnParentHover = false,
}: CanvasLabelManagerProps): ReactElement | null => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingLabelKey, setPendingLabelKey] = useState<string | null>(null);
  const [labels, setLabels] = useState<CanvasLabelChip[]>(() => getCanvasLabels(canvas));
  const [workspaceLabelNames, setWorkspaceLabelNames] = useState<string[]>([]);
  const appliedLabelKeys = useMemo(
    () =>
      new Set<string>(
        labels.flatMap(label => {
          const key = getCanvasLabelKey(label.name);
          return key ? [key] : [];
        }),
      ),
    [labels],
  );

  useEffect(() => {
    let cancelled = false;
    setLabels(getCanvasLabels(canvas));

    if (!canvas.id || canvas.id === 'new') {
      return () => {
        cancelled = true;
      };
    }

    canvasLabelsApi
      .getCanvasLabels([canvas.id])
      .then(labelsByCanvasId => {
        if (!cancelled) {
          setLabels(labelsByCanvasId[canvas.id] ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLabels(getCanvasLabels(canvas));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvas]);

  useEffect(() => {
    if (!pickerOpen) return;

    let cancelled = false;
    canvasLabelsApi
      .getCanvasLabelSuggestions(search)
      .then(names => {
        if (!cancelled) {
          setWorkspaceLabelNames(names);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceLabelNames([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pickerOpen, search, workspaceId]);

  const labelOptionNames = useMemo(
    () =>
      getDedupedCanvasLabelNames([...labels, ...workspaceLabelNames]).sort((a, b) =>
        a.localeCompare(b),
      ),
    [labels, workspaceLabelNames],
  );

  const normalizedSearch = normalizeCanvasLabelName(search);
  const searchKey = getCanvasLabelKey(search) ?? '';
  const filteredLabelOptionNames = useMemo(
    () =>
      labelOptionNames.filter(name => {
        const key = getCanvasLabelKey(name);
        return key ? !searchKey || key.includes(searchKey) : false;
      }),
    [labelOptionNames, searchKey],
  );
  const matchingLabelName = searchKey
    ? labelOptionNames.find(name => getCanvasLabelKey(name) === searchKey)
    : undefined;
  const matchingLabelKey = matchingLabelName ? getCanvasLabelKey(matchingLabelName) : null;
  const canCreateLabel = Boolean(normalizedSearch && searchKey && !matchingLabelName);

  useEffect(() => {
    if (!pickerOpen) {
      setSearch('');
      return;
    }
    inputRef.current?.focus();
  }, [pickerOpen]);

  const handleAddLabel = useCallback(
    async (labelName: string): Promise<void> => {
      const normalized = normalizeCanvasLabelName(labelName);
      const labelKey = getCanvasLabelKey(normalized);
      if (!normalized || !labelKey || appliedLabelKeys.has(labelKey)) {
        return;
      }

      const pendingKey = `add:${labelKey}`;
      setPendingLabelKey(pendingKey);
      try {
        const label = await canvasLabelsApi.addCanvasLabel(canvas.id, normalized);
        setLabels(previous => {
          if (previous.some(existing => getCanvasLabelKey(existing.name) === labelKey)) {
            return previous;
          }
          return [...previous, label].sort((a, b) => a.name.localeCompare(b.name));
        });
        notifyCanvasLabelsChanged(canvas.id);
        setSearch('');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to add label');
      } finally {
        setPendingLabelKey(current => (current === pendingKey ? null : current));
      }
    },
    [appliedLabelKeys, canvas.id],
  );

  const handleRemoveLabel = useCallback(
    async (labelId: string): Promise<void> => {
      const pendingKey = `remove:${labelId}`;
      setPendingLabelKey(pendingKey);
      // Capture the label itself (not the full list) so rollback can re-insert
      // only this specific label into whatever current state is at that time.
      const removedLabel = labels.find(label => label.id === labelId);
      setLabels(current => current.filter(label => label.id !== labelId));
      try {
        await canvasLabelsApi.removeCanvasLabel(canvas.id, labelId);
        notifyCanvasLabelsChanged(canvas.id);
      } catch (error) {
        if (removedLabel) {
          setLabels(current => {
            if (current.some(label => label.id === labelId)) return current;
            return [...current, removedLabel].sort((a, b) => a.name.localeCompare(b.name));
          });
        }
        toast.error(error instanceof Error ? error.message : 'Failed to remove label');
      } finally {
        setPendingLabelKey(current => (current === pendingKey ? null : current));
      }
    },
    [canvas.id, labels],
  );

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const firstAddableName = filteredLabelOptionNames.find(name => {
      const key = getCanvasLabelKey(name);
      return key ? !appliedLabelKeys.has(key) : false;
    });
    const labelToAdd =
      (matchingLabelName && matchingLabelKey && !appliedLabelKeys.has(matchingLabelKey)
        ? matchingLabelName
        : undefined) ??
      (canCreateLabel ? normalizedSearch : undefined) ??
      firstAddableName;
    if (labelToAdd) {
      void handleAddLabel(labelToAdd);
    }
  };

  if (!canEdit && labels.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5',
        revealTriggerOnParentHover && labels.length === 0 && !pickerOpen && 'mt-2 h-6',
        revealTriggerOnParentHover && (labels.length > 0 || pickerOpen) && 'mt-2',
      )}
    >
      {labels.map(label => {
        const isRemoving = pendingLabelKey === `remove:${label.id}`;
        return (
          <span
            key={label.id}
            className='inline-flex h-6 max-w-[160px] items-center gap-1 rounded-md border border-border bg-muted px-1.5 text-xs text-muted-foreground'
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${getCanvasLabelDotClassName(label.name)}`}
            />
            <span className='truncate'>{label.name}</span>
            {canEdit && (
              <button
                type='button'
                className='ml-0.5 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
                title='Remove label'
                aria-label={`Remove ${label.name}`}
                disabled={isRemoving}
                onClick={() => void handleRemoveLabel(label.id)}
                data-track-category='CANVAS'
                data-track-name='REMOVE_CANVAS_LABEL'
                data-track-metadata={JSON.stringify({
                  canvasId: canvas.id,
                  labelId: label.id,
                  label: label.name,
                })}
              >
                {isRemoving ? <Loader2 size={11} className='animate-spin' /> : <X size={11} />}
              </button>
            )}
          </span>
        );
      })}

      {canEdit && (
        <Popover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          align='start'
          side='bottom'
          sideOffset={6}
          className='w-[262px] rounded-xl p-2 shadow-xl'
          trigger={
            <button
              type='button'
              className={cn(
                'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-border bg-background px-2 text-xs font-medium text-muted-foreground transition-all duration-150 hover:border-muted-foreground/40 hover:bg-accent hover:text-foreground',
                revealTriggerOnParentHover &&
                  !pickerOpen &&
                  'pointer-events-none opacity-0 group-hover/canvas-editor-title:pointer-events-auto group-hover/canvas-editor-title:opacity-100',
                pickerOpen && 'opacity-100',
              )}
              aria-label='Add label'
              tabIndex={revealTriggerOnParentHover && !pickerOpen ? -1 : undefined}
              data-testid='canvas-label-manager-trigger'
            >
              <Plus size={12} />
              <span>Add label</span>
            </button>
          }
        >
          <div className='flex max-h-[320px] flex-col'>
            <div className='relative'>
              <Search
                size={14}
                className='pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground'
              />
              <Input
                ref={inputRef}
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder='Search or create a label.'
                className='h-8 rounded-lg bg-muted/40 pl-8 pr-2 text-xs'
              />
            </div>

            <div className='mt-2 flex max-h-[260px] flex-col gap-0.5 overflow-y-auto pr-1'>
              {canCreateLabel && normalizedSearch && (
                <button
                  type='button'
                  className='flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent'
                  disabled={Boolean(pendingLabelKey)}
                  onClick={() => void handleAddLabel(normalizedSearch)}
                  data-track-category='CANVAS'
                  data-track-name='CREATE_CANVAS_LABEL'
                  data-track-metadata={JSON.stringify({
                    canvasId: canvas.id,
                    label: normalizedSearch,
                  })}
                >
                  <Plus size={14} className='shrink-0 text-muted-foreground' />
                  <span className='min-w-0 flex-1 truncate'>
                    Create &quot;{normalizedSearch}&quot;
                  </span>
                </button>
              )}

              {filteredLabelOptionNames.map(name => {
                const labelKey = getCanvasLabelKey(name) ?? name.toLowerCase();
                const pendingKey = `add:${labelKey}`;
                const isAdding = pendingLabelKey === pendingKey;
                const isApplied = appliedLabelKeys.has(labelKey);

                return (
                  <button
                    key={name}
                    type='button'
                    className={cn(
                      'flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
                      isApplied ? 'cursor-default' : 'hover:bg-accent',
                      Boolean(pendingLabelKey) && 'disabled:opacity-60',
                    )}
                    disabled={Boolean(pendingLabelKey) || isApplied}
                    onClick={() => void handleAddLabel(name)}
                    aria-label={isApplied ? `${name} already added` : `Add ${name}`}
                    data-track-category='CANVAS'
                    data-track-name='ADD_CANVAS_LABEL'
                    data-track-metadata={JSON.stringify({ canvasId: canvas.id, label: name })}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${getCanvasLabelDotClassName(name)}`}
                    />
                    <span className='min-w-0 flex-1 truncate'>{name}</span>
                    {isAdding && (
                      <Loader2 size={14} className='shrink-0 animate-spin text-muted-foreground' />
                    )}
                  </button>
                );
              })}

              {filteredLabelOptionNames.length === 0 && !canCreateLabel && (
                <div className='px-2 py-1.5 text-sm text-muted-foreground'>No labels</div>
              )}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
};
