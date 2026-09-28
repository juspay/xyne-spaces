import { useCallback, useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PencilEditLine } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { Pill } from '../../shared/primitives/Pill';
import { AutoWidthInput } from '../../shared/primitives/AutoWidthInput';
import { LibraryIconTile } from '../../shared/components/LibraryCard';
import { AgentCreatedBanner } from './AgentCreatedBanner';
import { isSpacesRegistered } from './agentRegistration';
import { AgentDetailHeaderV2 } from './AgentDetailHeaderV2';
import { AgentPersonaTabV2 } from './persona/AgentPersonaTabV2';
import { AgentActivityTabV2 } from './activity/AgentActivityTabV2';
import { AgentBehaviourTabV2 } from './behaviour/AgentBehaviourTabV2';
import { AgentKnowledgeTabV2 } from './knowledge/AgentKnowledgeTabV2';
import { AgentPeopleTabV2 } from './people/AgentPeopleTabV2';
import { AgentToolsTabV2 } from './tools/AgentToolsTabV2';
import { AGENT_DETAIL_TABS, resolveTab, type AgentDetailTabId } from './detailTabs';
import { AgentCallGraphTabV2 } from './callGraph/AgentCallGraphTabV2';
import { useAgentDetailActions } from './useAgentDetailActions';
import { useAgentDraft } from './useAgentDraft';
import { Button } from '@/components/ui/Button/index';
import { useOpenAgentChat } from '@/hooks/useOpenAgentChat';

const NAME_TEXT = 'text-sm font-semibold leading-[22px] text-foreground';

const HANDLE_TEXT = 'text-xs leading-[22px]';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatUpdated(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : DATE.format(parsed).replace(',', ',');
}

