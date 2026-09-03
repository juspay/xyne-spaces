import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Check, Copy, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { Checkbox } from '@/components/ui/Checkbox/Checkbox';
import { useAuth } from '@/hooks/useAuth';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  useClawOrganizationMembers,
  useClawOrganizationServiceTokens,
  useMintClawOrganizationServiceToken,
  useRevokeClawOrganizationServiceToken,
} from '@/hooks/useClawOrganization';
import type {
  MintedServiceAccessToken,
  OrgMemberRow,
  ServiceAccessToken,
} from '@/services/claw/clawOrgTypes';
import { clawErrorText } from '@/services/claw/clawRequest';
import { DetailCard, DetailEmpty } from '../../library/shared/primitives/DetailPrimitives';
import { Pill } from '../../library/shared/primitives/Pill';
import { V2Dialog } from '../../library/shared/primitives/V2Dialog';

interface OrganizationServiceTokensSectionProps {
  orgId: string;
  canManage: boolean;
}

const formatDate = (value: string | null, fallback: string): string =>
  value ? new Date(value).toLocaleString() : fallback;

const localDateTimeNow = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const tokenAgents = (token: ServiceAccessToken): string[] =>
  (token.scopes ?? [])
    .filter(scope => scope.startsWith('agent:'))
    .map(scope => scope.slice('agent:'.length));

