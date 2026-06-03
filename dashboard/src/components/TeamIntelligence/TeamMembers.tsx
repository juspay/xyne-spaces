import { TeamMembersResponse } from '@/services/TeamIntelligence/teamIntelligenceService';
import { SearchIcon, UserIcon } from 'lucide-react';
import { ReactElement, useState } from 'react';
import Input from '../ui/Input';
import TeamMember from './TeamMember';

const TeamMembers = ({ teamMembers }: { teamMembers: TeamMembersResponse }): ReactElement => {
  const [query, setQuery] = useState('');
  const members = teamMembers.employee_list.filter(m => {
    const q = query.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.designation.toLowerCase().includes(q)
    );
  });

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10'>
          <UserIcon className='h-4 w-4 text-blue-500' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Meet the Team</h3>
        <div className='ml-auto flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 focus-within:border-action-accent/50 focus-within:bg-background transition-colors'>
          <SearchIcon className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
          <Input
            type='text'
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search members…'
            className='w-40 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-none focus-visible:border-none p-0 h-fit focus-visible:ring-0'
          />
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        {members.length === 0 ? (
          <p className='col-span-2 py-6 text-center text-sm text-muted-foreground'>
            No members match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          members.map(member => {
            return <TeamMember key={member.email} member={member} />;
          })
        )}
      </div>
    </section>
  );
};

export default TeamMembers;
