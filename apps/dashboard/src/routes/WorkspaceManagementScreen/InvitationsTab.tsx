import { ReactElement, useState, useMemo, useRef, useEffect } from 'react';
import {
  MailPlus,
  Send,
  CheckCircle,
  UserPlus,
  Loader2,
  ChevronDown,
  Mail,
  AlertCircle,
  Hash,
  FileText,
} from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useSelf } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { useAllChannels } from '../../hooks/useChannels';
import { WorkspaceRole, Invitation, ChannelScopeType } from '@xyne/shared';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { apiInstance } from '../../services/clients/apiClient';
import Dialog from '../../components/ui/Dialog';
import { usePlatform } from '../../hooks/usePlatform';

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

interface InvitationsTabProps {
  isActive?: boolean;
}

export const InvitationsTab = ({ isActive = false }: InvitationsTabProps): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>(WorkspaceRole.MEMBER);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [entityType, setEntityType] = useState<string>('');
  const [entityId, setEntityId] = useState('');
  const { isMobile } = usePlatform();
  const emailInputRef = useRef<HTMLInputElement>(null);

  const allChannels = useAllChannels();

  const [openCanvases] = useCachedQuery(queries.hierarchyCanvases({ scope: 'personal_root' }), {
    enabled: entityType === 'CANVAS',
  });

  const entityOptions = useMemo(() => {
    switch (entityType) {
      case 'CHANNEL':
        return allChannels
          .filter(
            c =>
              c.scopeType !== ChannelScopeType.DM &&
              c.scopeType !== ChannelScopeType.GROUP_DM &&
              !c.isArchived,
          )
          .map(c => ({
            value: c.id,
            label: c.name,
            icon: <Hash className='w-4 h-4 text-muted-foreground' />,
          }));
      case 'CANVAS':
        return (
          (openCanvases as unknown as Array<{ id: string; title: string }> | undefined) ?? []
        ).map(c => ({
          value: c.id,
          label: c.title,
          icon: <FileText className='w-4 h-4 text-muted-foreground' />,
        }));
      default:
        return [];
    }
  }, [entityType, allChannels, openCanvases]);

  const [allInvitations] = useCachedQuery(queries.getAllInvitations({}));

  const invitations = useMemo(() => {
    if (!allInvitations) return [];
    return allInvitations.filter((inv: Invitation) => inv.workspaceId === self?.workspaceId);
  }, [allInvitations, self?.workspaceId]);

  const validateForm = (): boolean => {
    if (!email.trim()) {
      toast.error('Please enter an email address');
      return false;
    }
    if (!self?.workspaceId) {
      toast.error('No workspace selected');
      return false;
    }
    if (role === WorkspaceRole.GUEST) {
      if (!entityType) {
        toast.error('Please select an entity type');
        return false;
      }
      if (!entityId.trim()) {
        toast.error('Please select an entity');
        return false;
      }
    }
    return true;
  };

  const openConfirmDialog = (): void => {
    if (!validateForm()) return;
    setShowConfirmDialog(true);
  };

  const handleSendInvitation = async (): Promise<void> => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim(),
        role,
        workspaceId: self!.workspaceId,
      };

      if (role === WorkspaceRole.GUEST) {
        payload['entityId'] = entityId.trim();
        payload['entityType'] = entityType;
      }

      await apiInstance.post('/invitations', payload);

      toast.success(`Invitation sent to ${email}`);
      setEmail('');
      setRole(WorkspaceRole.MEMBER);
      setEntityType('');
      setEntityId('');
      setShowConfirmDialog(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send invitation';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeInvitation = (invitationId: string): void => {
    z.mutate(mutators.invitation.revoke({ invitationId, timestamp: Date.now() }));
    toast.success('Invitation revoked');
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isInvitationRevocable = (invitation: Invitation): boolean => {
    if (invitation.acceptedAt) return false;
    if (!invitation.expiredAt) return true;

    const now = Date.now();
    const expiredAt = invitation.expiredAt;
    const createdAt = invitation.createdAt;

    if (expiredAt < now) return false;

    const fifteenDaysInMs = 15 * 24 * 60 * 60 * 1000;
    if (expiredAt - createdAt + 1000 < fifteenDaysInMs) return false;

    return true;
  };

  useEffect((): (() => void) | void => {
    if (!isActive || isMobile) return;
    const rafId = requestAnimationFrame(() => {
      emailInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isActive, isMobile]);

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center'>
          <Mail className='w-5 h-5 text-primary' />
        </div>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Invitations</h2>
          <p className='text-sm text-muted-foreground'>Invite team members to your workspace</p>
        </div>
      </div>

      {/* Send Invitation */}
      <Card className='p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <UserPlus className='w-5 h-5 text-primary' />
          <h3 className='text-sm font-medium text-foreground'>Send New Invitation</h3>
        </div>

        <div className='space-y-3'>
          <div className='flex gap-3 flex-wrap'>
            <Input
              ref={emailInputRef}
              type='email'
              placeholder='Enter email address...'
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isSubmitting) {
                  void handleSendInvitation();
                }
              }}
              className='flex-1 min-w-[200px]'
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='default'
                  className='gap-2 min-w-[100px] justify-between'
                >
                  <span className='capitalize'>{role.toLowerCase()}</span>
                  <ChevronDown className='w-4 h-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start'>
                <DropdownMenuItem
                  onClick={() => {
                    setRole(WorkspaceRole.ADMIN);
                    setEntityType('');
                    setEntityId('');
                  }}
                  data-track-category='workspace-management'
                  data-track-name='SELECT_INVITE_ROLE_ADMIN'
                  className={cn(role === WorkspaceRole.ADMIN && 'bg-accent')}
                >
                  Admin
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setRole(WorkspaceRole.MEMBER);
                    setEntityType('');
                    setEntityId('');
                  }}
                  data-track-category='workspace-management'
                  data-track-name='SELECT_INVITE_ROLE_MEMBER'
                  className={cn(role === WorkspaceRole.MEMBER && 'bg-accent')}
                >
                  Member
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setRole(WorkspaceRole.GUEST)}
                  data-track-category='workspace-management'
                  data-track-name='SELECT_INVITE_ROLE_GUEST'
                  className={cn(role === WorkspaceRole.GUEST && 'bg-accent')}
                >
                  Guest
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={openConfirmDialog}
              data-track-category='workspace-management'
              data-track-name='OPEN_INVITE_CONFIRM'
              disabled={isSubmitting || !email.trim()}
              className='gap-2'
            >
              {isSubmitting ? (
                <Loader2 className='w-4 h-4 animate-spin' />
              ) : (
                <Send className='w-4 h-4' />
              )}
              {isSubmitting ? 'Sending...' : 'Send'}
            </Button>
          </div>

          {role === WorkspaceRole.GUEST && (
            <div className='flex gap-3 flex-wrap'>
              <select
                value={entityType}
                onChange={e => {
                  setEntityType(e.target.value);
                  setEntityId('');
                }}
                className='px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[140px]'
                data-track-category='workspace-management'
                data-track-name='SelectGuestInvitationEntityType'
              >
                <option value=''>Select entity type...</option>
                <option value='CHANNEL'>Channel</option>
                <option value='CANVAS'>Canvas</option>
              </select>
              {entityType && (
                <div className='flex-1 min-w-[200px]'>
                  <EntitySelector
                    options={entityOptions}
                    selectedValue={entityId || null}
                    onSelect={value => {
                      setEntityId(value ?? '');
                    }}
                    placeholder={`Select ${entityType.toLowerCase()}...`}
                    searchPlaceholder={`Search ${entityType.toLowerCase()}s...`}
                    width='100%'
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        className='max-w-md rounded-xl'
      >
        <div className='p-6 space-y-4'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center'>
              <AlertCircle className='w-5 h-5 text-amber-600 dark:text-amber-400' />
            </div>
            <div>
              <h2 className='text-lg font-semibold text-foreground'>Confirm Invitation</h2>
              <p className='text-xs text-amber-600 dark:text-amber-400'>
                Please verify the details below carefully
              </p>
            </div>
          </div>

          <div className='rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-3'>
            <div className='flex items-center gap-3'>
              <Mail className='w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0' />
              <div>
                <p className='text-xs text-amber-700 dark:text-amber-300'>Email</p>
                <p className='text-sm font-semibold text-amber-900 dark:text-amber-100'>{email}</p>
              </div>
            </div>
            <div className='border-t border-amber-200 dark:border-amber-800' />
            <div className='flex items-center gap-3'>
              <UserPlus className='w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0' />
              <div>
                <p className='text-xs text-amber-700 dark:text-amber-300'>Role</p>
                <p className='text-sm font-semibold text-amber-900 dark:text-amber-100 capitalize'>
                  {role.toLowerCase()}
                </p>
              </div>
            </div>
            {role === WorkspaceRole.GUEST && entityType && (
              <>
                <div className='border-t border-amber-200 dark:border-amber-800' />
                <div className='flex items-center gap-3'>
                  <MailPlus className='w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0' />
                  <div>
                    <p className='text-xs text-amber-700 dark:text-amber-300'>Access</p>
                    <p className='text-sm font-semibold text-amber-900 dark:text-amber-100 capitalize'>
                      {entityType.toLowerCase()}: {entityId}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <p className='text-xs text-amber-700 dark:text-amber-400'>
            {role === WorkspaceRole.GUEST
              ? `Once accepted, this user will join as a guest with access limited to the selected ${entityType.toLowerCase()}.`
              : `Once accepted, this user will become a workspace member with role ${role.toLowerCase()}.`}
          </p>

          <div className='flex gap-3 justify-end pt-2'>
            <Button
              variant='outline'
              onClick={() => setShowConfirmDialog(false)}
              data-track-category='workspace-management'
              data-track-name='CANCEL_SEND_INVITATION'
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSendInvitation()}
              data-track-category='workspace-management'
              data-track-name='SEND_INVITATION'
              disabled={isSubmitting}
              className='gap-2'
            >
              {isSubmitting ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  Sending...
                </>
              ) : (
                <>
                  <Send className='w-4 h-4' />
                  Send Invitation
                </>
              )}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Invitations List */}
      <Card>
        <div className='p-4 border-b border-border'>
          <h3 className='text-sm font-medium text-foreground'>Pending Invitations</h3>
        </div>

        {invitations.length === 0 ? (
          <div className='p-8 text-center text-muted-foreground'>
            <MailPlus className='w-12 h-12 mx-auto mb-3 opacity-50' />
            <p>No pending invitations</p>
            <p className='text-sm mt-1'>Invite team members to collaborate in your workspace</p>
          </div>
        ) : (
          <div className='divide-y divide-border'>
            {invitations.map((invitation: Invitation) => (
              <div
                key={invitation.id}
                className='flex items-center justify-between p-4 hover:bg-muted/50 transition-colors'
              >
                <div className='flex items-center gap-3'>
                  <div className='w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center'>
                    <MailPlus className='w-5 h-5 text-primary' />
                  </div>
                  <div>
                    <p className='font-medium text-foreground'>{invitation.email}</p>
                    <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                      <span className='capitalize'>{invitation.role.toLowerCase()}</span>
                      <span>•</span>
                      <span>Sent {formatDate(invitation.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {invitation.acceptedAt ? (
                  <span className='text-sm text-green-600 font-medium'>Accepted</span>
                ) : isInvitationRevocable(invitation) ? (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => handleRevokeInvitation(invitation.id)}
                    data-track-category='workspace-management'
                    data-track-name='REVOKE_INVITATION'
                    className='text-destructive hover:text-destructive hover:bg-destructive/10'
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Info */}
      <Card className='p-6 bg-muted/50 border-dashed'>
        <div className='flex items-start gap-3'>
          <CheckCircle className='w-5 h-5 text-primary mt-0.5' />
          <div>
            <h3 className='font-medium text-foreground'>How invitations work</h3>
            <ul className='mt-2 text-sm text-muted-foreground space-y-1 list-disc list-inside'>
              <li>Invited users will receive an email with a link to join</li>
              <li>They can accept the invitation to join your workspace</li>
              <li>You can revoke invitations at any time before they are accepted</li>
              <li>Once accepted, users become workspace members with the assigned role</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default InvitationsTab;
