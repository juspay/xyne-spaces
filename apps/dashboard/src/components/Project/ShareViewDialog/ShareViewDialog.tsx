import { ReactElement, useMemo, useState } from 'react';
import { Search, Check, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import { useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { useAuth } from '../../../hooks/useAuth';
import { mutators } from '../../../zero/mutators';
import { cn } from '../../../utils/classNames';

interface ShareViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  viewId: string;
  viewName: string;
}

interface UserOption {
  id: string;
  name: string;
  email?: string;
}

export const ShareViewDialog = ({
  isOpen,
  onClose,
  viewId,
  viewName,
}: ShareViewDialogProps): ReactElement => {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isSharing, setIsSharing] = useState(false);

  const userOptions = useMemo(() => {
    const options: UserOption[] = (allUsers ?? [])
      .filter(u => u.id !== user?.id)
      .map(u => ({
        id: u.id,
        name: u.name || u.email || u.id,
        email: u.email,
      }));
    if (!searchQuery.trim()) return options;
    const lower = searchQuery.toLowerCase();
    return options.filter(
      o => o.name.toLowerCase().includes(lower) || o.email?.toLowerCase().includes(lower),
    );
  }, [allUsers, user?.id, searchQuery]);

  const toggleUser = (userId: string): void => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleShare = async (): Promise<void> => {
    if (selectedUserIds.size === 0) return;
    setIsSharing(true);
    try {
      const timestamp = Date.now();
      for (const userId of selectedUserIds) {
        const res = await zero.mutate(
          mutators.kanbanBoardViewAccess.grant({
            id: uuidv4(),
            viewId,
            userId,
            timestamp,
          }),
        ).server;
        if (res.type === 'error') {
          toast.error(res.error?.message ?? `Failed to share with a user`);
          return;
        }
      }
      toast.success(
        `View shared with ${selectedUserIds.size} user${selectedUserIds.size !== 1 ? 's' : ''}`,
      );
      setSelectedUserIds(new Set());
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to share view');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) {
          setSelectedUserIds(new Set());
          onClose();
        }
      }}
      title='Share view'
      description={`Share "${viewName}" with other users in your workspace.`}
      className='max-w-md rounded-2xl'
    >
      <div className='flex flex-col gap-4 p-5'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            autoFocus
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search users…'
            className='pl-9 h-9'
          />
        </div>

        <div className='max-h-64 overflow-y-auto space-y-0.5'>
          {userOptions.length === 0 ? (
            <div className='p-6 text-center text-sm text-muted-foreground'>No users found</div>
          ) : (
            userOptions.map(u => {
              const isSelected = selectedUserIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type='button'
                  onClick={() => toggleUser(u.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none text-left',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted text-foreground',
                  )}
                  data-track-category='Projects'
                  data-track-name='ToggleShareViewUser'
                  data-track-metadata={JSON.stringify({ userId: u.id, selected: !isSelected })}
                >
                  <div className='flex-1 min-w-0'>
                    <div className='text-sm font-medium truncate'>{u.name}</div>
                    {u.email && (
                      <div className='text-xs text-muted-foreground truncate'>{u.email}</div>
                    )}
                  </div>
                  {isSelected && <Check className='w-4 h-4 text-primary shrink-0' />}
                </button>
              );
            })
          )}
        </div>

        <div className='flex justify-end gap-2'>
          <Button variant='ghost' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={() => void handleShare()}
            disabled={selectedUserIds.size === 0 || isSharing}
          >
            <Share2 className='w-4 h-4 mr-1.5' />
            {isSharing
              ? 'Sharing…'
              : `Share${selectedUserIds.size > 0 ? ` (${selectedUserIds.size})` : ''}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
