import { ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { TeamLeadershipDashboard } from '@/components/TeamIntelligence/LeadershipDashboard';
import { useTeamLeadershipSnapshots } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from './TeamIntelligenceScreen';

const TeamIntelligenceTeamScreen = (): ReactElement => {
  const { teamId } = useParams<{ teamId: string }>();
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { data, isLoading, isError } = useTeamLeadershipSnapshots(teamId ?? '', dateRange);
  const snapshot = data?.snapshots[0] ?? null;

  if (!teamId) {
    return (
      <div className='h-full flex items-center justify-center gap-1'>
        <p className='text-muted-foreground'>Team not found.</p>
      </div>
    );
  }

  return (
    <TeamLeadershipDashboard
      snapshot={snapshot}
      isLoading={isLoading}
      isError={isError}
      teamId={teamId}
      sectionRequest={{ scope: 'team', teamId, ...dateRange }}
    />
  );
};

export default TeamIntelligenceTeamScreen;
