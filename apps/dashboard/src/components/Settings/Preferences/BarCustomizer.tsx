import { ReactElement, ReactNode, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { AppIcon } from '../../AppIcon/AppIcon';
import { SortableBarRow } from './SortableBarRow';
import { AppPickerDialog, type BarBuiltIn } from '../../BarCustomize';
import {
  type BarItemsStore,
  useAppSnapshots,
  setAppSnapshot,
  appItemId,
  appIdOf,
  MAX_APPS_PER_BAR,
} from '../../../hooks/barItems';

interface BarCustomizerProps {
  title: string;
  subtitle: string;
  store: BarItemsStore;
  /** Every built-in the user may show, in canonical order. */
  builtIns: readonly BarBuiltIn[];
  trackCategory: string;
  /** Rendered under the subtitle — the channel selector, for channel tabs. */
  headerSlot?: ReactNode;
}

/**
 * The customize screen shared by the toolbar, the Inbox menubar and the channel
 * tabs: an ordered "Shown" list (drag to reorder, × to remove), the built-ins
 * not yet shown, and a way to add an artifact app. Which bar is being edited is
 * entirely a matter of which store and built-ins it is handed.
 */
export const BarCustomizer = ({
  title,
  subtitle,
  store,
  builtIns,
  trackCategory,
  headerSlot,
}: BarCustomizerProps): ReactElement => {
  const ids = store.useItems();
  const snapshots = useAppSnapshots();
  const [pickerOpen, setPickerOpen] = useState(false);

  const builtInById = useMemo(() => new Map(builtIns.map(b => [b.id, b])), [builtIns]);

  // Only ids that resolve are drawn; a stale entry (an app whose snapshot is
  // gone, a built-in the user can no longer see) is invisible here just as it
  // is in the bar itself.
  const shown = useMemo(
    () =>
      ids.filter(id => {
        const appId = appIdOf(id);
        return appId ? snapshots.has(appId) : builtInById.has(id);
      }),
    [ids, snapshots, builtInById],
  );
  const available = useMemo(() => builtIns.filter(b => !ids.includes(b.id)), [builtIns, ids]);
  const addedAppIds = useMemo(
    () => new Set(ids.map(appIdOf).filter((id): id is string => id !== null)),
    [ids],
  );
  const appsFull = addedAppIds.size >= MAX_APPS_PER_BAR;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    // Indices in the full stored list, not the filtered view, so hidden
    // entries keep their place relative to their neighbours.
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    store.move(from, to);
  };

  const rowFor = (id: string): { icon: ReactNode; label: string; hint?: string } | null => {
    const appId = appIdOf(id);
    if (appId) {
      const snapshot = snapshots.get(appId);
      if (!snapshot) return null;
      return {
        icon: <AppIcon name={snapshot.icon} size={16} aria-hidden='true' />,
        label: snapshot.title,
        hint: 'App',
      };
    }
    const builtIn = builtInById.get(id);
    return builtIn ? { icon: builtIn.icon, label: builtIn.label } : null;
  };

  return (
    <div className='space-y-6'>
      <div>
        <p className='text-base font-semibold text-foreground'>{title}</p>
        <p className='mt-0.5 text-sm text-muted-foreground'>{subtitle}</p>
        {headerSlot && <div className='mt-3'>{headerSlot}</div>}
      </div>

      <section className='space-y-2'>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Shown</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={shown} strategy={verticalListSortingStrategy}>
            <div className='flex flex-col gap-1.5'>
              {shown.map(id => {
                const row = rowFor(id);
                if (!row) return null;
                return (
                  <SortableBarRow
                    key={id}
                    id={id}
                    icon={row.icon}
                    label={row.label}
                    hint={row.hint}
                    locked={store.locked.includes(id)}
                    onRemove={() => store.remove(id)}
                    trackCategory={trackCategory}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      {available.length > 0 && (
        <section className='space-y-2'>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Available
          </p>
          <div className='flex flex-col gap-1.5'>
            {available.map(item => (
              <div
                key={item.id}
                className='flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2 pr-3'
              >
                <div className='flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground'>
                  {item.icon}
                </div>
                <p className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
                  {item.label}
                </p>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => store.add(item.id)}
                  data-track-category={trackCategory}
                  data-track-name='AddBarItem'
                  data-track-metadata={JSON.stringify({ id: item.id })}
                >
                  <Plus className='size-4' />
                  Add
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className='space-y-2'>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Apps</p>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setPickerOpen(true)}
          data-track-category={trackCategory}
          data-track-name='OpenAppPicker'
        >
          <Plus className='size-4' />
          Add app
        </Button>
        <p className='text-xs text-muted-foreground'>
          Apps you saved from an AI chat, or that were published to this workspace. Up to{' '}
          {MAX_APPS_PER_BAR} per bar.
        </p>
      </section>

      <AppPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        addedAppIds={addedAppIds}
        isFull={appsFull}
        onToggle={(app, next) => {
          if (!next) {
            store.remove(appItemId(app.id));
            return;
          }
          setAppSnapshot(app.id, { title: app.title, icon: app.icon });
          store.add(appItemId(app.id));
        }}
        trackCategory={trackCategory}
      />
    </div>
  );
};
