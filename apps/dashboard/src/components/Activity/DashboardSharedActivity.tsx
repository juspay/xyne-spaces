import { ReactElement } from 'react';
import { BubbleChart } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

const DESCRIPTION: Record<string, string> = {
  dashboard_shared: 'shared a dashboard with you',
  dashboard_access_changed: 'changed your access to a dashboard',
  dashboard_access_revoked: 'removed your access to a dashboard',
};

/**
 * Renders a Xyne Dashboards sharing activity:
 * - dashboard_shared:         "X shared a dashboard with you"        + "Open dashboard: <name>"
 * - dashboard_access_changed: "X changed your access to a dashboard" + "Open dashboard: <name>"
 * - dashboard_access_revoked: "X removed your access to a dashboard" + "Dashboard: <name>"
 *
 * Clicking opens /xyne-dashboards/:dashboardId, or the dashboards list once access is gone. The
 * dashboard's name only resolves while the person can still read it.
 */
export const DashboardSharedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const dashboardId = activity.dashboardId ?? undefined;
  const actorId = activity.actorId ?? '';
  const sender = useUser(actorId);

  if (!dashboardId) return null;

  const isRevoked = activity.actorAction === 'dashboard_access_revoked';
  const targetPath = isRevoked ? '/xyne-dashboards' : `/xyne-dashboards/${dashboardId}`;
  const name = activity.dashboard?.name || 'Untitled dashboard';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<BubbleChart className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={
        <span className='text-sm text-muted-foreground'>
          {DESCRIPTION[activity.actorAction] ?? DESCRIPTION['dashboard_shared']}
        </span>
      }
      targetPath={targetPath}
      supportTargetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-sm text-muted-foreground'>
        {isRevoked ? 'Dashboard' : 'Open dashboard'}: {name}
      </div>
    </ActivityItemCard>
  );
};

export default DashboardSharedActivity;
