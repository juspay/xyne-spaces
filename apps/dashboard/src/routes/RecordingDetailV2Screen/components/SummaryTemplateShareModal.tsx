import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  CheckTickSingle,
  ClockDefault,
  Globe,
  Hashtag,
  MultipleCrossCancelDefault,
  Spinner,
  UserTwo,
} from '@xyne/icons';
import { toast } from 'sonner';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { UnifiedParticipantSearch } from '../../../components/ui/UnifiedParticipantSearch/UnifiedParticipantSearch';
import { useAuth } from '../../../hooks/useAuth';
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

interface SummaryTemplateShareModalProps {
  template: SummaryTemplate;
  onTemplateChange?: (template: SummaryTemplate) => void;
  onSharesChange?: (count: number) => void;
}

/** Section caption shared by the popover's grouped lists. */
const SECTION_LABEL_CLASS =
  'mb-1 mt-3 shrink-0 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

/** Row action sized for the popover rather than the old full-width dialog. */
const INLINE_ACTION_CLASS = 'h-7 gap-1.5 rounded-lg px-2.5 text-xs font-medium';

/** Success copy per publication action; keyed so the union stays exhaustive. */
const PUBLICATION_TOAST: Record<SummaryTemplatePublicationAction, string> = {
  request: 'Sent to Scribe admins for review',
  publish: 'Template published',
  withdraw: 'Publication request withdrawn',
  approve: 'Template published',
  deny: 'Publication request denied',
  unpublish: 'Template is now private',
};

