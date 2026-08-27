import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  Hash,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import Dialog from '../../components/ui/Dialog';
import Input from '../../components/ui/Input/Input';
import { apiInstance } from '../../services/clients/apiClient';
import { cn } from '../../utils/classNames';
import { useSelf } from '../../hooks/useUsers';

type GuestEntityType = 'CHANNEL' | 'CANVAS';

type GuestAccessGrant = {
  id: string;
  accessibleEntityId: string;
  accessibleEntityType: GuestEntityType;
  entityName: string;
  createdAt: string;
  invitedBy: string;
  invitedByName: string | null;
};

type GuestUserAccess = {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  status: string;
  createdAt: string;
  access: GuestAccessGrant[];
};

type GuestUsersResponse = {
  data: GuestUserAccess[];
};

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } })
      .response;
    return response?.data?.error ?? response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const getEntityIcon = (type: GuestEntityType): ReactElement => {
  switch (type) {
    case 'CHANNEL':
      return <Hash className='w-4 h-4' />;
    case 'CANVAS':
      return <FileText className='w-4 h-4' />;
  }
};

const getEntityBadgeClass = (type: GuestEntityType): string => {
  switch (type) {
    case 'CHANNEL':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
    case 'CANVAS':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
  }
};

interface GuestUsersTabProps {
  isActive?: boolean;
}

