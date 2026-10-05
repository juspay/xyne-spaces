import { ReactElement, useMemo, type DragEvent } from 'react';
import { X } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import Tooltip from '../../ui/Tooltip';
import { useUsers } from '../../../hooks/useUsers';
import { parseFromField } from '../EmailComposer/helpers';

interface EmailTagWithAvatarProps {
  email: string;
  onRemove: () => void;
  disabled?: boolean;
  users: ReturnType<typeof useUsers>;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  /**
   * The address will be rejected by the mail provider (e.g. `support@jiopay`).
   * Renders the raw address in a destructive style so the agent can spot and
   * fix it before Send — the friendly display name would otherwise hide it.
   */
  invalid?: boolean;
}

export const EmailTagWithAvatar = ({
  email,
  onRemove,
  disabled,
  users,
  draggable,
  onDragStart,
  onDragEnd,
  invalid = false,
}: EmailTagWithAvatarProps): ReactElement => {
  const parsed = useMemo(() => parseFromField(email), [email]);
  const cleanEmail = parsed.email ?? email;
  const user = useMemo(() => {
    return users.find(u => u.email.toLowerCase() === cleanEmail.toLowerCase());
  }, [users, cleanEmail]);

  const namePart = cleanEmail.split('@')[0] || cleanEmail;
  const fallbackDisplayName = namePart
    .split(/[._-]/)
    .map(word => (word.charAt(0) ?? '').toUpperCase() + word.slice(1))
    .join(' ');

  const displayName = invalid ? cleanEmail : user?.name || fallbackDisplayName;
  const initialLetter = (user?.name?.charAt(0) ?? namePart.charAt(0) ?? '').toUpperCase();

  return (
    <Tooltip
      content={
        invalid
          ? `${cleanEmail} is not a valid email address — remove or correct it before sending`
          : cleanEmail
      }
      side='top'
      delayDuration={300}
    >
      <div
        data-invalid-recipient={invalid ? 'true' : undefined}
        aria-invalid={invalid || undefined}
        className={`inline-flex items-center gap-2 rounded-lg border py-1 px-1.5 ${invalid ? 'border-destructive bg-destructive/10' : 'border-input bg-background'} ${draggable && !disabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
        draggable={draggable && !disabled ? true : undefined}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {/* Use Avatar component for internal users, custom fallback for external */}
        {user?.id ? (
          <Avatar
            userId={user.id}
            size='sm'
            showActiveStatus={false}
            className='!size-4 !text-[9px] !rounded-[3px]'
          />
        ) : (
          <div className='flex-shrink-0 flex items-center justify-center overflow-hidden bg-border w-4 h-4 rounded-[3px] aspect-square'>
            <span className='text-[9px] font-medium text-muted-foreground'>{initialLetter}</span>
          </div>
        )}
        <span className={`text-sm font-medium ${invalid ? 'text-destructive' : 'text-foreground'}`}>
          {displayName}
        </span>
        {!disabled && (
          <button
            onClick={e => {
              e.stopPropagation();
              onRemove();
            }}
            className='hover:bg-muted rounded p-0.5 transition-colors'
            aria-label={`Remove ${email}`}
            data-track-category='EMAIL'
            data-track-name='RemoveEmailTag'
            data-track-metadata={JSON.stringify({ email })}
          >
            <X size={14} className='text-muted-foreground' />
          </button>
        )}
      </div>
    </Tooltip>
  );
};