export function SummaryTemplateShareModal({
  template,
  onTemplateChange,
  onSharesChange,
}: SummaryTemplateShareModalProps): ReactElement {
  const { user: currentUser } = useAuth();
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

  useEffect(() => {
    if (!loading) onSharesChange?.(shares.length);
  }, [loading, onSharesChange, shares.length]);

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

  const excludedUserIds = useMemo(
    () => new Set([template.createdBy, ...sharedUserIds]),
    [sharedUserIds, template.createdBy],
  );

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
      toast.success(PUBLICATION_TOAST[action]);
    } catch (error) {
      toast.error('Unable to update publication status', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setPublicationAction(null);
    }
  };

  const canReview = isAdmin && template.visibility === 'WAITING_FOR_APPROVAL';
  const canUnpublish = template.visibility === 'PUBLIC' && (isOwner || isAdmin);

  if (!currentUser || (!isOwner && !canReview && !canUnpublish)) {
    return (
      <p className='px-0.5 py-1 text-xs text-muted-foreground'>
        Only the template creator or a Scribe admin can manage this template.
      </p>
    );
  }

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col'>
      <p className='mb-2 shrink-0 px-0.5 text-sm font-semibold'>Share template</p>

      {isOwner && (
        <>
          <UnifiedParticipantSearch
            selectedValues={selectedValues}
            onMultiSelect={setSelectedValues}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            excludedUserIds={excludedUserIds}
            excludedUserGroupIds={sharedUserGroupIds}
            excludedChannelIds={sharedChannelIds}
            exclusiveSelection={false}
          />
          {selectedValues.length > 0 && (
            <Button
              size='sm'
              onClick={() => void handleShare()}
              disabled={sharing}
              className='mt-2 h-8 w-full rounded-lg text-xs font-medium'
              data-track-category='SummaryTemplates'
              data-track-name='ShareTemplateConfirm'
            >
              {sharing
                ? 'Sharing…'
                : selectedValues.length === 1
                  ? 'Share with 1 recipient'
                  : `Share with ${selectedValues.length} recipients`}
            </Button>
          )}

          <p className={SECTION_LABEL_CLASS}>Who has access</p>
          <div className='thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain'>
            <div className='flex items-center gap-2 px-0.5 py-1'>
              <Avatar userId={template.createdBy} size='sm' rounded showActiveStatus={false} />
              <span className='min-w-0 flex-1 truncate text-sm'>
                {getUserDisplayName(currentUser)} (me)
              </span>
              <span className='shrink-0 text-xs text-muted-foreground'>Owner</span>
            </div>

            {loading ? (
              <p className='flex items-center gap-2 px-0.5 py-1 text-xs text-muted-foreground'>
                <Spinner className='size-3.5 animate-spin' /> Loading…
              </p>
            ) : (
              shares.map(share => {
                const label = share.userGroupId
                  ? (share.userGroup?.name ?? share.userGroupId)
                  : share.channelId
                    ? (share.channel?.name ?? share.channelId)
                    : share.user
                      ? getUserDisplayName(share.user)
                      : share.userId;
                const icon = share.userGroupId ? (
                  <UserTwo className='size-4 shrink-0 text-muted-foreground' />
                ) : share.channelId ? (
                  <Hashtag className='size-4 shrink-0 text-muted-foreground' />
                ) : (
                  <Avatar userId={share.userId} size='sm' rounded showActiveStatus={false} />
                );
                return (
                  <div key={share.id} className='group flex items-center gap-2 px-0.5 py-1'>
                    {icon}
                    <span className='min-w-0 flex-1 truncate text-sm'>{label}</span>
                    <Button
                      type='button'
                      variant='ghost'
                      size='iconSm'
                      onClick={() => void handleRevoke(share)}
                      disabled={revokingId === share.id}
                      className='size-6 shrink-0 rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
                      aria-label='Remove access'
                      data-track-category='SummaryTemplates'
                      data-track-name='RevokeTemplateShare'
                    >
                      {revokingId === share.id ? (
                        <Spinner className='size-3 animate-spin' />
                      ) : (
                        <MultipleCrossCancelDefault className='size-3' />
                      )}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Full-bleed rule, matching the reference's negative side margins. */}
      <div className='-mx-3 my-2.5 h-px shrink-0 bg-border' />

      {template.visibility === 'PRIVATE' && isOwner && (
        <div className='flex shrink-0 items-start gap-2 px-0.5'>
          <span className='mt-px shrink-0 text-muted-foreground'>
            <Globe className='size-4' />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium'>Publish template</p>
            <p className='mt-px text-xs leading-normal text-muted-foreground'>
              {isAdmin
                ? 'Public templates can be used by anyone in this workspace. As a Scribe admin, you can publish directly.'
                : 'Public templates can be used by anyone in this workspace. A Scribe admin reviews it first.'}
            </p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className={`mt-2 ${INLINE_ACTION_CLASS} text-muted-foreground`}
              loading={publicationAction === (isAdmin ? 'publish' : 'request')}
              disabled={loading || (!isAdmin && admins.length === 0)}
              onClick={() => void handlePublication(isAdmin ? 'publish' : 'request')}
              data-track-category='SummaryTemplates'
              data-track-name={isAdmin ? 'PublishTemplateDirectly' : 'RequestTemplatePublication'}
            >
              {isAdmin ? 'Make public' : 'Send to admin for review'}
            </Button>
            {!loading && !isAdmin && admins.length === 0 && (
              <p className='mt-1.5 text-xs text-muted-foreground'>
                No Scribe admins are configured for this workspace.
              </p>
            )}
          </div>
        </div>
      )}

      {template.visibility === 'WAITING_FOR_APPROVAL' && (
        <div className='flex shrink-0 items-start gap-2 px-0.5'>
          <span className='mt-px shrink-0 text-status-pending'>
            <ClockDefault className='size-4' />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium'>Pending admin review</p>
            <p className='mt-px text-xs leading-normal text-muted-foreground'>
              Once a Scribe admin approves it, this template becomes public.
            </p>

            {showAdmins && admins.length > 0 && (
              <div className='mt-2 flex flex-col'>
                {admins.map(admin => (
                  <div key={admin.id} className='flex items-center gap-2 py-1'>
                    <span className='min-w-0 flex-1 truncate text-sm'>
                      {admin.name || admin.email || 'Scribe admin'}
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground'>Scribe admin</span>
                  </div>
                ))}
              </div>
            )}

            <div className='mt-2 flex flex-wrap items-center gap-2'>
              {admins.length > 0 && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setShowAdmins(value => !value)}
                  className={`${INLINE_ACTION_CLASS} text-muted-foreground`}
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
                  className='h-7 px-0 text-xs font-medium'
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
                    className={`${INLINE_ACTION_CLASS} text-muted-foreground`}
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
                    className={`${INLINE_ACTION_CLASS} bg-foreground text-background hover:bg-foreground/90`}
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
      )}

      {template.visibility === 'PUBLIC' && (
        <div className='flex shrink-0 items-start gap-2 px-0.5'>
          <span className='mt-px shrink-0 text-status-success'>
            <CheckTickSingle className='size-4' />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium'>Public template</p>
            <p className='mt-px text-xs leading-normal text-muted-foreground'>
              Anyone in this workspace can see and use this template.
            </p>
            {canUnpublish && (
              <>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className={`mt-2 ${INLINE_ACTION_CLASS} text-muted-foreground`}
                  loading={publicationAction === 'unpublish'}
                  disabled={loading}
                  onClick={() => void handlePublication('unpublish')}
                  data-track-category='SummaryTemplates'
                  data-track-name='UnpublishTemplate'
                >
                  Make private
                </Button>
                <p className='mt-1.5 text-xs text-muted-foreground'>
                  The owner and anyone it is explicitly shared with keep access.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SummaryTemplateShareModal;
