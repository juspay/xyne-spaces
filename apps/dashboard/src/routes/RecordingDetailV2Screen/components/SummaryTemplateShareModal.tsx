import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { CheckTickSingle, ClockDefault, Globe } from '@xyne/icons';
import { EntityUserAccess } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button/Button';
import {
  EntityShareModal,
  type EntityShareEntry,
  type EntityShareTarget,
} from '../../../components/Share/EntityShareModal';
import { useAuth } from '../../../hooks/useAuth';
import {
  recordingService,
  type SummaryTemplate,
  type SummaryTemplatePublicationAdmin,
  type SummaryTemplatePublicationAction,
  type SummaryTemplateShare,
} from '../../../services/Recording/recordingService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface SummaryTemplateShareModalProps {
  template: SummaryTemplate;
  onTemplateChange?: (template: SummaryTemplate) => void;
}

/** Row action sized for the popover rather than a full-width dialog. */
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

const toShareTarget = (share: SummaryTemplateShare): EntityShareTarget =>
  share.userGroupId
    ? { type: 'user_group', id: share.userGroupId }
    : share.channelId
      ? { type: 'channel', id: share.channelId }
      : { type: 'user', id: share.userId! };

const toShareEntry = (share: SummaryTemplateShare): EntityShareEntry => ({
  id: share.id,
  label: share.userGroupId
    ? (share.userGroup?.name ?? share.userGroupId)
    : share.channelId
      ? (share.channel?.name ?? share.channelId)
      : share.user
        ? getUserDisplayName(share.user)
        : (share.userId ?? ''),
  userId: share.userId,
  target: toShareTarget(share),
  // A template share is silent: it grants access and notifies, and posts nothing.
  post: null,
  // Shares made before sharing meant editing are still VIEW.
  access:
    share.entityUserAccess === EntityUserAccess.EDIT
      ? EntityUserAccess.EDIT
      : EntityUserAccess.VIEW,
});

/** Summary templates binding for {@link EntityShareModal}, plus publication controls. */
export function SummaryTemplateShareModal({
  template,
  onTemplateChange,
}: SummaryTemplateShareModalProps): ReactElement {
  const { user: currentUser } = useAuth();
  const [shares, setShares] = useState<SummaryTemplateShare[]>([]);
  const [admins, setAdmins] = useState<SummaryTemplatePublicationAdmin[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
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

  const shareEntries = useMemo(() => shares.map(toShareEntry), [shares]);

  // EntityShareModal owns the success and failure toasts for a grant.
  const handleGrant = async (targets: EntityShareTarget[]): Promise<void> => {
    const result = await recordingService.grantSummaryTemplateAccess(template.id, targets);
    setShares(result.shares);
  };

  const handleRevoke = async (target: EntityShareTarget): Promise<void> => {
    try {
      const result = await recordingService.revokeSummaryTemplateAccess(template.id, [target]);
      setShares(result.shares);
      toast.success('Access removed');
    } catch (error) {
      toast.error('Failed to remove access', {
        description: getApiErrorMessage(error, 'Unable to remove template access'),
      });
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
      <p className='p-5 text-xs text-muted-foreground'>
        Only the template creator or a Scribe admin can manage this template.
      </p>
    );
  }

  const publication = (
    <>
      {template.visibility === 'PRIVATE' && isOwner && (
        <div className='flex shrink-0 items-start gap-2'>
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
        <div className='flex shrink-0 items-start gap-2'>
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
                  data-track-category='SummaryTemplates'
                  data-track-name='ToggleTemplateAdmins'
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
        <div className='flex shrink-0 items-start gap-2'>
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
    </>
  );

  // Sharing is owner-only, so a reviewing admin gets just the publication controls.
  if (!isOwner) return <div className='p-5'>{publication}</div>;

  return (
    <EntityShareModal
      ownerId={template.createdBy}
      ownerLabel={`${getUserDisplayName(currentUser)} (me)`}
      shares={shareEntries}
      onGrant={handleGrant}
      onRevoke={handleRevoke}
      subject='template'
      trackCategory='SummaryTemplates'
      withMessage={false}
      generalAccess={<div className='border-t border-border pt-3'>{publication}</div>}
    />
  );
}

export default SummaryTemplateShareModal;
