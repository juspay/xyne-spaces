import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Check, Clock3, Globe2, Hash, LoaderCircle, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useChannelSearch, useUserGroupSearch } from '@xyne/shared/hooks';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { useAuth } from '../../../hooks/useAuth';
import { useActiveUsers } from '../../../hooks/useUsers';
import {
  recordingService,
  type SummaryTemplate,
  type SummaryTemplatePublicationAdmin,
  type SummaryTemplatePublicationAction,
  type SummaryTemplateShare,
  type SummaryTemplateShareTarget,
} from '../../../services/Recording/recordingService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { SearchParticipants } from '../../CallHistoryScreen/SearchParticipants';

interface SummaryTemplateShareModalProps {
  template: SummaryTemplate;
  onTemplateChange?: (template: SummaryTemplate) => void;
}

export function SummaryTemplateShareModal({
  template,
  onTemplateChange,
}: SummaryTemplateShareModalProps): ReactElement {
  const { user: currentUser } = useAuth();
  const activeUsers = useActiveUsers();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [shares, setShares] = useState<SummaryTemplateShare[]>([]);
  const [admins, setAdmins] = useState<SummaryTemplatePublicationAdmin[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [publicationAction, setPublicationAction] =
    useState<SummaryTemplatePublicationAction | null>(null);
  const [showAdmins, setShowAdmins] = useState(true);
  const userGroups = useUserGroupSearch(searchQuery, 10);
  const channels = useChannelSearch(searchQuery, 10);
  const isOwner = currentUser?.id === template.createdBy && template.canEdit;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      recordingService.getSummaryTemplatePublicationContext(),
      isOwner ? recordingService.getSummaryTemplateShares(template.id) : Promise.resolve([]),
    ])
      .then(([context, nextShares]) => {
        if (cancelled) return;
        setAdmins(context.admins);
        setIsAdmin(context.isAdmin);
        setShares(nextShares);
      })
      .catch(error => {
        if (!cancelled) {
          toast.error('Unable to load sharing', {
            description: getApiErrorMessage(error, 'Please try again.'),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [isOwner, template.id]);

  const sharedUserIds = useMemo(
    () => new Set(shares.flatMap(share => (share.userId ? [share.userId] : []))),
    [shares],
  );
  const sharedUserGroupIds = useMemo(
    () => new Set(shares.flatMap(share => (share.userGroupId ? [share.userGroupId] : []))),
    [shares],
  );
  const sharedChannelIds = useMemo(
    () => new Set(shares.flatMap(share => (share.channelId ? [share.channelId] : []))),
    [shares],
  );

  const options = useMemo(() => {
    const userOptions = activeUsers
      .filter(user => user.id !== template.createdBy && !sharedUserIds.has(user.id))
      .map(user => ({
        label: getUserDisplayName(user),
        subtitle: user.email ?? '',
        value: `user:${user.id}`,
        icon: <Avatar userId={user.id} size='sm' showActiveStatus={false} />,
      }));
    const groupOptions = userGroups
      .filter(group => !sharedUserGroupIds.has(group.id))
      .map(group => ({
        label: group.name,
        subtitle: 'Group',
        value: `user_group:${group.id}`,
        icon: <Users className='size-3.5 text-muted-foreground' />,
      }));
    const channelOptions = channels
      .filter(channel => !sharedChannelIds.has(channel.id))
      .map(channel => ({
        label: channel.name,
        subtitle: 'Channel',
        value: `channel:${channel.id}`,
        icon: <Hash className='size-3.5 text-muted-foreground' />,
      }));
    return [...userOptions, ...groupOptions, ...channelOptions];
  }, [
    activeUsers,
    channels,
    sharedChannelIds,
    sharedUserGroupIds,
    sharedUserIds,
    template.createdBy,
    userGroups,
  ]);

  const toTarget = (value: string): SummaryTemplateShareTarget =>
    value.startsWith('user_group:')
      ? { type: 'user_group', id: value.slice('user_group:'.length) }
      : value.startsWith('channel:')
        ? { type: 'channel', id: value.slice('channel:'.length) }
        : { type: 'user', id: value.slice('user:'.length) };

  const handleShare = async (): Promise<void> => {
    if (selectedValues.length === 0 || sharing) return;
    setSharing(true);
    try {
      const result = await recordingService.grantSummaryTemplateAccess(
        template.id,
        selectedValues.map(toTarget),
      );
      setShares(result.shares);
      toast.success(
        selectedValues.length === 1
          ? 'Template shared'
          : `Shared with ${selectedValues.length} recipients`,
      );
      setSelectedValues([]);
      setSearchQuery('');
    } catch (error) {
      toast.error('Failed to share', {
        description: getApiErrorMessage(error, 'Unable to share this template'),
      });
    } finally {
      setSharing(false);
    }
  };

  const handleRevoke = async (share: SummaryTemplateShare): Promise<void> => {
    const target: SummaryTemplateShareTarget = share.userGroupId
      ? { type: 'user_group', id: share.userGroupId }
      : share.channelId
        ? { type: 'channel', id: share.channelId }
        : { type: 'user', id: share.userId! };
    setRevokingId(share.id);
    try {
      const result = await recordingService.revokeSummaryTemplateAccess(template.id, [target]);
      setShares(result.shares);
      toast.success('Access removed');
    } catch (error) {
      toast.error('Failed to remove access', {
        description: getApiErrorMessage(error, 'Unable to remove template access'),
      });
    } finally {
      setRevokingId(null);
    }
  };

  const handlePublication = async (action: SummaryTemplatePublicationAction): Promise<void> => {
    if (publicationAction) return;
    setPublicationAction(action);
    try {
      const updated = await recordingService.manageSummaryTemplatePublication(template.id, action);
      onTemplateChange?.(updated);
      toast.success(
        action === 'request'
          ? 'Sent to Scribe admins for review'
          : action === 'publish'
            ? 'Template published'
            : action === 'withdraw'
              ? 'Publication request withdrawn'
              : action === 'approve'
                ? 'Template published'
                : 'Publication request denied',
      );
    } catch (error) {
      toast.error('Unable to update publication status', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setPublicationAction(null);
    }
  };

  const canReview = isAdmin && template.visibility === 'WAITING_FOR_APPROVAL';

  if (!currentUser || (!isOwner && !canReview)) {
    return (
      <div className='p-5 text-sm text-muted-foreground'>
        Only the template creator or a Scribe admin can manage this template.
      </div>
    );
  }

  return (
    <div className='flex w-full flex-col gap-4 p-5'>
      {isOwner && (
        <>
          <div className='space-y-2'>
            <p className='text-[13px] leading-5 text-muted-foreground'>
              Share with people, groups, or channels
            </p>
            <SearchParticipants
              options={options}
              selectedValues={selectedValues}
              onMultiSelect={setSelectedValues}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              exclusiveSelection={false}
            />
          </div>

          <div className='flex justify-end'>
            <Button
              size='sm'
              onClick={() => void handleShare()}
              disabled={selectedValues.length === 0 || sharing}
              data-track-category='SummaryTemplates'
              data-track-name='ShareTemplateConfirm'
            >
              {sharing ? 'Sharing…' : 'Share'}
            </Button>
          </div>

          <div className='space-y-2 border-t border-border pt-3'>
            <p className='text-[13px] text-muted-foreground'>People with access</p>
            {loading ? (
              <div className='flex items-center gap-2 py-2 text-sm text-muted-foreground'>
                <LoaderCircle className='size-4 animate-spin' /> Loading…
              </div>
            ) : shares.length === 0 ? (
              <p className='py-2 text-sm text-muted-foreground'>Only you have access.</p>
            ) : (
              <div className='max-h-60 space-y-3.5 overflow-y-auto pr-1'>
                {shares.map(share => {
                  const label = share.userGroupId
                    ? (share.userGroup?.name ?? share.userGroupId)
                    : share.channelId
                      ? (share.channel?.name ?? share.channelId)
                      : share.user
                        ? getUserDisplayName(share.user)
                        : share.userId;
                  const icon = share.userGroupId ? (
                    <Users className='size-4 shrink-0 text-muted-foreground' />
                  ) : share.channelId ? (
                    <Hash className='size-4 shrink-0 text-muted-foreground' />
                  ) : (
                    <Avatar userId={share.userId} size='sm' showActiveStatus={false} />
                  );
                  return (
                    <div key={share.id} className='group flex items-center justify-between gap-2'>
                      <div className='flex min-w-0 items-center gap-2'>
                        {icon}
                        <span className='truncate text-sm'>{label}</span>
                      </div>
                      <button
                        type='button'
                        onClick={() => void handleRevoke(share)}
                        disabled={revokingId === share.id}
                        className='shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground disabled:opacity-50 group-hover:opacity-100'
                        aria-label='Remove access'
                        data-track-category='SummaryTemplates'
                        data-track-name='RevokeTemplateShare'
                      >
                        {revokingId === share.id ? (
                          <LoaderCircle className='size-3.5 animate-spin' />
                        ) : (
                          <X className='size-3.5' />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className='border-t border-border pt-4'>
        {template.visibility === 'PRIVATE' && isOwner && (
          <div className='rounded-xl border border-border p-4'>
            <div className='flex gap-3'>
              <Globe2 className='mt-0.5 size-5 shrink-0 text-muted-foreground' />
              <div className='min-w-0'>
                <p className='font-medium'>Publish template</p>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {isAdmin
                    ? 'Public templates can be used by anyone in this workspace. As a Scribe admin, you can publish directly.'
                    : 'Public templates can be used by anyone in this workspace. A Scribe admin reviews it first.'}
                </p>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='mt-3'
                  loading={publicationAction === (isAdmin ? 'publish' : 'request')}
                  disabled={loading || (!isAdmin && admins.length === 0)}
                  onClick={() => void handlePublication(isAdmin ? 'publish' : 'request')}
                  data-track-category='SummaryTemplates'
                  data-track-name={
                    isAdmin ? 'PublishTemplateDirectly' : 'RequestTemplatePublication'
                  }
                >
                  {isAdmin ? 'Make public' : 'Send to admin for review'}
                </Button>
                {!loading && !isAdmin && admins.length === 0 && (
                  <p className='mt-2 text-xs text-muted-foreground'>
                    No Scribe admins are configured for this workspace.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {template.visibility === 'WAITING_FOR_APPROVAL' && (
          <div className='rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-700 dark:bg-amber-950/20'>
            <div className='flex gap-3'>
              <Clock3 className='mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400' />
              <div className='min-w-0 flex-1'>
                <p className='font-medium text-amber-900 dark:text-amber-200'>
                  Pending admin review
                </p>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Once a Scribe admin approves it, this template becomes public.
                </p>
                {showAdmins && admins.length > 0 && (
                  <div className='mt-3 space-y-2'>
                    {admins.map(admin => (
                      <div
                        key={admin.id}
                        className='flex items-center justify-between gap-3 text-sm'
                      >
                        <span className='truncate'>
                          {admin.name || admin.email || 'Scribe admin'}
                        </span>
                        <span className='shrink-0 text-xs text-muted-foreground'>Scribe admin</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className='mt-3 flex flex-wrap items-center gap-2'>
                  {admins.length > 0 && (
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => setShowAdmins(value => !value)}
                    >
                      {showAdmins ? 'Hide admins' : 'Show admins'}
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      type='button'
                      variant='link'
                      size='sm'
                      loading={publicationAction === 'withdraw'}
                      onClick={() => void handlePublication('withdraw')}
                      data-track-category='SummaryTemplates'
                      data-track-name='WithdrawTemplatePublication'
                    >
                      Withdraw request
                    </Button>
                  )}
                  {canReview && (
                    <>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        loading={publicationAction === 'deny'}
                        onClick={() => void handlePublication('deny')}
                        data-track-category='SummaryTemplates'
                        data-track-name='DenyTemplatePublication'
                      >
                        Deny
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        loading={publicationAction === 'approve'}
                        onClick={() => void handlePublication('approve')}
                        data-track-category='SummaryTemplates'
                        data-track-name='ApproveTemplatePublication'
                      >
                        Approve and publish
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {template.visibility === 'PUBLIC' && (
          <div className='flex gap-3 rounded-xl border border-border p-4'>
            <span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'>
              <Check className='size-4' />
            </span>
            <div>
              <p className='font-medium'>Public template</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                Anyone in this workspace can see and use this template.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SummaryTemplateShareModal;
