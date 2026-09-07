import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Globe, Link2, Lock } from 'lucide-react';
import { CallVisibility } from '@xyne/shared';
import { Switch } from '../../../components/ui/Switch';
import {
  EntityShareModal,
  type EntityShareEntry,
} from '../../../components/Share/EntityShareModal';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { queries } from '../../../zero/queries';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  recordingService,
  type RecordingDetail,
  type RecordingShareTarget,
  type RecordingTicketLinkState,
} from '../../../services/Recording/recordingService';
import { getApiErrorMessage } from '../../../utils/apiError';
import {
  getRecordingSharePost,
  isRecordingTicketLinkShare,
  logRecordingError,
} from '../../../utils/recordingUtils';

export interface RecordingShareModalProps {
  recording: Pick<RecordingDetail, 'externalId' | 'createdByUserId'>;
  onClose?: () => void;
  onTicketLinkUpdated?: (ticketLink: RecordingTicketLinkState) => void;
}

/**
 * Recordings binding for {@link EntityShareModal}: the recordings share endpoints,
 * plus the link-access section, which only recordings have (a regular call is not
 * reachable by link — see calls-acl).
 */
export const RecordingShareModal: React.FC<RecordingShareModalProps> = ({
  recording,
  onClose,
  onTicketLinkUpdated,
}) => {
  const { user: currentUser } = useAuth();
  const shareableOrigin = useShareableOrigin();
  const isCreator = currentUser?.id === recording.createdByUserId;

  const [locallyRevokedShareIds, setLocallyRevokedShareIds] = useState<Set<string>>(new Set());
  const [visibilityOverride, setVisibilityOverride] = useState<CallVisibility | null>(null);

  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recording.externalId }),
  );
  const visibility = visibilityOverride ?? recordingRow?.visibility ?? CallVisibility.PRIVATE;
  const isPublic = visibility === CallVisibility.PUBLIC;

  const shares = useMemo<EntityShareEntry[]>(
    () =>
      (recordingRow?.shares ?? [])
        .filter(
          share =>
            !locallyRevokedShareIds.has(share.id) && !isRecordingTicketLinkShare(share.metadata),
        )
        .map(share => {
          const target: RecordingShareTarget = share.userGroupId
            ? { type: 'user_group', id: share.userGroupId }
            : share.channelId
              ? { type: 'channel', id: share.channelId }
              : { type: 'user', id: share.userId! };
          const label = share.userGroupId
            ? (share.userGroup?.name ?? share.userGroupId)
            : share.channelId
              ? (share.channel?.name ?? share.channelId)
              : share.user
                ? getUserDisplayName(share.user)
                : (share.userId ?? '');
          const post = getRecordingSharePost(share.metadata);
          return {
            id: share.id,
            label,
            userId: share.userId ?? null,
            target,
            post: post ? { channelId: post.channelId, conversationId: post.conversationId } : null,
          };
        }),
    [locallyRevokedShareIds, recordingRow],
  );

  const handleGrant = async (
    targets: RecordingShareTarget[],
    messageContent: string,
  ): Promise<void> => {
    try {
      const result = await recordingService.grantRecordingAccess(
        recording.externalId,
        targets,
        undefined,
        messageContent,
      );
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.delete(share.id));
          return next;
        });
      }
    } catch (error) {
      logRecordingError('RecordingShareModal.share', error);
      throw error;
    }
  };

  const handleRevoke = async (target: RecordingShareTarget): Promise<void> => {
    try {
      const result = await recordingService.revokeRecordingAccess(recording.externalId, [target]);
      if (result.shares?.length) {
        setLocallyRevokedShareIds(current => {
          const next = new Set(current);
          result.shares?.forEach(share => next.add(share.id));
          return next;
        });
      }
      if (result.linkedTicketId === null) {
        onTicketLinkUpdated?.({ linkedTicketId: null, linkedTicketMessageId: null });
      }
    } catch (error) {
      logRecordingError('RecordingShareModal.revoke', error);
      toast.error('Failed to remove access', {
        description: getApiErrorMessage(error, 'Unable to remove recording access'),
      });
    }
  };

  const handleVisibilityChange = async (next: CallVisibility): Promise<void> => {
    if (next === visibility) return;
    setVisibilityOverride(next);
    try {
      await recordingService.setRecordingVisibility(recording.externalId, next);
      toast.success(
        next === CallVisibility.PUBLIC
          ? 'Anyone in the workspace with the link can now view'
          : 'Link access turned off',
      );
    } catch (error) {
      setVisibilityOverride(null);
      logRecordingError('RecordingShareModal.setVisibility', error);
      toast.error('Failed to update link access', {
        description: getApiErrorMessage(error, 'Unable to update recording link access'),
      });
    }
  };

  const handleCopyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${shareableOrigin}/recordings/${recording.externalId}`);
      toast.success('Link copied');
    } catch (error) {
      logRecordingError('RecordingShareModal.handleCopyLink', error);
      toast.error('Failed to copy link');
    }
  };

  const generalAccess = (
    <div className='space-y-2 border-t border-border pt-3'>
      <p className='text-muted-foreground text-[13px]'>General access</p>
      <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5'>
        <span className='w-9 h-9 rounded-full bg-background border border-border grid place-items-center shrink-0 text-muted-foreground'>
          {isPublic ? <Globe className='w-4 h-4' /> : <Lock className='w-4 h-4' />}
        </span>
        <div className='min-w-0 flex-1'>
          <div className='text-sm font-medium'>
            {isPublic ? 'Anyone with the link' : 'Restricted'}
          </div>
          <div className='text-xs text-muted-foreground mt-0.5'>
            {isPublic
              ? 'Anyone in the workspace with the link can view'
              : 'Only people with access can open'}
          </div>
        </div>
        {isCreator && (
          <Switch
            checked={isPublic}
            onCheckedChange={checked =>
              void handleVisibilityChange(checked ? CallVisibility.PUBLIC : CallVisibility.PRIVATE)
            }
            aria-label='Anyone with the link'
            id='recording-visibility-toggle'
          />
        )}
      </div>
      {isPublic && (
        <div className='flex justify-end'>
          <button
            type='button'
            onClick={() => void handleCopyLink()}
            className='inline-flex items-center gap-2 text-sm font-medium text-foreground rounded-md px-2.5 py-1.5 -mr-2.5 transition-colors hover:bg-accent hover:text-primary'
            data-testid='recording-copy-link-button'
            data-track-category='RecordingDetailV2'
            data-track-name='copy_recording_link'
          >
            <Link2 className='w-4 h-4' />
            Copy link
          </button>
        </div>
      )}
    </div>
  );

  return (
    <EntityShareModal
      ownerId={recording.createdByUserId}
      shares={shares}
      onGrant={handleGrant}
      onRevoke={handleRevoke}
      subject='recording'
      trackCategory='RecordingDetailV2'
      generalAccess={generalAccess}
      {...(onClose && { onClose })}
    />
  );
};

export default RecordingShareModal;
