import { useTheme } from '@/hooks/useTheme';
import { TeamMember } from '@/services/TeamIntelligence/teamIntelligenceService';
import { extractInitials, getTeamColor } from '@/utils/teamIntelligenceUtils';
import { ChevronRightIcon } from 'lucide-react';
import { ReactElement } from 'react';
import { Link } from 'react-router-dom';

const TeamMemberCard = ({ member }: { member: TeamMember }): ReactElement => {
  const { theme } = useTheme();
  const initials = extractInitials(member.name);
  const memberColor = getTeamColor(member.email);
  const accentColor = theme === 'midnight' ? memberColor.accentDark : memberColor.accentLight;
  const primary = theme === 'midnight' ? memberColor.accentLight : memberColor.primary;

  return (
    <Link
      key={member.email}
      to={`/team-intelligence/member/${member.email}`}
      data-track-category='team-intelligence'
      data-track-name={`member-${member.email}`}
      className='group block rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-action-accent'
    >
      <div className='flex items-start gap-4'>
        <div
          className='flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-foreground font-medium'
          style={{ backgroundColor: accentColor, color: primary }}
        >
          {initials}
        </div>
        <div className='flex-1 space-y-2 min-w-0'>
          <div className='flex items-start justify-between gap-2'>
            <div>
              <h4 className='font-medium text-foreground'>{member.name}</h4>
              <p className='text-xs text-muted-foreground'>{member.designation}</p>
            </div>
          </div>
          <div className='flex items-center gap-1 text-xs text-action-accent'>
            <span>Learn more</span>
            <ChevronRightIcon className='h-3 w-3 transition-transform group-hover:translate-x-0.5' />
          </div>
        </div>
      </div>
    </Link>
  );
};

export default TeamMemberCard;
