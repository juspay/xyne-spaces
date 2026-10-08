import { logger, Event as LogEvent } from '../../../utils/logger';
import { useState, useEffect } from 'react';
import { useZero } from '../../../hooks/useZero';
import { Dialog } from '../../ui/Dialog/Dialog';
import Button from '../../ui/Button';
import { Check } from 'lucide-react';
import { apiInstance } from '../../../services/clients/apiClient';
import { mutators } from '../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface InviteUser {
  id: string;
  name: string;
  email: string;
}

interface AIInviteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (userIds: string[], message: string) => void;
  callId: string;
  users: InviteUser[];
  suggestedMessage: string;
  roomLink?: string | undefined;
}

export function AIInviteDialog({
  isOpen,
  onClose,
  onSend,
  callId,
  users,
  suggestedMessage,
  roomLink,
}: AIInviteDialogProps): React.ReactElement | null {
  const zero = useZero();
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  // Initialize selected users and message when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedUserIds(new Set(users.map(u => u.id)));
      setMessage(suggestedMessage);
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('[AIInviteDialog] Opening with suggestedMessage:'),
        context: [suggestedMessage],
      });
    }
  }, [isOpen, users, suggestedMessage]);

  const toggleUser = (userId: string): void => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleSend = (): void => {
    if (selectedUserIds.size === 0) return;

    setIsInviting(true);

    const userIds = Array.from(selectedUserIds);
    const participantIds = userIds.reduce(
      (acc, userId) => {
        acc[userId] = uuidv4();
        return acc;
      },
      {} as Record<string, string>,
    );

    // Execute async operations
    void (async (): Promise<void> => {
      try {
        // Call the invite mutator to track call invitations
        zero.mutate(
          mutators.calls.invite({ callId, userIds, timestamp: Date.now(), participantIds }),
        );

        // Prepare the message content with call link
        // Convert plain text to HTML format (messages in the system use HTML)
        const messageText = message || "You're invited to join a call!";
        const linkText = roomLink ? `Join here: ${roomLink}` : '';

        // Create HTML with proper paragraph tags
        const messageContent = `<p>${messageText}</p>${linkText ? `<p>${linkText}</p>` : ''}`;

        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[AIInviteDialog] Sending DM with message:'),
          context: [{ message, messageContent }],
        });

        // Send DM to each user using the backend API
        // The backend will create or get existing DM and send the message
        const sendPromises = userIds.map(async userId => {
          await apiInstance.post('/users/me/dms', {
            participantIds: [userId],
            message: messageContent,
          });
        });

        await Promise.all(sendPromises);

        // Notify parent
        onSend(userIds, message);
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to send invites:'),
          error: error,
        });
      } finally {
        // Reset and close
        setSelectedUserIds(new Set());
        setMessage('');
        onClose();
        setIsInviting(false);
      }
    })();
  };

  const handleClose = (): void => {
    setSelectedUserIds(new Set());
    setMessage('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose} title='Xyne Automatic - Invite Users'>
      <div className='p-4 space-y-6'>
        <div>
          <h2 className='text-lg font-semibold text-foreground mb-1'>Invite Users to Call</h2>
          <p className='text-sm text-muted-foreground'>
            The AI assistant found these users based on your request. Select who you want to invite.
          </p>
        </div>

        {/* User Selection */}
        <div className='space-y-2'>
          <span className='text-sm font-medium text-foreground'>Users to Invite</span>
          <div
            className='border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto'
            role='group'
            aria-label='Users to invite'
          >
            {users.length === 0 ? (
              <div className='p-4 text-center text-muted-foreground text-sm'>No users found</div>
            ) : (
              users.map(user => (
                <button
                  key={user.id}
                  type='button'
                  onClick={() => toggleUser(user.id)}
                  className='w-full flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors text-left'
                  data-track-category='CALLS'
                  data-track-name='Toggle_Invite_User'
                  data-track-metadata={JSON.stringify({
                    userId: user.id,
                    userName: getUserDisplayName(user),
                    callId,
                  })}
                >
                  <div
                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      selectedUserIds.has(user.id)
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border'
                    }`}
                  >
                    {selectedUserIds.has(user.id) && <Check className='w-3 h-3' />}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='font-medium text-foreground truncate'>
                      {getUserDisplayName(user)}
                    </div>
                    <div className='text-xs text-muted-foreground truncate'>{user.email}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Message Input */}
        <div className='space-y-2'>
          <label htmlFor='invite-message' className='text-sm font-medium text-foreground'>
            Message (optional)
          </label>
          <textarea
            id='invite-message'
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder='Add a message for the invite...'
            className='w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none'
            rows={3}
            data-track-event='change'
            data-track-category='CALLS'
            data-track-name='Set_Invite_Message'
            data-track-metadata={JSON.stringify({ callId })}
          />

          {/* Call Link Preview */}
          {roomLink && (
            <div className='p-3 bg-accent/30 border border-border rounded-lg'>
              <div className='text-xs font-medium text-muted-foreground mb-1'>
                Call link will be included:
              </div>
              <div className='text-sm text-foreground font-mono break-all'>{roomLink}</div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className='flex justify-end gap-3 pt-4 border-t border-border'>
          <Button
            variant='ghost'
            size='default'
            onClick={handleClose}
            disabled={isInviting}
            data-track-category='CALLS'
            data-track-name='Cancel_AI_Invite'
            data-track-metadata={JSON.stringify({ callId })}
          >
            Cancel
          </Button>
          <Button
            variant='default'
            size='default'
            onClick={handleSend}
            disabled={selectedUserIds.size === 0 || isInviting}
            loading={isInviting}
            data-track-category='CALLS'
            data-track-name='Send_AI_Invite'
            data-track-metadata={JSON.stringify({ userCount: selectedUserIds.size, callId })}
          >
            {isInviting
              ? 'Inviting...'
              : `Invite${selectedUserIds.size > 0 ? ` (${selectedUserIds.size})` : ''}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
