import { TeamMember } from '@/services/TeamIntelligence/teamIntelligenceService';
import { cn } from '@/utils/classNames';
import { extractInitials } from '@/utils/teamIntelligenceUtils';
import { UsersIcon } from 'lucide-react';
import { ReactElement } from 'react';

const MemberHeader = ({ member }: { member: TeamMember }): ReactElement => {
  const initials = extractInitials(member.name);

  return (
    <section className='space-y-6'>
      <div className='flex items-start gap-6'>
        <div
          className='flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-2xl font-medium text-foreground'
          role='img'
          aria-label={`Avatar for ${member.name}`}
        >
          {initials}
        </div>
        <div className='space-y-2'>
          <h2 className='text-3xl font-light text-foreground'>{member.name}</h2>
          <p className='text-muted-foreground'>
            {member.designation} · {member.email}
          </p>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm bg-action-accent/10 text-action-accent',
            )}
          >
            <UsersIcon className='h-4 w-4' />
            {member?.team?.name}
          </span>
        </div>
      </div>
    </section>
  );
};

export default MemberHeader;
