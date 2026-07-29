// import OrgConversations from '@/components/TeamIntelligence/OrgConversations';
import OrgGreeting from '@/components/TeamIntelligence/OrgGreeting';
import OrgHighlights from '@/components/TeamIntelligence/OrgHighlights';
import OrgQuickInsights from '@/components/TeamIntelligence/OrgQuickInsights';
import OrgTeams from '@/components/TeamIntelligence/OrgTeams';
import OrgTicketRecaps from '@/components/TeamIntelligence/OrgTicketRecaps';
import { TeamIntelligenceOutletContext } from './TeamIntelligenceScreen';
import { ReactElement } from 'react';
import { useOutletContext } from 'react-router-dom';

const TeamIntelligenceOrgScreen = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();

  return (
    <div className='flex-1 w-full flex flex-col mx-auto max-w-6xl px-6 py-8 space-y-16'>
      <OrgGreeting dateRange={dateRange} />
      <OrgQuickInsights />
      <OrgHighlights />
      <OrgTicketRecaps />
      <OrgTeams />
    </div>
  );
};

export default TeamIntelligenceOrgScreen;
