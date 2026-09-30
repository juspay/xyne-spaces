import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PencilEditLine } from '@xyne/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button/index';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { AgentCreateCanvas } from '@/components/flowUI/nodes/agent/create/AgentCreateCanvas';
import { useClawAgentDetail } from '@/hooks/useClawAgentDetail';
import { useOpenAgentChat } from '@/hooks/useOpenAgentChat';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { Pill } from '../../shared/primitives/Pill';
import { AgentCreatedBanner } from './AgentCreatedBanner';
import { isSpacesRegistered } from './agentRegistration';
import { AgentDetailHeaderV2 } from './AgentDetailHeaderV2';
import { AgentProfileChat } from './AgentProfileChat';
import { SETTINGS_PARAM, settingsTabFromParams, type AgentSettingsTabId } from './detailTabs';
import { SavedAgentSettings } from './settings/AgentSettingsView';
import { useAgentDetailActions, type AgentDetailActions } from './useAgentDetailActions';
import { useAgentProfileForm, type AgentProfileForm } from './useAgentProfileForm';

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
  return Number.isNaN(parsed.getTime()) ? null : DATE.format(parsed);
}

const NO_HIGHLIGHTS: ReadonlySet<never> = new Set();
const noop = (): void => undefined;

const HANDLE_WARNING = 'Changing the handle breaks existing @mentions and links to this agent.';

/**
 * The agent's profile: the same canvas the agent was created on, without the
 * chat, and read-only until Edit. Everything else about the agent (model,
 * behaviour, members, activity…) is under the gear.
 */
function AgentProfileCanvas({
  agent,
  actions,
  profile,
  chat,
  topBar,
  banner,
  onOpenSettings,
}: {
  agent: Agent;
  actions: AgentDetailActions;
  profile: AgentProfileForm;
  /** The floating chat with this agent, docked over the bottom of the profile. */
  chat: ReactNode;
  topBar: ReactNode;
  banner: ReactNode;
  onOpenSettings: () => void;
}): ReactElement {
  const canEdit = actions.permissions?.canEdit ?? false;
  const updated = formatUpdated(agent.updatedAt);
  const version = agent.activePromptVersion;

  const meta = [
    version !== null && version !== undefined ? `v${version}` : null,
    updated ? `Last updated ${updated}` : null,
  ].filter((part): part is string => part !== null);

  const editActions = !canEdit ? null : profile.editing ? (
    <>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        onClick={profile.cancel}
        disabled={profile.saving}
        className='rounded-lg'
        data-track-category='Claw Agents'
        data-track-name='Agent profile: cancel edits'
      >
        Cancel
      </Button>
      <Button
        type='button'
        variant='default'
        size='sm'
        onClick={() => void profile.save()}
        disabled={!profile.canSave}
        loading={profile.saving}
        className='rounded-lg'
        data-track-category='Claw Agents'
        data-track-name='Agent profile: save edits'
        data-testid='agent-profile-save'
      >
        Save
      </Button>
    </>
  ) : (
    <Button
      type='button'
      variant='outline'
      size='sm'
      onClick={profile.start}
      className='rounded-lg'
      data-track-category='Claw Agents'
      data-track-name='Agent profile: start editing'
      data-testid='agent-profile-edit'
    >
      <PencilEditLine size={14} className='mr-1 shrink-0' />
      Edit
    </Button>
  );

  return (
    <AgentCreateCanvas
      form={profile.form}
      onFormChange={profile.patch}
      onFieldFocus={noop}
      highlights={NO_HIGHLIGHTS}
      conflicts={[]}
      onResolveConflict={noop}
      phase='draft'
      layout='profile'
      viewOnly={!profile.editing}
      handleLocked={!actions.isOwner}
      scheduleLocked
      saving={profile.saving}
      handleError={profile.error ?? (profile.slugChanged ? HANDLE_WARNING : null)}
      topBar={topBar}
      banner={banner}
      avatar={<AgentBotAvatar agentKey={agent.id} asleep={!agent.enabled} size={56} />}
      nameBadge={
        <Pill tone={agent.enabled ? 'success' : 'neutral'}>
          {agent.enabled ? 'Enabled' : 'Disabled'}
        </Pill>
      }
      handleMeta={
        meta.length > 0 ? (
          <span className='text-[13px] font-medium leading-4 tracking-[-0.14px] text-muted-foreground'>
            · {meta.join(' · ')}
          </span>
        ) : null
      }
      identityActions={editActions}
      onOpenSettings={onOpenSettings}
      floatingChat={chat}
    />
  );
}