export function OrganizationServiceTokensSection({
  orgId,
  canManage,
}: OrganizationServiceTokensSectionProps): ReactElement {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [boundUserId, setBoundUserId] = useState('');
  const [agentSlugs, setAgentSlugs] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState('');
  const [expiry, setExpiry] = useState('');
  const [minted, setMinted] = useState<MintedServiceAccessToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ServiceAccessToken | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [boundMember, setBoundMember] = useState<OrgMemberRow | null>(null);
  const debouncedMemberQuery = useDebouncedValue(memberQuery.trim(), 250);
  const searchingMembers = createOpen && !minted && debouncedMemberQuery.length >= 2;

  const tokens = useClawOrganizationServiceTokens(orgId, canManage);
  const members = useClawOrganizationMembers(orgId, { limit: 100 }, canManage);
  const memberMatches = useClawOrganizationMembers(
    orgId,
    { q: debouncedMemberQuery, limit: 20 },
    searchingMembers,
  );
  const mintToken = useMintClawOrganizationServiceToken(orgId);
  const revokeToken = useRevokeClawOrganizationServiceToken(orgId);
  const memberRows = useMemo(() => members.data?.rows ?? [], [members.data]);
  const memberById = useMemo(
    () => new Map(memberRows.map(member => [member.userId, member])),
    [memberRows],
  );
  const allowedAgentSlugs = useMemo(() => [...new Set(agentSlugs)], [agentSlugs]);

  const agents = useClawAuthAgents();
  const agentOptions = useMemo(() => {
    const query = agentFilter.trim().toLowerCase();
    const all = agents.data ?? [];
    return query
      ? all.filter(agent => `${agent.name} ${agent.slug}`.toLowerCase().includes(query))
      : all;
  }, [agents.data, agentFilter]);

  const toggleAgent = (slug: string, checked: boolean): void => {
    setAgentSlugs(current =>
      checked
        ? current.includes(slug)
          ? current
          : [...current, slug]
        : current.filter(entry => entry !== slug),
    );
  };

  useEffect(() => {
    if (!createOpen || minted || boundUserId) return;
    const currentUser = memberRows.find(member => member.userId === user?.id);
    if (currentUser) {
      setBoundUserId(currentUser.userId);
      setBoundMember(currentUser);
    }
  }, [boundUserId, createOpen, memberRows, minted, user?.id]);

  const closeCreate = (): void => {
    setCreateOpen(false);
    setName('');
    setBoundUserId('');
    setBoundMember(null);
    setMemberQuery('');
    setAgentSlugs([]);
    setAgentFilter('');
    setExpiry('');
    setMinted(null);
    setCopied(false);
  };

  const expiryInPast = Boolean(expiry) && new Date(expiry).getTime() <= Date.now();

  const createToken = async (): Promise<void> => {
    if (!name.trim() || !boundUserId || allowedAgentSlugs.length === 0 || expiryInPast) return;
    try {
      const result = await mintToken.mutateAsync({
        name: name.trim(),
        userId: boundUserId,
        allowedAgentSlugs,
        expiresAt: expiry ? new Date(expiry).toISOString() : null,
      });
      setMinted(result);
      toast.success('Service token created');
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to create service token'));
    }
  };

  const copyToken = async (): Promise<void> => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Service token copied');
    } catch {
      toast.error('Could not copy the service token');
    }
  };

  const revoke = async (): Promise<void> => {
    if (!revokeTarget) return;
    try {
      await revokeToken.mutateAsync(revokeTarget.id);
      toast.success(`${revokeTarget.name ?? revokeTarget.prefix} revoked`);
      setRevokeTarget(null);
    } catch (reason) {
      toast.error(clawErrorText(reason, 'Failed to revoke service token'));
    }
  };

  return (
    <section className='flex w-full flex-col gap-3'>
      <DetailCard>
        <div className='flex items-center gap-3 border-b border-border px-4 py-3'>
          <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground'>
            <KeyRound className='size-4' aria-hidden />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-sm font-medium leading-5 text-foreground'>Service tokens</p>
          </div>
          {canManage && (
            <Button
              size='sm'
              onClick={() => setCreateOpen(true)}
              data-track-category='Claw Organization'
              data-track-name='Organization: new service token'
            >
              <Plus className='size-4' aria-hidden />
              New token
            </Button>
          )}
        </div>

        {!canManage ? (
          <DetailEmpty>Only an organization owner or admin can manage service tokens.</DetailEmpty>
        ) : tokens.isLoading ? (
          <DetailEmpty>Loading service tokens…</DetailEmpty>
        ) : tokens.isError ? (
          <div className='flex items-center justify-between gap-3 p-4'>
            <p className='text-sm text-muted-foreground'>Couldn’t load service tokens.</p>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void tokens.refetch()}
              data-track-category='Claw Organization'
              data-track-name='Organization: retry service tokens'
            >
              Retry
            </Button>
          </div>
        ) : tokens.data?.length ? (
          <ul className='divide-y divide-border'>
            {tokens.data.map(token => {
              const expired = Boolean(
                token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now(),
              );
              const inactive = Boolean(token.revokedAt) || expired;
              const agents = tokenAgents(token);
              const member = memberById.get(token.userId);
              return (
                <li key={token.id} className='flex items-center gap-3 px-4 py-3'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='truncate text-sm font-medium text-foreground'>
                        {token.name || 'Unnamed token'}
                      </span>
                      <code className='text-xs text-muted-foreground'>{token.prefix}…</code>
                      {inactive && (
                        <Pill tone='danger'>{token.revokedAt ? 'Revoked' : 'Expired'}</Pill>
                      )}
                    </div>
                    <p className='mt-1 truncate text-xs text-muted-foreground'>
                      Runs as {member?.name || member?.email || token.userId} · Agents:{' '}
                      {agents.length
                        ? agents.join(', ')
                        : 'none (legacy token — re-mint with an allowlist)'}{' '}
                      · Last used {formatDate(token.lastUsedAt, 'never')} · Expires{' '}
                      {formatDate(token.expiresAt, 'never')}
                    </p>
                  </div>
                  {!inactive && (
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={`Revoke ${token.name ?? token.prefix}`}
                      onClick={() => setRevokeTarget(token)}
                      data-track-category='Claw Organization'
                      data-track-name='Organization: open revoke service token'
                      className='text-muted-foreground hover:text-destructive'
                    >
                      <Trash2 className='size-4' aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <DetailEmpty>No service tokens yet.</DetailEmpty>
        )}
      </DetailCard>

      <V2Dialog
        open={createOpen}
        className='p-4'
        onOpenChange={open => {
          if (!open) closeCreate();
          else setCreateOpen(true);
        }}
        title={minted ? 'Copy your service token' : 'Create service token'}
        description={
          minted
            ? 'This secret is shown only once.'
            : 'Bind this credential to an organization member and allowed agents.'
        }
        testId='create-service-token-dialog'
        footer={
          minted ? (
            <Button
              onClick={closeCreate}
              data-track-category='Claw Organization'
              data-track-name='Organization: close minted token dialog'
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant='outline'
                onClick={closeCreate}
                data-track-category='Claw Organization'
                data-track-name='Organization: cancel create service token'
                disabled={mintToken.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void createToken()}
                data-track-category='Claw Organization'
                data-track-name='Organization: create service token'
                loading={mintToken.isPending}
                disabled={
                  !name.trim() ||
                  name.trim().length > 60 ||
                  !boundUserId ||
                  allowedAgentSlugs.length === 0 ||
                  allowedAgentSlugs.length > 20 ||
                  expiryInPast
                }
                className='disabled:pointer-events-auto disabled:cursor-not-allowed'
              >
                Create token
              </Button>
            </>
          )
        }
      >
        {minted ? (
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3'>
              <code className='min-w-0 flex-1 break-all text-xs text-foreground'>
                {minted.token}
              </code>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void copyToken()}
                data-track-category='Claw Organization'
                data-track-name='Organization: copy service token'
              >
                {copied ? <Check className='size-4' /> : <Copy className='size-4' />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className='text-xs font-medium text-destructive'>
              You won’t see this token again. Store it securely before closing.
            </p>
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            <label className='flex flex-col gap-2 text-xs font-medium text-foreground'>
              Name
              <Input
                value={name}
                maxLength={60}
                placeholder='Production billing worker'
                onChange={event => setName(event.target.value)}
                variant='flat'
                data-track-category='Claw Organization'
                data-track-name='Organization: service token name'
              />
              <span className='font-normal text-muted-foreground'>{name.length}/60 characters</span>
            </label>

            <div className='flex flex-col gap-2 text-xs font-medium text-foreground'>
              <span>Run as member</span>
              {boundMember ? (
                <div className='flex items-center gap-2 rounded-[10px] border border-border px-3 py-2'>
                  <span className='min-w-0 flex-1 truncate text-sm font-normal text-foreground'>
                    {boundMember.name
                      ? `${boundMember.name} (${boundMember.email})`
                      : boundMember.email}
                  </span>
                  <button
                    type='button'
                    disabled={mintToken.isPending}
                    onClick={() => {
                      setBoundUserId('');
                      setBoundMember(null);
                      setMemberQuery('');
                    }}
                    className='shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50'
                    data-track-category='Claw Organization'
                    data-track-name='Organization: change service token member'
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    value={memberQuery}
                    placeholder='Search members by name or email'
                    onChange={event => setMemberQuery(event.target.value)}
                    disabled={mintToken.isPending}
                    aria-label='Search members'
                    variant='flat'
                    data-track-category='Claw Organization'
                    data-track-name='Organization: service token member search'
                  />
                  {memberQuery.trim().length < 2 ? (
                    <span className='font-normal text-muted-foreground'>
                      Type at least two characters to search.
                    </span>
                  ) : memberMatches.isFetching ? (
                    <span className='font-normal text-muted-foreground'>Searching…</span>
                  ) : (memberMatches.data?.rows.length ?? 0) === 0 ? (
                    <span className='font-normal text-muted-foreground'>
                      No members matched “{debouncedMemberQuery}”.
                    </span>
                  ) : (
                    <div className='max-h-44 overflow-y-auto rounded-[10px] border border-border'>
                      {memberMatches.data?.rows.map(member => (
                        <button
                          key={member.userId}
                          type='button'
                          onClick={() => {
                            setBoundUserId(member.userId);
                            setBoundMember(member);
                          }}
                          className='flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted'
                          data-track-category='Claw Organization'
                          data-track-name='Organization: select service token member'
                        >
                          <span className='min-w-0 flex-1 truncate text-sm font-normal text-foreground'>
                            {member.name ? `${member.name} (${member.email})` : member.email}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className='flex flex-col gap-2 text-xs font-medium text-foreground'>
              <span>Allowed agents</span>
              {allowedAgentSlugs.length > 0 && (
                <div className='flex flex-wrap gap-1.5'>
                  {allowedAgentSlugs.map(slug => (
                    <span
                      key={slug}
                      className='flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-normal text-foreground'
                    >
                      {slug}
                      <button
                        type='button'
                        onClick={() => toggleAgent(slug, false)}
                        aria-label={`Remove ${slug}`}
                        className='text-muted-foreground transition-colors hover:text-destructive'
                        data-track-category='Claw Organization'
                        data-track-name='Organization: remove service token agent'
                      >
                        <X className='size-3' aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={agentFilter}
                placeholder='Filter agents'
                onChange={event => setAgentFilter(event.target.value)}
                disabled={mintToken.isPending}
                aria-label='Filter agents'
                variant='flat'
                data-track-category='Claw Organization'
                data-track-name='Organization: filter service token agents'
              />
              {agents.isLoading ? (
                <span className='font-normal text-muted-foreground'>Loading agents…</span>
              ) : agentOptions.length === 0 ? (
                <span className='font-normal text-muted-foreground'>No agents matched.</span>
              ) : (
                <div className='max-h-44 overflow-y-auto rounded-[10px] border border-border'>
                  {agentOptions.map(agent => {
                    const checked = allowedAgentSlugs.includes(agent.slug);
                    return (
                      <div
                        key={agent.id}
                        className='flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0'
                      >
                        <span className='min-w-0 flex-1 truncate text-sm font-normal text-foreground'>
                          {agent.name}{' '}
                          <span className='text-xs text-muted-foreground'>{agent.slug}</span>
                        </span>
                        <Checkbox
                          checked={checked}
                          onChange={next => toggleAgent(agent.slug, next)}
                          disabled={
                            mintToken.isPending || (!checked && allowedAgentSlugs.length >= 20)
                          }
                          label=''
                          ariaLabel={`Allow ${agent.name}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              <span className='font-normal text-muted-foreground'>
                {allowedAgentSlugs.length}/20 selected. At least one is required.
              </span>
            </div>

            <label
              htmlFor='service-token-expiry'
              className='flex flex-col gap-2 text-xs font-medium text-foreground'
            >
              Expiry (optional)
              <Input
                id='service-token-expiry'
                type='datetime-local'
                value={expiry}
                min={localDateTimeNow()}
                onChange={event => setExpiry(event.target.value)}
                variant='flat'
                data-track-category='Claw Organization'
                data-track-name='Organization: service token expiry'
              />
            </label>
          </div>
        )}
      </V2Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={open => {
          if (!open && !revokeToken.isPending) setRevokeTarget(null);
        }}
        title='Revoke service token'
        description={
          revokeTarget
            ? `Revoke ${revokeTarget.name ?? revokeTarget.prefix}? Calls using it will stop immediately.`
            : undefined
        }
        confirmLabel='Revoke'
        danger
        loading={revokeToken.isPending}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}
