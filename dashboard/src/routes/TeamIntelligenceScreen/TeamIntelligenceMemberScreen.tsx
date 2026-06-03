import MemberAchievements from '@/components/TeamIntelligence/MemberAchievements';
import MemberHeader from '@/components/TeamIntelligence/MemberHeader';
import MemberQuickInsights from '@/components/TeamIntelligence/MemberQuickInsights';
import { useMemberDetails, useMemberInsights } from '@/hooks/useTeamIntelligence';
import { ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from './TeamIntelligenceScreen';
import { Loader2Icon } from 'lucide-react';
import MemberTickets from '@/components/TeamIntelligence/MemberTickets';

const TeamIntelligenceMemberScreen = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { memberEmail } = useParams<{ memberEmail: string }>();

  const { data: memberData, isLoading: isLoadingMemberData } = useMemberDetails(memberEmail!);

  const { data: memberInsights, isLoading: isLoadingMemberInsights } = useMemberInsights(
    memberEmail!,
    {
      from: dateRange.from,
      to: dateRange.to,
    },
  );

  if (isLoadingMemberData || isLoadingMemberInsights) {
    return (
      <div className='h-full flex items-center justify-center bg-background'>
        <Loader2Icon className='animate-spin text-muted-foreground' />
        <p className='text-muted-foreground'>Loading member details...</p>
      </div>
    );
  }

  if (!memberInsights || !memberData) {
    return (
      <div className='h-full flex items-center justify-center bg-background'>
        <p className='text-muted-foreground'>Member not found.</p>
      </div>
    );
  }

  return (
    <div className='flex-1 w-full flex flex-col mx-auto max-w-6xl px-6 py-8 space-y-12'>
      <MemberHeader member={memberData} />
      <MemberQuickInsights member={memberInsights} />
      <MemberAchievements member={memberInsights} />
      <MemberTickets tickets={memberInsights.tickets || []} />
    </div>
  );
};

export default TeamIntelligenceMemberScreen;
