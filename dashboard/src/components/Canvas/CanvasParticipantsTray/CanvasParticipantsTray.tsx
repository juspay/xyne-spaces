import React, { useState, useMemo } from 'react';
import { Search, X, Users, AlertTriangle } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import Input from '../../ui/Input';
import type { User } from '../../../machines/stateMachine';
import { useUsers } from '../../../hooks/useUsers';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { toast } from 'sonner';

export interface ParticipantItem {
  id: string;
  userId: string;
  role?: string;
  color?: string;
  status?: string;
}

interface CanvasParticipantsTrayProps {
  onClose: () => void;
  participants: ParticipantItem[];
  showRole?: boolean;
  showColor?: boolean;
  title?: string;
  // New props for collaborative toggle
  canvasId?: string | undefined;
  isCollaborative?: boolean;
  isOwner?: boolean;
}

export const CanvasParticipantsTray: React.FC<CanvasParticipantsTrayProps> = ({
  onClose,
  participants,
  showRole = true,
  showColor = false,
  title = 'Participants',
  canvasId,
  isCollaborative = false,
  isOwner = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCollaborativeWarning, setShowCollaborativeWarning] = useState(false);
  const z = useZero();

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  const filteredParticipants = useMemo(() => {
    if (!searchQuery.trim()) return participants;

    const searchLower = searchQuery.toLowerCase();
    return participants.filter(participant => {
      const user = usersById.get(participant.userId);
      return (
        user?.name?.toLowerCase().includes(searchLower) ||
        user?.email?.toLowerCase().includes(searchLower)
      );
    });
  }, [participants, searchQuery, usersById]);

  const handleToggleCollaborative = (newValue: boolean): void => {
    if (!z || !canvasId) return;

    try {
      z.mutate(
        mutators.canvas.update({
          id: canvasId,
          isCollaborative: newValue,
          timestamp: Date.now(),
        }),
      );
      toast.success(newValue ? 'Collaborative Mode Enabled' : 'Collaborative Mode Disabled', {
        description: newValue
          ? 'This canvas now uses real-time collaboration.'
          : 'Real-time collaboration has been disabled.',
        duration: 3000,
      });
    } catch {
      toast.error('Error', {
        description: 'Failed to update canvas mode. Please try again.',
        duration: 2000,
      });
    }
  };

  return (
    <>
      <div className='w-full max-w-md p-6'>
        <div className='flex items-center justify-between mb-4'>
          <h2 className='text-lg font-semibold text-foreground'>{title}</h2>
          <button
            onClick={onClose}
            className='rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
            data-track-category='CANVAS'
            data-track-name='Close_Participants_Tray'
            data-track-metadata={JSON.stringify({ canvasId })}
          >
            <X className='h-4 w-4' />
            <span className='sr-only'>Close</span>
          </button>
        </div>

        {/* Collaborative Mode Toggle - Only show for owners who haven't enabled it yet (one-way migration) */}
        {canvasId && isOwner && !isCollaborative && (
          <>
            <div className='flex items-center justify-between py-3 px-3 bg-muted rounded-lg mb-4'>
              <div className='flex items-center gap-3'>
                <Users size={18} className='text-muted-foreground' />
                <div>
                  <span className='text-sm font-medium'>Collaborative mode</span>
                  <p className='text-xs text-muted-foreground'>Enable real-time collaboration</p>
                </div>
              </div>
              <Button
                role='switch'
                aria-checked={false}
                aria-label='Enable collaborative mode'
                onClick={() => {
                  setShowCollaborativeWarning(true);
                }}
                className='relative w-12 h-6 rounded-full transition-all duration-200 bg-muted cursor-pointer'
                data-track-category='CANVAS'
                data-track-name='Open_Collaborative_Mode_Warning'
                data-track-metadata={JSON.stringify({ canvasId })}
              >
                <span
                  aria-hidden='true'
                  className='absolute top-1 w-4 h-4 bg-background rounded-full shadow transition-all duration-200 left-1'
                />
              </Button>
            </div>
          </>
        )}

        <div className='relative mb-4'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
          <Input
            type='text'
            placeholder='Find participants'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className='pl-10'
          />
        </div>

        <div className='max-h-96 overflow-y-auto space-y-2'>
          {filteredParticipants.map(participant => (
            <div
              key={participant.id}
              className='flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors'
            >
              <Avatar userId={participant.userId} size='md' />
              <div className='flex-1 min-w-0'>
                <div className='font-medium text-foreground truncate'>
                  {usersById.get(participant.userId)?.name || 'Unknown'}
                </div>
                <div className='text-sm text-muted-foreground truncate'>
                  {usersById.get(participant.userId)?.email || ''}
                </div>
              </div>
              <div className='flex items-center gap-2'>
                {showRole && participant.role && (
                  <div className='text-xs text-muted-foreground capitalize'>
                    {participant.role.toLowerCase()}
                  </div>
                )}
                {showColor && participant.color && (
                  <div
                    className='w-3 h-3 rounded-full'
                    style={{ backgroundColor: participant.color }}
                    title={`Cursor color: ${participant.color}`}
                  />
                )}
              </div>
            </div>
          ))}

          {filteredParticipants.length === 0 && (
            <div className='text-center py-8 text-muted-foreground'>
              <Search className='w-8 h-8 mx-auto mb-2 opacity-50' />
              <p>No participants found</p>
              <p className='text-sm mt-1'>Try adjusting your search</p>
            </div>
          )}
        </div>
      </div>

      {/* Collaborative Warning Modal */}
      {showCollaborativeWarning && (
        <Dialog
          open={showCollaborativeWarning}
          onOpenChange={open => !open && setShowCollaborativeWarning(false)}
          title='Enable Collaborative Mode'
        >
          <div className='p-6'>
            <div className='flex items-start gap-3 mb-4'>
              <AlertTriangle className='w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5' />
              <div>
                <p className='text-foreground font-medium mb-2'>
                  Before enabling collaborative mode
                </p>
                <p className='text-muted-foreground text-sm'>
                  Copy your content first. The collaborative editor will start fresh, and you can
                  paste your content there once the conversion is complete.
                </p>
              </div>
            </div>
            <div className='flex justify-end gap-3 mt-6'>
              <Button
                variant='secondary'
                onClick={() => setShowCollaborativeWarning(false)}
                data-track-category='CANVAS'
                data-track-name='Cancel_Enable_Collaborative_Mode'
                data-track-metadata={JSON.stringify({ canvasId })}
              >
                Cancel
              </Button>
              <Button
                variant='default'
                onClick={() => {
                  void handleToggleCollaborative(true);
                  setShowCollaborativeWarning(false);
                }}
                data-track-category='CANVAS'
                data-track-name='Enable_Collaborative_Mode'
                data-track-metadata={JSON.stringify({ canvasId })}
              >
                Enable Collaborative Mode
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
};
