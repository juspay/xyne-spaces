import { ReactElement, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, Tag, Plus, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Dialog } from '../../ui/Dialog/Dialog';

import { cn } from '../../../utils/classNames';
import {
  deleteConversationLabel,
  fetchConversationLabelDeleteImpact,
  type ConversationLabelDeleteImpact,
} from '../../../api/conversationLabelsApi';
import { deskLabelRulesQueryKey } from '../AutoLabelWizard/AutoLabelRules';

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
  isMember: boolean;
  activeLabelId: string | null;
  onSelectLabel: (labelId: string, labelName: string) => void;
  onDeletedLabel?: (labelId: string) => void;
}

export const DeskLabelsSidebar = ({
  channelId,
  isMember,
  activeLabelId,
  onSelectLabel,
  onDeletedLabel,
}: DeskLabelsSidebarProps): ReactElement => {
  const zero = useZero();
  const queryClient = useQueryClient();
  const [labels] = useCachedQuery(
    queries.conversationLabelsByChannelIdV2({ channelId, isMember }),
    { enabled: !!channelId },
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteImpact, setDeleteImpact] = useState<ConversationLabelDeleteImpact | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

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

  const handleDeleteClick = async (labelId: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    setDeleteLoadingId(labelId);
    try {
      const impact = await fetchConversationLabelDeleteImpact(labelId);
      setDeleteImpact(impact);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete label');
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteImpact) return;
    setDeleteSubmitting(true);
    try {
      const result = await deleteConversationLabel(deleteImpact.label.id);
      toast.success(`Deleted label "${result.label.name}"`);
      setDeleteImpact(null);
      onDeletedLabel?.(result.label.id);
      void queryClient.invalidateQueries({ queryKey: deskLabelRulesQueryKey(channelId) });
    } catch (err) {
      const maybeImpact = (
        err as {
          response?: { data?: { data?: ConversationLabelDeleteImpact; error?: string } };
        }
      )?.response?.data;
      if (maybeImpact?.data) setDeleteImpact(maybeImpact.data);
      toast.error(
        maybeImpact?.error || (err instanceof Error ? err.message : 'Failed to delete label'),
      );
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <div>
      {/* Non-clickable heading + add button */}
      <div className='flex items-center justify-between h-7 px-3'>
        <span className='text-xs font-medium text-sidebar-foreground'>Labels</span>
        <button
          type='button'
          onClick={() => {
            setNewName('');
            setCreateOpen(true);
          }}
          className='p-1 rounded text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors'
          aria-label='Create new label'
          title='Create new label'
          data-track-category='Support'
          data-track-name='OpenCreateLabel'
        >
          <Plus size={14} />
        </button>
      </div>

      <div>
        {list.length === 0 ? (
          <div className='px-3 py-1 text-xs text-sidebar-foreground/60 italic'>No labels yet</div>
        ) : (
          list.map(label => {
            const color = label.color ?? colorForName(label.name);
            const active = activeLabelId === label.id;
            return (
              <div
                key={label.id}
                className={cn(
                  'group flex items-center h-9 rounded-[10px] pr-2 border border-transparent text-sm font-medium tracking-[-0.14px] transition-colors',
                  active
                    ? 'text-sidebar-accent-foreground bg-sidebar-accent border-sidebar-border'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent',
                )}
              >
                <button
                  type='button'
                  onClick={() => onSelectLabel(label.id, label.name)}
                  className='flex items-center gap-3 flex-1 min-w-0 px-3 h-full text-left'
                  data-track-category='Support'
                  data-track-name='SelectSidebarLabel'
                >
                  <span className='size-4 flex items-center justify-center shrink-0'>
                    <Tag size={14} style={{ color }} fill={color} />
                  </span>
                  <span className='flex-1 truncate min-w-0'>{label.name}</span>
                </button>
                <button
                  type='button'
                  onClick={e => void handleDeleteClick(label.id, e)}
                  className='hidden group-hover:flex items-center justify-center p-1 rounded text-sidebar-foreground hover:text-destructive transition-colors shrink-0'
                  disabled={deleteLoadingId === label.id || deleteSubmitting}
                  aria-label={`Delete label ${label.name}`}
                  title='Delete label'
                  data-track-category='Support'
                  data-track-name='DeleteLabel'
                >
                  {deleteLoadingId === label.id ? (
                    <Loader2 size={12} className='animate-spin' />
                  ) : (
                    <Trash2 size={12} />
                  )}
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
              data-ph-capture-attribute-track-id='create_desk_label'
              className='text-sm font-medium px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm disabled:opacity-50 disabled:pointer-events-none transition-colors'
              data-track-category='Support'
              data-track-name='ConfirmCreateLabel'
            >
              Create
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!deleteImpact}
        onOpenChange={open => {
          if (!open && !deleteSubmitting) setDeleteImpact(null);
        }}
        title='Delete label'
        description='Review label dependencies before deleting.'
        className='max-w-[460px] p-0'
      >
        {deleteImpact && (
          <div>
            <div className='px-5 py-4'>
              <h2 className='text-base font-semibold text-foreground leading-tight'>
                Delete “{deleteImpact.label.name}”?
              </h2>
              <p className='mt-2 text-sm text-muted-foreground'>
                This removes the label from {deleteImpact.mappingCount}{' '}
                {deleteImpact.mappingCount === 1 ? 'email thread' : 'email threads'} and archives{' '}
                {deleteImpact.linkedDeskRuleCount}{' '}
                {deleteImpact.linkedDeskRuleCount === 1 ? 'auto-label rule' : 'auto-label rules'}.
              </p>
            </div>
            <div className='flex justify-end gap-2 px-5 py-4 border-t border-border'>
              <button
                type='button'
                onClick={() => setDeleteImpact(null)}
                disabled={deleteSubmitting}
                className='text-sm font-medium px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted/60 transition-colors'
                data-track-category='Support'
                data-track-name='CancelDeleteLabel'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={() => void confirmDelete()}
                disabled={deleteSubmitting}
                data-ph-capture-attribute-track-id='delete_desk_label'
                className='inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:pointer-events-none transition-colors'
                data-track-category='Support'
                data-track-name='ConfirmDeleteLabel'
              >
                {deleteSubmitting && <Loader2 className='size-4 animate-spin' />}
                Delete
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
