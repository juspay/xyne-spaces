import { ReactElement, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { sanitizeProjectCode, isValidProjectCode } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useZero } from '../../../hooks/useZero';
import { apiInstance } from '../../../services/clients/apiClient';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Badge } from '../../ui/Badge';

interface TicketNamespacesModalProps {
  projectId: string;
  defaultNamespaceId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Manage a project's ticket codes (namespaces): the prefixes its boards use for
 * ticket IDs. Reads live via Zero, creates over REST, edits via the Zero mutator.
 * A code is frozen once created; only its description can change.
 */
export const TicketNamespacesModal = ({
  projectId,
  defaultNamespaceId,
  open,
  onOpenChange,
}: TicketNamespacesModalProps): ReactElement => {
  const zero = useZero();
  const [namespaces] = useCachedQuery(queries.ticketNamespacesByProject({ projectId }), {
    enabled: !!projectId,
  });
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId }), {
    enabled: !!projectId,
  });

  const [newCode, setNewCode] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);

  const boardCountByNamespace = useMemo(() => {
    const counts = new Map<string, number>();
    (boards ?? []).forEach(board => {
      if (board.ticketNamespaceId) {
        counts.set(board.ticketNamespaceId, (counts.get(board.ticketNamespaceId) ?? 0) + 1);
      }
    });
    return counts;
  }, [boards]);

  const handleCreate = async (): Promise<void> => {
    const code = sanitizeProjectCode(newCode);
    if (!isValidProjectCode(code)) {
      toast.error('Enter a valid code', {
        description: 'Use at least 2 uppercase letters or numbers, e.g. SEA.',
      });
      return;
    }
    try {
      setCreating(true);
      await apiInstance.post('/ticket-namespaces', {
        projectId,
        code,
        ...(newDescription.trim() && { description: newDescription.trim() }),
      });
      toast.success(`Added code ${code}`);
      setNewCode('');
      setNewDescription('');
    } catch (error) {
      toast.error('Could not add code', {
        description: error instanceof Error ? error.message : 'Please try again.',
        duration: 5000,
      });
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (id: string, description: string | null): void => {
    setEditingId(id);
    setEditDescription(description ?? '');
  };

  const handleSaveDescription = async (namespaceId: string): Promise<void> => {
    const description = editDescription.trim();
    if (!description) {
      setEditingId(null);
      return;
    }
    try {
      setSavingDescription(true);
      const result = zero.mutate(
        mutators.ticketNamespace.update({ namespaceId, description, timestamp: Date.now() }),
      );
      const res = await result.server;
      if (res?.type === 'error') {
        toast.error('Update failed', { description: res.error.message, duration: 5000 });
        return;
      }
      setEditingId(null);
    } catch (error) {
      toast.error('Update failed', {
        description: error instanceof Error ? error.message : 'Please try again.',
        duration: 5000,
      });
    } finally {
      setSavingDescription(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Manage ticket codes'
      className='max-w-[560px] max-h-[85vh] rounded-[16px] overflow-hidden'
    >
      <div className='flex flex-col max-h-[85vh]'>
        {/* Header */}
        <div className='flex shrink-0 items-start justify-between gap-4 border-b border-border px-[18px] py-3'>
          <div>
            <p className='text-base font-semibold text-foreground'>Ticket codes</p>
            <p className='text-xs text-muted-foreground'>
              The prefixes this project&apos;s boards use for ticket IDs. A board keeps its code for
              life.
            </p>
          </div>
          <button
            type='button'
            onClick={() => onOpenChange(false)}
            aria-label='Close'
            data-track-category='TicketNamespace'
            data-track-name='CloseModal'
            className='shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          >
            <X className='size-4' />
          </button>
        </div>

        {/* List */}
        <div className='flex-1 overflow-y-auto p-4 space-y-2'>
          {namespaces === undefined ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>Loading codes…</p>
          ) : namespaces.length === 0 ? (
            <div className='rounded-lg border-2 border-dashed border-border py-8 text-center'>
              <p className='text-sm text-muted-foreground'>No codes yet. Add one below.</p>
            </div>
          ) : (
            namespaces.map(namespace => {
              const isDefault = namespace.id === defaultNamespaceId;
              const boardCount = boardCountByNamespace.get(namespace.id) ?? 0;
              const isEditing = editingId === namespace.id;
              return (
                <div
                  key={namespace.id}
                  className='flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3'
                >
                  <div className='flex min-w-0 items-center gap-3'>
                    <Badge variant='secondary' className='font-mono'>
                      {namespace.code}
                    </Badge>
                    {isEditing ? (
                      <Input
                        value={editDescription}
                        onChange={e => setEditDescription(e.target.value)}
                        placeholder='Description'
                        disabled={savingDescription}
                        autoFocus
                        className='h-8'
                      />
                    ) : namespace.description ? (
                      <span className='truncate text-sm text-foreground'>
                        {namespace.description}
                      </span>
                    ) : (
                      <span className='truncate text-sm text-muted-foreground'>No description</span>
                    )}
                    {isDefault && <Badge variant='outline'>Default</Badge>}
                  </div>
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className='text-xs text-muted-foreground'>
                      {boardCount} {boardCount === 1 ? 'board' : 'boards'}
                    </span>
                    {isEditing ? (
                      <>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => setEditingId(null)}
                          disabled={savingDescription}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant='default'
                          size='sm'
                          loading={savingDescription}
                          onClick={() => void handleSaveDescription(namespace.id)}
                        >
                          Save
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => startEdit(namespace.id, namespace.description)}
                        data-track-category='TicketNamespace'
                        data-track-name='StartEditDescription'
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add a code */}
        <div className='shrink-0 space-y-2 border-t border-border bg-background p-4'>
          <p className='text-sm font-medium text-foreground'>Add a code</p>
          <div className='flex items-end gap-2'>
            <div className='w-28'>
              <label
                htmlFor='ticket-namespace-code'
                className='mb-1 block text-xs text-muted-foreground'
              >
                Code
              </label>
              <Input
                id='ticket-namespace-code'
                value={newCode}
                onChange={e => setNewCode(sanitizeProjectCode(e.target.value))}
                placeholder='SEA'
                disabled={creating}
              />
            </div>
            <div className='flex-1'>
              <label
                htmlFor='ticket-namespace-description'
                className='mb-1 block text-xs text-muted-foreground'
              >
                Description (optional)
              </label>
              <Input
                id='ticket-namespace-description'
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                placeholder='e.g. Payments squad'
                disabled={creating}
              />
            </div>
            <Button
              variant='default'
              loading={creating}
              disabled={!newCode}
              onClick={() => void handleCreate()}
              data-track-category='TicketNamespace'
              data-track-name='CreateNamespace'
              data-track-metadata={JSON.stringify({ projectId })}
            >
              <Plus size={16} className='mr-1' />
              Add
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            Tickets will be {newCode || 'CODE'}-0001. Codes are unique across your workspace.
          </p>
        </div>
      </div>
    </Dialog>
  );
};

TicketNamespacesModal.displayName = 'TicketNamespacesModal';

export default TicketNamespacesModal;
