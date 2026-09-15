import { MemberLeadershipDashboard } from '@/components/TeamIntelligence/LeadershipDashboard';
import { useMemberDetails, useUserLeadershipSnapshots } from '@/hooks/useTeamIntelligence';
import { ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from './TeamIntelligenceScreen';

const TeamIntelligenceMemberScreen = (): ReactElement => {
  const { memberEmail } = useParams<{ memberEmail: string }>();
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();

  const {
    data: memberData,
    isLoading: isLoadingMemberData,
    isError: isMemberError,
  } = useMemberDetails(memberEmail ?? '');
  const {
    data: snapshotsData,
    isLoading: isLoadingSnapshots,
    isError: isSnapshotError,
  } = useUserLeadershipSnapshots(memberEmail ?? '', dateRange);
  const snapshot = snapshotsData?.snapshots[0] ?? null;

  if (!memberEmail) {
    return (
      <div className='h-full flex items-center justify-center bg-background'>
        <p className='text-muted-foreground'>Member not found.</p>
      </div>
    );
  }

  return (
    <MemberLeadershipDashboard
      snapshot={snapshot}
      member={memberData}
      isLoading={isLoadingMemberData || isLoadingSnapshots}
      isError={isMemberError || isSnapshotError}
      sectionRequest={{ scope: 'user', userEmail: memberEmail, ...dateRange }}
    />
  );
};

export default TeamIntelligenceMemberScreen;
