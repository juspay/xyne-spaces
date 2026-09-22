import { OrgLeadershipDashboard } from '@/components/TeamIntelligence/LeadershipDashboard';
import { useOrgLeadershipSnapshots } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from './TeamIntelligenceScreen';
import { ReactElement } from 'react';
import { useOutletContext } from 'react-router-dom';

const TeamIntelligenceOrgScreen = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { data, isLoading, isError } = useOrgLeadershipSnapshots({
    params: dateRange,
  });
  const snapshot = data?.snapshots[0] ?? null;

  return (
    <OrgLeadershipDashboard
      snapshot={snapshot}
      isLoading={isLoading}
      isError={isError}
      sectionRequest={{ scope: 'org', ...dateRange }}
    />
  );
};

export default TeamIntelligenceOrgScreen;