const ClawAgentDetailV2 = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId, slug } = useParams<{ workspaceId?: string; slug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const requestedReturnPath = (location.state as { returnTo?: unknown } | null)?.returnTo;
  const navigationState: { returnTo: string } | null =
    typeof requestedReturnPath === 'string' && requestedReturnPath.startsWith('/')
      ? { returnTo: requestedReturnPath }
      : null;
  const returnPath = navigationState?.returnTo ?? `${libraryPath}?tab=agents`;
  const tab = resolveTab(searchParams.get('tab'));
  const justCreated = (location.state as { justCreated?: unknown } | null)?.justCreated === true;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const dismissBanner = useCallback(() => setBannerDismissed(true), []);

  const { data: agent, isLoading, isError } = useClawAgentDetail(slug);
  const pendingRegistration = agent !== undefined && !isSpacesRegistered(agent);
  const showBanner = !bannerDismissed && (justCreated || pendingRegistration);
  const actions = useAgentDetailActions(agent);
  const canEdit = actions.permissions?.canEdit ?? false;
  const canRenameHandle = actions.isOwner;
  const draft = useAgentDraft(agent, canRenameHandle);
  const [focusField, setFocusField] = useState<'name' | 'slug'>('name');
  const { canOpenAgentChat, openAgentChat } = useOpenAgentChat();

  const startEditing = (field: 'name' | 'slug'): void => {
    setFocusField(field);
    draft.start();
  };

  // Delegation approvals spend the callee's credentials and quota, so the
  // inbox is the owner's (or an admin's) — mirrors claw's canManageRequests.
  const canManageDelegation = actions.isOwner || actions.isAdmin;
  const visibleTabs = AGENT_DETAIL_TABS.filter(entry => !entry.ownerOnly || canManageDelegation);

  const setTab = (next: AgentDetailTabId): void => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true, state: navigationState });
  };

  const updated = formatUpdated(agent?.updatedAt);
  const version = agent?.activePromptVersion;

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawAgentDetailV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 pb-6'>
        <div className='bg-background sticky top-0 z-10 flex flex-col gap-6 pb-3 pt-6'>
          {agent && (
            <AgentDetailHeaderV2
              agent={agent}
              actions={actions}
              onChat={() => openAgentChat(agent.slug)}
              canChat={canOpenAgentChat}
              onBack={() => void navigate(returnPath)}
            />
          )}

          <div className='flex w-full items-center gap-1'>
            {visibleTabs.map(entry => (
              <button
                key={entry.id}
                type='button'
                onClick={() => setTab(entry.id)}
                aria-current={entry.id === tab ? 'page' : undefined}
                data-track-category='Claw Agents'
                data-track-name={`Agent detail v2 tab: ${entry.label}`}
                className={cn(
                  'flex h-8 items-center justify-center rounded-[10px] px-3 py-1 text-sm transition-colors',
                  entry.id === tab
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className='flex w-full flex-col gap-4'>
            <Skeleton className='size-10 rounded-xl' />
            <Skeleton className='h-6 w-52' />
            <Skeleton className='h-4 w-80' />
            <Skeleton className='h-32 w-full rounded-2xl' />
          </div>
        ) : isError || !agent ? (
          <p className='py-16 text-center text-sm text-muted-foreground'>
            Couldn&apos;t load this agent.
          </p>
        ) : (
          <>
            {showBanner && (
              <AgentCreatedBanner
                agent={agent}
                pendingRegistration={pendingRegistration}
                onDismiss={dismissBanner}
              />
            )}

            <div className='flex w-full items-start gap-3'>
              <LibraryIconTile name={agent.name} color={agent.color || '#6366f1'} size='md' />

              <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
                <div className='flex min-w-0 items-center gap-2'>
                  {draft.editing && canEdit ? (
                    <AutoWidthInput
                      value={draft.name}
                      onChange={draft.setName}
                      aria-label='Agent name'
                      placeholder='Agent name'
                      autoFocus={focusField === 'name'}
                      className={NAME_TEXT}
                      data-track-category='Claw Agents'
                      data-track-name='Agent detail v2: edit name'
                    />
                  ) : (
                    <span
                      {...(canEdit ? { onClick: () => startEditing('name') } : {})}
                      className={cn('truncate', NAME_TEXT, canEdit && 'cursor-text')}
                    >
                      {agent.name}
                    </span>
                  )}
                  <Pill tone={agent.enabled ? 'success' : 'neutral'}>
                    {agent.enabled ? 'Enabled' : 'Disabled'}
                  </Pill>
                </div>

                <div className='flex flex-wrap items-center gap-1.5 text-xs leading-[22px] text-foreground/80 opacity-70'>
                  {draft.editing && canRenameHandle ? (
                    <span className='inline-flex items-center'>
                      <span aria-hidden>@</span>
                      <AutoWidthInput
                        value={draft.slug}
                        onChange={draft.setSlug}
                        aria-label='Agent handle'
                        placeholder='handle'
                        autoFocus={focusField === 'slug'}
                        className={HANDLE_TEXT}
                        data-track-category='Claw Agents'
                        data-track-name='Agent detail v2: edit handle'
                      />
                    </span>
                  ) : (
                    <span
                      {...(canRenameHandle ? { onClick: () => startEditing('slug') } : {})}
                      className={cn(canRenameHandle && 'cursor-text')}
                    >
                      @{agent.slug}
                    </span>
                  )}
                  {version !== null && version !== undefined && (
                    <>
                      <span aria-hidden>·</span>
                      <span>v{version}</span>
                    </>
                  )}
                  {updated && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Last updated on: {updated}</span>
                    </>
                  )}
                </div>

                {draft.editing && draft.slugError && (
                  <span className='text-xs leading-4 text-destructive'>{draft.slugError}</span>
                )}
                {draft.editing && draft.slugChanged && !draft.slugError && (
                  <span className='text-xs leading-4 text-muted-foreground'>
                    Changing the handle breaks existing @mentions and links to @{agent.slug}.
                  </span>
                )}
              </div>

              {canEdit && (
                <div className='flex shrink-0 items-center gap-1.5'>
                  {draft.editing && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={draft.cancel}
                      disabled={draft.saving}
                      className='rounded-lg'
                      data-track-category='Claw Agents'
                      data-track-name='Agent detail v2: cancel edits'
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    type='button'
                    variant={draft.dirty ? 'default' : 'outline'}
                    size='sm'
                    onClick={
                      draft.dirty ? (): void => void draft.save() : (): void => startEditing('name')
                    }
                    disabled={draft.dirty ? !draft.canSave : draft.editing}
                    loading={draft.saving}
                    className='rounded-lg'
                    data-track-category='Claw Agents'
                    data-track-name={
                      draft.dirty ? 'Agent detail v2: save edits' : 'Agent detail v2: start editing'
                    }
                  >
                    {!draft.dirty && <PencilEditLine size={14} className='mr-1 shrink-0' />}
                    {draft.dirty ? 'Save' : 'Edit'}
                  </Button>
                </div>
              )}
            </div>

            {tab === 'persona' ? (
              <AgentPersonaTabV2
                agent={agent}
                canEdit={canEdit}
                canManageCredentials={actions.isOwner || actions.isAdmin}
                draft={draft}
              />
            ) : tab === 'behaviour' ? (
              <AgentBehaviourTabV2 agent={agent} canEdit={canEdit} />
            ) : tab === 'tools' ? (
              <AgentToolsTabV2 agent={agent} canEdit={canEdit} />
            ) : tab === 'knowledge' ? (
              <AgentKnowledgeTabV2 agent={agent} canEdit={canEdit} />
            ) : tab === 'people' ? (
              <AgentPeopleTabV2 agent={agent} actions={actions} />
            ) : tab === 'call-graph' && canManageDelegation ? (
              <AgentCallGraphTabV2 agent={agent} />
            ) : (
              <AgentActivityTabV2 agent={agent} canEdit={actions.permissions?.canEdit ?? false} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ClawAgentDetailV2;
