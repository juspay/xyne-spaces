import TeamAccomplishments from '@/components/TeamIntelligence/TeamAccomplishments';
import TeamHeader from '@/components/TeamIntelligence/TeamHeader';
import { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTeams } from '@/hooks/useTeamIntelligence';
import TeamQuickInsights from '@/components/TeamIntelligence/TeamQuickInsights';
import { Loader2 } from 'lucide-react';
import TeamMembers from '@/components/TeamIntelligence/TeamMembers';
import TeamRecaps from '@/components/TeamIntelligence/TeamRecaps';
import TeamOverdueTickets from '@/components/TeamIntelligence/TeamOverdueTickets';

const TeamIntelligenceTeamScreen = (): ReactElement => {
  const { teamId } = useParams<{ teamId: string }>();

  const { data: teams, isLoading: isLoadingTeams } = useTeams();
  const team = teams?.data?.find(t => t.id === teamId);

  if (isLoadingTeams) {
    return (
      <div className='h-full flex items-center justify-center gap-1'>
        <Loader2 size={16} className='animate-spin text-muted-foreground' />
        <p className='text-muted-foreground'>Loading team details...</p>
      </div>
    );
  }

  if (!team) {
    return (
      <div className='h-full flex items-center justify-center gap-1'>
        <p className='text-muted-foreground'>Team not found.</p>
      </div>
    );
  }

  return (
    <div className='flex-1 w-full flex flex-col mx-auto max-w-6xl px-6 py-8 space-y-16'>
      <TeamHeader team={team} />
      <TeamQuickInsights />
      <TeamAccomplishments />
      <TeamRecaps />
      <TeamOverdueTickets />
      <TeamMembers />
    </div>
  );
};

export default TeamIntelligenceTeamScreen;
