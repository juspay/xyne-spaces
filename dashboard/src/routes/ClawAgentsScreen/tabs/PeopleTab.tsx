import { ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Crown, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/utils/classNames';
import Avatar from '@/components/ui/Avatar/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { useAuth } from '@/hooks/useAuth';
import { useClawAgentShares } from '@/hooks/useClawAgentDetail';
import {
  addClawAgentShare,
  removeClawAgentShare,
  searchClawUsers,
} from '@/services/claw/clawAuthAgentsService';
import type {
  Agent,
  AgentShare,
  AgentShareRole,
  ClawUser,
} from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';

interface PeopleTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

const ROLE_OPTIONS: Array<{ value: AgentShareRole; label: string; hint: string }> = [
  { value: 'VIEWER', label: 'Viewer', hint: 'can view and run this agent' },
  { value: 'CONTRIBUTOR', label: 'Contributor', hint: 'can edit config and clone instantly' },
  { value: 'EDITOR', label: 'Editor', hint: 'full edit access, short of sharing' },
];

const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const RoleBadge = ({ role }: { role: string }): ReactElement => {
  const label = role.charAt(0) + role.slice(1).toLowerCase();
  const variant = role === 'EDITOR' ? 'primary' : role === 'CONTRIBUTOR' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{label}</Badge>;
};

const MemberRow = ({
  userId,
  name,
  email,
  trailing,
}: {
  userId: string | null | undefined;
  name: string | undefined;
  email: string | undefined;
  trailing: ReactNode;
}): ReactElement => (
  <div className='flex items-center gap-3 rounded-lg px-2 py-2'>
    <Avatar userId={userId ?? null} size='md' />
    <div className='flex min-w-0 flex-1 flex-col'>
      <span className='truncate text-sm font-medium text-foreground'>
        {name || email || 'Unknown'}
      </span>
      {name && email && <span className='truncate text-xs text-muted-foreground'>{email}</span>}
    </div>
    <div className='flex shrink-0 items-center gap-2'>{trailing}</div>
  </div>
);

/**
 * People tab — the agent's owner and contributors. Immediate-save: adding /
 * removing hits its own endpoint on the spot and invalidates the shares query
 * (which also feeds the screen's permission check). The add form and per-row
 * remove are gated on `permissions.canShare` (owner only); everyone else sees a
 * read-only roster.
 */
const PeopleTab = ({ agent, permissions }: PeopleTabProps): ReactElement => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { data: shares, isLoading } = useClawAgentShares(agent.slug);
  const canShare = permissions.canShare;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClawUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [role, setRole] = useState<AgentShareRole>('VIEWER');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Owner + existing contributors are filtered out of search results.
  const memberIds = useMemo(() => {
    const ids = new Set<string>();
    if (agent.ownerUserId) ids.add(agent.ownerUserId);
    (shares ?? []).forEach(s => ids.add(s.userId));
    return ids;
  }, [agent.ownerUserId, shares]);

  // Debounced user search (min 2 chars), mirroring the reference.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !userId) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout((): void => {
      searchClawUsers(q, userId)
        .then((users): void => {
          if (!cancelled) setResults(users);
        })
        .catch((): void => {
          if (!cancelled) setResults([]);
        })
        .finally((): void => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, userId]);

  const invalidateShares = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['claw-agent-shares', agent.slug, userId] });

  const handleAdd = async (target: ClawUser): Promise<void> => {
    if (!userId || addingId) return;
    setAddingId(target.id);
    try {
      await addClawAgentShare(agent.slug, userId, target.id, role);
      toast.success(`Added ${target.name || target.email}`);
      setQuery('');
      setResults([]);
      await invalidateShares();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to add contributor'));
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (share: AgentShare): Promise<void> => {
    if (!userId || removingId) return;
    setRemovingId(share.id);
    try {
      await removeClawAgentShare(agent.slug, userId, share.userId);
      toast.success(`Removed ${share.user.name || share.user.email}`);
      await invalidateShares();
    } catch (err) {
      toast.error(errMsg(err, 'Failed to remove contributor'));
    } finally {
      setRemovingId(null);
    }
  };

  const visibleResults = results.filter(u => !memberIds.has(u.id));
  const showResults = canShare && query.trim().length >= 2;

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      {canShare ? (
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <div className='relative flex-1'>
              <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder='Add people by name or email'
                className='pl-8'
              />
              {showResults && (
                <div className='absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover shadow-lg'>
                  {searching ? (
                    <div className='px-3 py-2.5 text-sm text-muted-foreground'>Searching…</div>
                  ) : visibleResults.length === 0 ? (
                    <div className='px-3 py-2.5 text-sm text-muted-foreground'>No people found</div>
                  ) : (
                    visibleResults.map(u => (
                      <button
                        key={u.id}
                        type='button'
                        onClick={() => void handleAdd(u)}
                        data-track-category='Claw Agents'
                        data-track-name='Add person to agent'
                        disabled={!!addingId}
                        className='flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60'
                      >
                        <Avatar userId={u.id} size='sm' />
                        <div className='flex min-w-0 flex-1 flex-col'>
                          <span className='truncate text-sm text-foreground'>
                            {u.name || u.email}
                          </span>
                          {u.name && (
                            <span className='truncate text-xs text-muted-foreground'>
                              {u.email}
                            </span>
                          )}
                        </div>
                        {addingId === u.id && (
                          <Loader2 className='size-4 shrink-0 animate-spin text-muted-foreground' />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <Select value={role} onValueChange={v => setRole(v as AgentShareRole)}>
              <SelectTrigger size='sm' className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className='text-xs text-muted-foreground'>
            New people join as {ROLE_OPTIONS.find(o => o.value === role)?.label} —{' '}
            {ROLE_OPTIONS.find(o => o.value === role)?.hint}.
          </p>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>Only the owner can manage people.</p>
      )}

      <div className='flex flex-col gap-1'>
        <span className='px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
          Members
        </span>

        <MemberRow
          userId={agent.owner?.id ?? agent.ownerUserId}
          name={agent.owner?.name}
          email={agent.owner?.email}
          trailing={
            <Badge variant='secondary' className='gap-1'>
              <Crown className='size-3' />
              Owner
            </Badge>
          }
        />

        {isLoading ? (
          <>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className='flex items-center gap-3 px-2 py-2'>
                <Skeleton className='size-8 shrink-0 rounded-full' />
                <div className='flex flex-1 flex-col gap-1.5'>
                  <Skeleton className='h-3.5 w-40' />
                  <Skeleton className='h-3 w-52' />
                </div>
              </div>
            ))}
          </>
        ) : (
          (shares ?? []).map(share => (
            <MemberRow
              key={share.id}
              userId={share.userId}
              name={share.user.name}
              email={share.user.email}
              trailing={
                <>
                  <RoleBadge role={share.role} />
                  {canShare && (
                    <button
                      type='button'
                      onClick={() => void handleRemove(share)}
                      data-track-category='Claw Agents'
                      data-track-name='Remove person from agent'
                      disabled={removingId === share.id}
                      aria-label={`Remove ${share.user.name || share.user.email}`}
                      className={cn(
                        'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50',
                      )}
                    >
                      {removingId === share.id ? (
                        <Loader2 className='size-4 animate-spin' />
                      ) : (
                        <X className='size-4' />
                      )}
                    </button>
                  )}
                </>
              }
            />
          ))
        )}
      </div>
    </div>
  );
};

export default PeopleTab;