function ProfileSkeleton(): ReactElement {
  return (
    <div className='flex w-full flex-col items-center px-4 pt-[4.5rem]'>
      <div className='flex w-full max-w-[860px] flex-col gap-4'>
        <div className='flex items-center gap-4'>
          <Skeleton className='size-14 rounded-2xl' />
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-6 w-52' />
            <Skeleton className='h-4 w-32' />
          </div>
        </div>
        <Skeleton className='mt-10 h-4 w-24' />
        <Skeleton className='h-9 w-full' />
        <Skeleton className='h-9 w-full' />
        <Skeleton className='mt-10 h-32 w-full rounded-2xl' />
      </div>
    </div>
  );
}

/** The loaded agent's profile, with its settings in a modal on top (`?settings=<tab>`). */
function AgentProfile({
  agent,
  actions,
  chat,
  topBar,
  banner,
}: {
  agent: Agent;
  actions: AgentDetailActions;
  chat: ReactNode;
  topBar: ReactNode;
  banner: ReactNode;
}): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const profile = useAgentProfileForm(agent, actions.isOwner);

  const settingsTab = settingsTabFromParams(searchParams);
  // The tab stays put while the modal closes, so it doesn't flash back to Persona.
  const [shownTab, setShownTab] = useState<AgentSettingsTabId>(settingsTab ?? 'persona');
  if (settingsTab && settingsTab !== shownTab) setShownTab(settingsTab);

  const showSettings = (tab: AgentSettingsTabId | null): void => {
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    if (tab) params.set(SETTINGS_PARAM, tab);
    else params.delete(SETTINGS_PARAM);
    // Keep the router state (where Back goes, the just-created banner).
    const state: unknown = location.state;
    setSearchParams(params, { replace: true, state });
  };

  return (
    <>
      <AgentProfileCanvas
        agent={agent}
        actions={actions}
        profile={profile}
        chat={chat}
        topBar={topBar}
        banner={banner}
        onOpenSettings={() => showSettings('persona')}
      />
      <SavedAgentSettings
        open={settingsTab !== null}
        onClose={() => showSettings(null)}
        agent={agent}
        actions={actions}
        tab={settingsTab ?? shownTab}
        onTabChange={showSettings}
        onPromptRestored={profile.promptRestored}
      />
    </>
  );
}

const ClawAgentDetailV2 = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const { workspaceId, slug } = useParams<{ workspaceId?: string; slug?: string }>();

  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';
  const requestedReturnPath = (location.state as { returnTo?: unknown } | null)?.returnTo;
  const returnPath =
    typeof requestedReturnPath === 'string' && requestedReturnPath.startsWith('/')
      ? requestedReturnPath
      : `${libraryPath}?tab=agents`;
  const justCreated = (location.state as { justCreated?: unknown } | null)?.justCreated === true;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const dismissBanner = useCallback(() => setBannerDismissed(true), []);

  const { data: agent, isLoading, isError } = useClawAgentDetail(slug);
  const pendingRegistration = agent !== undefined && !isSpacesRegistered(agent);
  const showBanner = !bannerDismissed && (justCreated || pendingRegistration);
  const actions = useAgentDetailActions(agent);
  // The floating chat below replaces the top bar's "Chat with agent".
  const { canOpenAgentChat } = useOpenAgentChat();

  return (
    <div className='flex h-full min-h-0 flex-col' data-component='ClawAgentDetailV2'>
      {isLoading ? (
        <ProfileSkeleton />
      ) : isError || !agent ? (
        <p className='py-16 text-center text-sm text-muted-foreground'>
          Couldn&apos;t load this agent.
        </p>
      ) : (
        <AgentProfile
          agent={agent}
          actions={actions}
          chat={canOpenAgentChat ? <AgentProfileChat agent={agent} /> : null}
          topBar={
            <AgentDetailHeaderV2
              agent={agent}
              actions={actions}
              onChat={noop}
              canChat={false}
              onBack={() => void navigate(returnPath)}
            />
          }
          banner={
            showBanner ? (
              <AgentCreatedBanner
                agent={agent}
                pendingRegistration={pendingRegistration}
                onDismiss={dismissBanner}
              />
            ) : null
          }
        />
      )}
    </div>
  );
};

export default ClawAgentDetailV2;
