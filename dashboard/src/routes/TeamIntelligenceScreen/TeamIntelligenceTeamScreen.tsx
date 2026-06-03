import TeamAccomplishments from '@/components/TeamIntelligence/TeamAccomplishments';
import TeamHeader from '@/components/TeamIntelligence/TeamHeader';
import { ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { useTeamHighlights, useTeamMembers, useTeams } from '@/hooks/useTeamIntelligence';
import TeamQuickInsights from '@/components/TeamIntelligence/TeamQuickInsights';
import { TeamIntelligenceOutletContext } from './TeamIntelligenceScreen';
import { Loader2 } from 'lucide-react';
import TeamMembers from '@/components/TeamIntelligence/TeamMembers';
import TeamRecaps from '@/components/TeamIntelligence/TeamRecaps';
import TeamOverdueTickets from '@/components/TeamIntelligence/TeamOverdueTickets';

const TeamIntelligenceTeamScreen = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { teamId } = useParams<{ teamId: string }>();

  const { data: teams, isLoading: isLoadingTeams } = useTeams();
  const team = teams?.data.find(t => t.id === teamId);

  const { data: teamHighlights, isLoading: isLoadingHighlights } = useTeamHighlights(teamId!, {
    from: dateRange.from,
    to: dateRange.to,
  });

  const { data: teamMembers, isLoading: isLoadingMembers } = useTeamMembers(teamId!);

  if (isLoadingTeams || isLoadingHighlights || isLoadingMembers) {
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
      <TeamAccomplishments data={teamHighlights?.bullets || []} />
      <TeamRecaps />
      <TeamOverdueTickets />
      {teamMembers && teamMembers?.employee_list?.length > 0 && (
        <TeamMembers teamMembers={teamMembers} />
      )}
    </div>
  );
};

export default TeamIntelligenceTeamScreen;
