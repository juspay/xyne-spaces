import { ReactElement, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Tag, Plus, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';

/**
 * Gmail-style "Labels" section for the desk sidebar. The "Labels" heading is not
 * clickable; the "+" beside it opens a create-label dialog. Labels are private per
 * user: the current agent's own labels for this desk (channel) are listed below
 * (always shown, even with no emails). Clicking a label opens the conversations
 * carrying it.
 */

const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];
const colorForName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length] ?? '#6b7280';
};

interface DeskLabelsSidebarProps {
  channelId: string;
  activeLabelId: string | null;
  onSelectLabel: (labelId: string, labelName: string) => void;
}

export const DeskLabelsSidebar = ({
  channelId,
  activeLabelId,
  onSelectLabel,
}: DeskLabelsSidebarProps): ReactElement => {
  const zero = useZero();
  const [labels] = useCachedQuery(queries.conversationLabelsByChannelId({ channelId }), {
    enabled: !!channelId,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const list = useMemo(() => labels ?? [], [labels]);

  const handleCreate = async (): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (list.some(l => l.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('A label with this name already exists');
      return;
    }
    // Close optimistically; the mutation applies locally first and we surface
    // any server-side rejection (e.g. a name race) via toast.
    setNewName('');
    setCreateOpen(false);
    try {
      const result = await zero.mutate(
        mutators.conversationLabel.createLabel({
          id: uuidv4(),
          name: trimmed,
          channelId,
          timestamp: Date.now(),
        }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to create label');
      }
      toast.success(`Created label "${trimmed}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create label');
    }
  };

  const handleDelete = async (
    labelId: string,
    name: string,
    e: React.MouseEvent,
  ): Promise<void> => {
    e.stopPropagation();
    try {
      const result = await zero.mutate(mutators.conversationLabel.deleteLabel({ labelId })).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to delete label');
      }
      toast.success(`Deleted label "${name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete label');
    }
  };

  return (
    <div>
      {/* Non-clickable heading + add button */}
      <div className='flex items-center justify-between px-1.5 mb-1'>
        <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
          Labels
        </span>
        <button
          type='button'
          onClick={() => {
            setNewName('');
            setCreateOpen(true);
          }}
          className='p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
          aria-label='Create new label'
          title='Create new label'
          data-track-category='Support'
          data-track-name='OpenCreateLabel'
        >
          <Plus size={14} />
        </button>
      </div>

      <div className='space-y-0.5'>
        {list.length === 0 ? (
          <div className='px-1.5 py-1 text-[11px] text-muted-foreground/70'>No labels yet</div>
        ) : (
          list.map(label => {
            const color = label.color ?? colorForName(label.name);
            const active = activeLabelId === label.id;
            return (
              <div
                key={label.id}
                className={cn(
                  'group flex items-center h-7 rounded-md pr-1 transition-colors',
                  active
                    ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
                    : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
                )}
              >
                <button
                  type='button'
                  onClick={() => onSelectLabel(label.id, label.name)}
                  className='flex items-center gap-1.5 flex-1 min-w-0 px-1.5 h-full text-left'
                  data-track-category='Support'
                  data-track-name='SelectSidebarLabel'
                >
                  <Tag size={13} className='shrink-0' style={{ color }} fill={color} />
                  <span className='text-[13px] flex-1 truncate min-w-0'>{label.name}</span>
                </button>
                <button
                  type='button'
                  onClick={e => void handleDelete(label.id, label.name, e)}
                  className='p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0'
                  aria-label={`Delete label ${label.name}`}
                  title='Delete label'
                  data-track-category='Support'
                  data-track-name='DeleteLabel'
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open);
          if (!open) setNewName('');
        }}
        title='New label'
        description='Create a new label'
        className='max-w-[420px] p-0'
      >
        <div>
          <div className='flex items-start justify-between gap-3 px-5 py-4'>
            <h2 className='text-base font-semibold text-foreground leading-tight'>New label</h2>
            <button
              type='button'
              onClick={() => setCreateOpen(false)}
              className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0'
              aria-label='Close'
              data-track-category='Support'
              data-track-name='CloseCreateLabel'
            >
              <X className='size-4' />
            </button>
          </div>
          <div className='px-5 pb-2'>
            <label htmlFor='new-label-name' className='block text-sm text-muted-foreground mb-1.5'>
              Please enter a new label name:
            </label>
            <input
              id='new-label-name'
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder='Label name'
              className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring'
              data-track-category='Support'
              data-track-name='NewLabelNameInput'
            />
          </div>
          <div className='flex justify-end gap-2 px-5 py-4'>
            <button
              type='button'
              onClick={() => setCreateOpen(false)}
              className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
              data-track-category='Support'
              data-track-name='CancelCreateLabel'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => void handleCreate()}
              disabled={!newName.trim()}
              className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-50 disabled:pointer-events-none transition-colors'
              data-track-category='Support'
              data-track-name='ConfirmCreateLabel'
            >
              Create
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
