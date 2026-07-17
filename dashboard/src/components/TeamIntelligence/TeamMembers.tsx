import { SearchIcon, UserIcon } from 'lucide-react';
import { ReactElement, useState } from 'react';
import { useParams } from 'react-router-dom';
import Input from '../ui/Input';
import TeamMember from './TeamMember';
import { useTeamMembers } from '@/hooks/useTeamIntelligence';
import { Loader2 } from 'lucide-react';

const TeamMembers = (): ReactElement => {
  const { teamId } = useParams<{ teamId: string }>();
  const [query, setQuery] = useState('');

  const { data: teamMembers, isLoading } = useTeamMembers(teamId!);
  const employeeList = teamMembers?.employee_list ?? [];
  const members = employeeList.filter(m => {
    const q = query.toLowerCase();
    return (
      (m.name ?? '').toLowerCase().includes(q) ||
      (m.email ?? '').toLowerCase().includes(q) ||
      (m.designation ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3 flex-wrap'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10'>
            <UserIcon className='h-4 w-4 text-blue-500' />
          </div>
          <h3 className='text-lg font-semibold text-foreground whitespace-nowrap'>Meet the Team</h3>
        </div>
        <div className='ml-auto flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 focus-within:border-action-accent/50 focus-within:bg-background transition-colors w-full max-w-sm'>
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

      {isLoading ? (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center justify-start gap-2'>
          <Loader2 size={16} className='animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading team members...</p>
        </div>
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {members.length === 0 ? (
            employeeList.length === 0 ? (
              <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center justify-start gap-2 col-span-2'>
                <p className='text-sm text-muted-foreground'>No team members.</p>
              </div>
            ) : (
              <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center justify-start gap-2 col-span-2'>
                <p className='text-sm text-muted-foreground'>
                  No members match &ldquo;{query}&rdquo;.
                </p>
              </div>
            )
          ) : (
            members.map(member => {
              return <TeamMember key={member.email} member={member} />;
            })
          )}
        </div>
      )}
    </section>
  );
};

export default TeamMembers;
