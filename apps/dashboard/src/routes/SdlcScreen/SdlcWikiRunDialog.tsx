import { useState, type CSSProperties, type ReactElement } from 'react';
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragableSixDots } from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { cn } from '../../utils/classNames';
import { sdlcErrorMessage } from './SdlcRegisterRepositoryForm';

// Must match COMMITS_PER_WINDOW in the backend Plan step, which rejects anything else.
const COMMITS_PER_WINDOW = [1, 5, 10, 20] as const;

export interface WikiRunInput {
  repoIds: string[];
  commitsPerRun: number;
}

interface Row {
  id: string;
  name: string;
  checked: boolean;
}

function RepositoryRow(props: { row: Row; onToggle: (checked: boolean) => void }): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.row.id,
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex h-10 items-center gap-2 rounded-lg border bg-card px-2',
        isDragging && 'relative z-10 opacity-70 shadow-md',
      )}
    >
      <button
        type='button'
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${props.row.name}`}
        className='flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground outline-none active:cursor-grabbing focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
      >
        <DragableSixDots className='size-4' />
      </button>
      <Checkbox
        checked={props.row.checked}
        onChange={props.onToggle}
        label={props.row.name}
        size='sm'
        truncateLabel
      />
    </li>
  );
}

/** Start or refresh the Wiki: which repositories, in which order, and how many commits per window. */
export function SdlcWikiRunDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositories: ReadonlyArray<{ id: string; name: string }>;
  onRun: (input: WikiRunInput) => Promise<void>;
}): ReactElement {
  const { open, repositories } = props;
  const [rows, setRows] = useState<Row[]>([]);
  const [commitsPerRun, setCommitsPerRun] = useState(10);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  // Seed only as it opens: the hub's repositories refresh while it is open, and must not undo the edits.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRows(repositories.map(repository => ({ ...repository, checked: true })));
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const chosen = rows.filter(row => row.checked).map(row => row.id);

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    setRows(current =>
      arrayMove(
        current,
        current.findIndex(row => row.id === active.id),
        current.findIndex(row => row.id === over.id),
      ),
    );
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      await props.onRun({ repoIds: chosen, commitsPerRun });
      props.onOpenChange(false);
    } catch (error) {
      toast.error(sdlcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange} title='Run deep research'>
      <div className='flex flex-col'>
        <div className='px-6 pt-6'>
          <h2 className='text-lg font-semibold tracking-tight'>Run deep research</h2>
          <p className='mt-1 text-sm leading-6 text-muted-foreground'>
            Repositories run one at a time, top first. Each picks up after the last commit it
            documented.
          </p>
        </div>
        <div className='flex flex-col gap-4 px-6 py-5'>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={rows.map(row => row.id)} strategy={verticalListSortingStrategy}>
              <ul className='flex flex-col gap-2' aria-label='Repositories, in run order'>
                {rows.map(row => (
                  <RepositoryRow
                    key={row.id}
                    row={row}
                    onToggle={checked =>
                      setRows(current =>
                        current.map(other => (other.id === row.id ? { ...other, checked } : other)),
                      )
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className='flex items-center justify-between gap-4 text-sm'>
            <span>
              Commits per window
              <span className='block text-xs text-muted-foreground'>
                Smaller windows give the agent smaller changes to explain.
              </span>
            </span>
            <Select
              value={String(commitsPerRun)}
              onValueChange={value => setCommitsPerRun(Number(value))}
            >
              <SelectTrigger className='w-24' aria-label='Commits per window'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMITS_PER_WINDOW.map(value => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className='flex justify-end gap-2 border-t border-border px-6 py-3.5'>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            data-track-category='SdlcHub'
            data-track-name='WikiRunDialogCancelled'
          >
            Cancel
          </Button>
          <Button
            type='button'
            loading={busy}
            disabled={busy || chosen.length === 0}
            onClick={() => void run()}
            data-track-category='SdlcHub'
            data-track-name='HubWorkflowRunStarted'
            data-track-metadata={JSON.stringify({
              label: 'Deep research',
              repositories: chosen.length,
              commitsPerRun,
            })}
          >
            Run
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
