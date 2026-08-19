import { useEffect, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import { useAuth } from '@/hooks/useAuth';
import { searchClawUsers } from '@/services/claw/clawAuthAgentsService';
import type { AgentShareRole, ClawUser } from '@/services/claw/clawAuthAgentTypes';
import { cn } from '@/utils/classNames';
import { V2Dialog } from '../../../shared/primitives/V2Dialog';
import { BehaviourSelect } from '../behaviour/BehaviourRows';
import { ROLE_OPTIONS } from './roles';
import { PersonRow } from './PersonRow';

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingUserIds: ReadonlySet<string>;
  defaultRole: AgentShareRole;
  saving: boolean;
  onAdd: (user: ClawUser, role: AgentShareRole) => void;
}

export function AddMemberDialog({
  open,
  onOpenChange,
  existingUserIds,
  defaultRole,
  saving,
  onAdd,
}: AddMemberDialogProps): ReactElement {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState<AgentShareRole>(defaultRole);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebounced('');
    setRole(defaultRole);
  }, [open, defaultRole]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ['claw-user-search', debounced, user?.id],
    queryFn: () => searchClawUsers(debounced, user!.id),
    enabled: open && debounced.length >= 2 && !!user?.id,
    staleTime: 30 * 1000,
  });

  const candidates = (results.data ?? []).filter(entry => !existingUserIds.has(entry.id));

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add people'
      description='Give someone access to this agent.'
      testId='add-member-dialog'
      footer={
        <Button
          variant='ghost'
          onClick={() => onOpenChange(false)}
          className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: close add member'
        >
          Done
        </Button>
      }
    >
      <div className='flex w-full items-center gap-3'>
        <div className='relative min-w-0 flex-1'>
          <Search
            className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
            aria-hidden
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search by name or email'
            aria-label='Search people'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: search people'
            className='h-9 w-full rounded-[10px] border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
          />
        </div>
        <BehaviourSelect
          value={role}
          options={ROLE_OPTIONS}
          editable
          disabled={saving}
          label='Role for the person being added'
          trackName='Agent detail v2: set new member role'
          onChange={next => setRole(next as AgentShareRole)}
        />
      </div>

      <div className={cn('w-full overflow-hidden rounded-2xl border border-border bg-card')}>
        {debounced.length < 2 ? (
          <p className='p-4 text-sm leading-5 text-muted-foreground'>
            Type at least two characters to search your workspace.
          </p>
        ) : results.isLoading ? (
          <p className='p-4 text-sm leading-5 text-muted-foreground'>Searching…</p>
        ) : candidates.length === 0 ? (
          <p className='p-4 text-sm leading-5 text-muted-foreground'>
            No one new matched “{debounced}”.
          </p>
        ) : (
          candidates.map(candidate => (
            <PersonRow
              key={candidate.id}
              userId={candidate.id}
              name={candidate.name || candidate.email}
              detail={candidate.email}
              trailing={
                <Button
                  onClick={() => onAdd(candidate, role)}
                  disabled={saving}
                  className='h-auto rounded-xl bg-foreground px-3 py-1.5 text-sm text-background hover:bg-foreground/90'
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: add member'
                >
                  Add
                </Button>
              }
            />
          ))
        )}
      </div>
    </V2Dialog>
  );
}
