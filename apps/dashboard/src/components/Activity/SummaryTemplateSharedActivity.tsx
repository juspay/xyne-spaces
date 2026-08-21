import type { ReactElement } from 'react';
import { Share01 } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ActivityItemCard } from './ActivityItemCard';

export function SummaryTemplateSharedActivity({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null {
  const templateId = activity.actionSourceId;
  const actorId = activity.actorId ?? '';
  const sender = useUser(actorId);

  if (!templateId) return null;

  const isRevoked = activity.actorAction === 'summary_template_access_revoked';
  const targetPath = `/recordings?templates=1&summaryTemplateId=${encodeURIComponent(templateId)}`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Share01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={
        <span className='text-sm text-muted-foreground'>
          {isRevoked
            ? 'removed your access to a summary template'
            : 'shared a summary template with you'}
        </span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
    >
      <div className='text-sm text-muted-foreground'>
        {isRevoked ? 'View summary templates' : 'View shared summary template'}
      </div>
    </ActivityItemCard>
  );
}

export default SummaryTemplateSharedActivity;