export const GuestUsersTab = ({ isActive = false }: GuestUsersTabProps): ReactElement => {
  const self = useSelf();
  const [guests, setGuests] = useState<GuestUserAccess[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{
    guest: GuestUserAccess;
    access: GuestAccessGrant;
  } | null>(null);

  const loadGuests = useCallback(async (): Promise<void> => {
    if (!self?.workspaceId) return;
    setIsLoading(true);
    try {
      const response = await apiInstance.get<GuestUsersResponse>('/users/guests');
      setGuests(response.data.data);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load guest users'));
    } finally {
      setIsLoading(false);
    }
  }, [self?.workspaceId]);

  useEffect(() => {
    if (!isActive) return;
    void loadGuests();
  }, [isActive, loadGuests]);

  const filteredGuests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return guests;
    return guests.filter(guest => {
      const guestText = `${guest.name} ${guest.email}`.toLowerCase();
      const accessText = guest.access
        .map(access => `${access.entityName} ${access.accessibleEntityType}`)
        .join(' ')
        .toLowerCase();
      return guestText.includes(query) || accessText.includes(query);
    });
  }, [guests, searchQuery]);

  const totalGrantCount = useMemo(
    () => guests.reduce((count, guest) => count + guest.access.length, 0),
    [guests],
  );

  const confirmRevoke = async (): Promise<void> => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      const { guest, access } = revokeTarget;
      await apiInstance.delete(
        `/users/guests/${encodeURIComponent(guest.id)}/access/${encodeURIComponent(
          access.accessibleEntityType,
        )}/${encodeURIComponent(access.accessibleEntityId)}`,
      );
      toast.success('Guest access revoked');
      setRevokeTarget(null);
      await loadGuests();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to revoke guest access'));
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center'>
            <UserCheck className='w-5 h-5 text-primary' />
          </div>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>Guest Users</h2>
            <p className='text-sm text-muted-foreground'>
              {guests.length} guest{guests.length !== 1 ? 's' : ''} with {totalGrantCount} access
              grant{totalGrantCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void loadGuests()}
          data-track-category='workspace-management'
          data-track-name='RELOAD_GUEST_USERS'
          disabled={isLoading}
          className='gap-2'
        >
          {isLoading ? (
            <Loader2 className='w-4 h-4 animate-spin' />
          ) : (
            <RefreshCw className='w-4 h-4' />
          )}
          Refresh
        </Button>
      </div>

      <Card className='p-4'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
          <Input
            type='text'
            placeholder='Search by guest, email, entity, or grant type...'
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            className='pl-10'
          />
        </div>
      </Card>

      <Card>
        {isLoading && guests.length === 0 ? (
          <div className='p-8 text-center text-muted-foreground'>
            <Loader2 className='w-10 h-10 mx-auto mb-3 animate-spin opacity-60' />
            <p>Loading guest access</p>
          </div>
        ) : filteredGuests.length === 0 ? (
          <div className='p-8 text-center text-muted-foreground'>
            <Users className='w-12 h-12 mx-auto mb-3 opacity-50' />
            <p>No guest users found</p>
            {searchQuery && <p className='text-sm mt-1'>Try a different search term</p>}
          </div>
        ) : (
          <div className='divide-y divide-border'>
            {filteredGuests.map(guest => (
              <div key={guest.id} className='p-4 space-y-3'>
                <div className='flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-3 min-w-0'>
                    <div className='w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0'>
                      {guest.picture ? (
                        <img
                          src={guest.picture}
                          alt={guest.name}
                          className='w-full h-full object-cover'
                        />
                      ) : (
                        <span className='text-sm font-medium text-primary'>
                          {guest.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium text-foreground truncate'>{guest.name}</span>
                        <span className='inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'>
                          Guest
                        </span>
                      </div>
                      <div className='flex items-center gap-2 text-sm text-muted-foreground min-w-0'>
                        <span className='truncate'>{guest.email}</span>
                        <span>•</span>
                        <span>Joined {formatDate(guest.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <span className='text-sm text-muted-foreground shrink-0'>
                    {guest.access.length} grant{guest.access.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className='rounded-lg border border-border overflow-hidden'>
                  {guest.access.map(access => (
                    <div
                      key={access.id}
                      className='flex items-center justify-between gap-3 px-3 py-2 bg-background border-b border-border last:border-b-0'
                    >
                      <div className='flex items-center gap-3 min-w-0'>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium shrink-0',
                            getEntityBadgeClass(access.accessibleEntityType),
                          )}
                        >
                          {getEntityIcon(access.accessibleEntityType)}
                          {access.accessibleEntityType.toLowerCase()}
                        </span>
                        <div className='min-w-0'>
                          <p className='text-sm font-medium text-foreground truncate'>
                            {access.entityName}
                          </p>
                          <p className='text-xs text-muted-foreground'>
                            Granted {formatDate(access.createdAt)}
                            {access.invitedByName ? ` by ${access.invitedByName}` : ''}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setRevokeTarget({ guest, access })}
                        data-track-category='workspace-management'
                        data-track-name='OPEN_REVOKE_GUEST_CONFIRM'
                        className='text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0'
                      >
                        <Trash2 className='w-4 h-4' />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog
        open={!!revokeTarget}
        onOpenChange={open => {
          if (!open && !isRevoking) setRevokeTarget(null);
        }}
        className='max-w-md rounded-xl'
      >
        <div className='p-6 space-y-4'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center'>
              <AlertTriangle className='w-5 h-5 text-destructive' />
            </div>
            <h2 className='text-lg font-semibold text-foreground'>Revoke Guest Access</h2>
          </div>

          <p className='text-sm text-muted-foreground'>
            Revoke{' '}
            <span className='font-medium text-foreground'>{revokeTarget?.access.entityName}</span>{' '}
            access for{' '}
            <span className='font-medium text-foreground'>{revokeTarget?.guest.name}</span>?
          </p>

          <div className='flex gap-3 justify-end pt-2'>
            <Button
              variant='outline'
              onClick={() => setRevokeTarget(null)}
              data-track-category='workspace-management'
              data-track-name='CANCEL_REVOKE_GUEST'
              disabled={isRevoking}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => void confirmRevoke()}
              data-track-category='workspace-management'
              data-track-name='CONFIRM_REVOKE_GUEST'
              disabled={isRevoking}
              className='gap-2'
            >
              {isRevoking ? <Loader2 className='w-4 h-4 animate-spin' /> : null}
              Revoke
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default GuestUsersTab;
