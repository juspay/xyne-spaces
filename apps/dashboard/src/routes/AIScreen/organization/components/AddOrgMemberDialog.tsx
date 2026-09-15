import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button/index';
import Input from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
import { useAuth } from '@/hooks/useAuth';
import { useClawOrganizationMembers } from '@/hooks/useClawOrganization';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { searchClawUsers } from '@/services/claw/clawAuthAgentsService';
import type { ClawUser } from '@/services/claw/clawAuthAgentTypes';
import type { AddableOrgRole } from '@/services/claw/clawOrgTypes';
import { V2Dialog } from '../../library/shared/primitives/V2Dialog';
import { BehaviourSelect } from '../../library/agents/detail/behaviour/BehaviourRows';
import { PersonRow } from '../../library/agents/detail/people/PersonRow';
import { ADDABLE_ROLE_OPTIONS, isAddableOrgRole } from '../orgRoles';

interface AddOrgMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  saving: boolean;
  onAdd: (users: ClawUser[], role: AddableOrgRole) => Promise<void>;
}

const MEMBER_MATCH_LIMIT = 100;

export function AddOrgMemberDialog({
  open,
  onOpenChange,
  orgId,
  saving,
  onAdd,
}: AddOrgMemberDialogProps): ReactElement {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AddableOrgRole>('MEMBER');
  const [selected, setSelected] = useState<ClawUser[]>([]);
  const debounced = useDebouncedValue(query.trim(), 250);
  const searching = open && debounced.length >= 2;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRole('MEMBER');
    setSelected([]);
  }, [open]);

  const results = useQuery({
    queryKey: ['claw-user-search', debounced, user?.id],
    queryFn: () => searchClawUsers(debounced, user!.id),
    enabled: searching && !!user?.id,
    staleTime: 30 * 1000,
  });

  const existing = useClawOrganizationMembers(
    orgId,
    { q: debounced, limit: MEMBER_MATCH_LIMIT },
    searching,
  );
  const existingUserIds = useMemo(
    () => new Set((existing.data?.rows ?? []).map(row => row.userId)),
    [existing.data],
  );

  const loading = results.isFetching || existing.isFetching;
  const candidates = (results.data ?? []).filter(entry => !existingUserIds.has(entry.id));
  const selectedIds = useMemo(() => new Set(selected.map(entry => entry.id)), [selected]);

  const toggle = (candidate: ClawUser, checked: boolean): void => {
    setSelected(current =>
      checked
        ? current.some(entry => entry.id === candidate.id)
          ? current
          : [...current, candidate]
        : current.filter(entry => entry.id !== candidate.id),
    );
  };

  const commit = async (): Promise<void> => {
    if (selected.length === 0) return;
    await onAdd(selected, role);
    setSelected([]);
    onOpenChange(false);
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add organization member'
      description='Add someone to this organization.'
      testId='add-org-member-dialog'
      className='p-4'
      footer={
        <Button
          onClick={() => void commit()}
          disabled={selected.length === 0}
          loading={saving}
          className='px-6 disabled:pointer-events-auto disabled:cursor-not-allowed'
          data-track-category='Claw Organization'
          data-track-name='Organization: add members'
        >
          {selected.length > 1 ? `Add ${selected.length} members` : 'Add member'}
        </Button>
      }
    >
      <div className='flex w-full items-center gap-3'>
        <div className='relative min-w-0 flex-1'>
          <Search
            className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
            aria-hidden
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search by name or email'
            aria-label='Search people'
            data-track-category='Claw Organization'
            data-track-name='Organization: search people'
            variant='flat'
            className='pl-9'
          />
        </div>
        <BehaviourSelect
          value={role}
          options={ADDABLE_ROLE_OPTIONS}
          editable
          disabled={saving}
          label='Role for the people being added'
          trackName='Organization: set new member role'
          triggerClassName='border-border shadow-none focus-visible:ring-[2px] focus-visible:ring-ring/10'
          onChange={next => {
            if (isAddableOrgRole(next)) setRole(next);
          }}
        />
      </div>

      {!searching ? (
        <p className='text-sm leading-5 text-muted-foreground'>
          Type at least two characters to search.
        </p>
      ) : loading ? (
        <p className='text-sm leading-5 text-muted-foreground'>Searching…</p>
      ) : candidates.length === 0 ? (
        <p className='text-sm leading-5 text-muted-foreground'>
          {existingUserIds.size > 0
            ? `Everyone matching “${debounced}” is already a member.`
            : `No one matched “${debounced}”. People become addable once they've signed in to Xyne AI at least once.`}
        </p>
      ) : (
        <div className='w-full overflow-hidden rounded-2xl border border-border bg-card'>
          {candidates.map(candidate => (
            <PersonRow
              key={candidate.id}
              userId={candidate.id}
              name={candidate.name || candidate.email}
              detail={candidate.email}
              trailing={
                <Checkbox
                  checked={selectedIds.has(candidate.id)}
                  onChange={checked => toggle(candidate, checked)}
                  disabled={saving}
                  label=''
                  ariaLabel={`Select ${candidate.name || candidate.email}`}
                />
              }
            />
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <p className='text-xs leading-4 text-muted-foreground'>
          {selected.length} selected — they&apos;ll be added as{' '}
          {role === 'ADMIN' ? 'admins' : 'members'}.
        </p>
      )}
    </V2Dialog>
  );
}
