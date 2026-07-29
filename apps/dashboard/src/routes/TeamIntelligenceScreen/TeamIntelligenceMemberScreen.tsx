import MemberAchievements from '@/components/TeamIntelligence/MemberAchievements';
import MemberHeader from '@/components/TeamIntelligence/MemberHeader';
import MemberQuickInsights from '@/components/TeamIntelligence/MemberQuickInsights';
import { useMemberDetails } from '@/hooks/useTeamIntelligence';
import { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import MemberTickets from '@/components/TeamIntelligence/MemberTickets';

const TeamIntelligenceMemberScreen = (): ReactElement => {
  const { memberEmail } = useParams<{ memberEmail: string }>();

  const { data: memberData, isLoading: isLoadingMemberData } = useMemberDetails(memberEmail!);

  if (isLoadingMemberData) {
    return (
      <div className='h-full flex items-center justify-center bg-background'>
        <Loader2Icon className='animate-spin text-muted-foreground' />
        <p className='text-muted-foreground'>Loading member details...</p>
      </div>
    );
  }

  if (!memberData) {
    return (
      <div className='h-full flex items-center justify-center bg-background'>
        <p className='text-muted-foreground'>Member not found.</p>
      </div>
    );
  }

  return (
    <div className='flex-1 w-full flex flex-col mx-auto max-w-6xl px-6 py-8 space-y-12'>
      <MemberHeader member={memberData} />
      <MemberQuickInsights />
      <MemberAchievements />
      <MemberTickets />
    </div>
  );
};

export default TeamIntelligenceMemberScreen;
