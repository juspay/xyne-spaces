import { ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import {
  useClawAgentDetail,
  useClawAgentShares,
  clawAgentDetailKey,
} from '@/hooks/useClawAgentDetail';
import { getAgentPermissions } from '@/services/claw/agentPermissions';
import {
  applyBehaviour,
  behaviourDirty,
  EMPTY_BEHAVIOUR_DRAFT,
  readBehaviourDraft,
  validateBehaviour,
  type BehaviourDraft,
} from '@/services/claw/behaviourConfig';
import {
  ClawApiError,
  cloneClawAgent,
  demoteClawAgent,
  deleteClawAgent,
  promoteClawAgent,
  submitClawAgentRequest,
  updateClawAgent,
} from '@/services/claw/clawAuthAgentsService';
import { ClawAgentDetailHeader } from '@/components/ClawAgents/ClawAgentDetailHeader';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { CloneAgentDialog } from '@/components/ClawAgents/CloneAgentDialog';
import { RenameHandleDialog } from '@/components/ClawAgents/RenameHandleDialog';
import PersonaTab from './tabs/PersonaTab';
import BehaviourTab from './tabs/BehaviourTab';
import PeopleTab from './tabs/PeopleTab';
import ModelProviderTab from './tabs/ModelProviderTab';
import ToolsTab from './tabs/ToolsTab';
import KnowledgeTab from './tabs/KnowledgeTab';
import MemoryTab from './tabs/MemoryTab';
import ConnectionsTab from './tabs/ConnectionsTab';
import ScheduleTab from './tabs/ScheduleTab';
import ActivityTab from './tabs/ActivityTab';
import CloneRequestsTab from './tabs/CloneRequestsTab';

interface DetailTab {
  id: string;
  label: string;
}

// Config / manage tabs (top group).
const DETAIL_TABS: DetailTab[] = [
  { id: 'persona', label: 'Persona' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'model', label: 'Model & Provider' },
  { id: 'memory', label: 'Memory' },
  { id: 'people', label: 'People' },
  { id: 'connections', label: 'Connections' },
  { id: 'schedule', label: 'Schedule' },
];

// Sits below a divider, separated from the config tabs.
const ACTIVITY_TAB: DetailTab = { id: 'activity', label: 'Activity' };

const DEFAULT_TAB = DETAIL_TABS[0]!.id;

const TabButton = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='Claw Agents'
    data-track-name={`Agent Detail Tab: ${label}`}
    className={cn(
      'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
      active
        ? 'bg-muted font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )}
  >
    {label}
  </button>
);

/** Turns an unknown thrown value into user-facing copy, special-casing 403. */
const errText = (err: unknown, fallback: string): string => {
  if (err instanceof ClawApiError && err.status === 403) {
    return 'You don’t have permission to do that';
  }
  return err instanceof Error ? err.message : fallback;
};

const DetailShell = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>{children}</div>
);

const ClawAgentDetailScreen = (): ReactElement => {
  const { agentSlug } = useParams<{ agentSlug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data: agent, isLoading, isError } = useClawAgentDetail(agentSlug);
  const { data: shares } = useClawAgentShares(agentSlug);
  const { data: isAdmin = false, isLoading: isAdminLoading } = useIsClawAdmin();

  const permissions = useMemo(() => {
    if (!agent) return null;
    return getAgentPermissions(agent, userId ?? '', shares ?? [], isAdmin);
  }, [agent, userId, shares, isAdmin]);

  const isActualOwner = !!agent && !!userId && agent.ownerUserId === userId;
  const visibleTabs = useMemo(() => {
    const tabs = DETAIL_TABS.filter(tab => tab.id !== 'connections' || permissions?.canEdit);
    return isActualOwner ? [...tabs, { id: 'requests', label: 'Requests' }] : tabs;
  }, [isActualOwner, permissions?.canEdit]);
  const allVisibleTabs = useMemo(() => [...visibleTabs, ACTIVITY_TAB], [visibleTabs]);

  /* ── tab state (persisted in the URL) ──────────────────────────────── */
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = rawTab && allVisibleTabs.some(t => t.id === rawTab) ? rawTab : DEFAULT_TAB;
  const setActiveTab = (id: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  /* ── draft state (Persona) ─────────────────────────────────────────── */
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [behaviour, setBehaviour] = useState<BehaviourDraft>(EMPTY_BEHAVIOUR_DRAFT);

  const updateBehaviour = (patch: Partial<BehaviourDraft>): void =>
    setBehaviour(prev => ({ ...prev, ...patch }));

  // Seed drafts when the loaded agent identity changes (mount / navigate).
  // Keyed on the id only — NOT the whole agent object — so an enabled-toggle
  // cache update doesn't clobber unsaved edits. Post-save we sync drafts
  // explicitly in handleSave.
  useEffect(() => {
    if (!agent) return;
    setDraftName(agent.name);
    setDraftDescription(agent.description ?? '');
    setPrompt(agent.systemPrompt ?? agent.description ?? '');
    setBehaviour(readBehaviourDraft(agent.config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  const dirty = useMemo(() => {
    if (!agent) return false;
    const basePrompt = agent.systemPrompt ?? agent.description ?? '';
    return (
      draftName !== agent.name ||
      draftDescription !== (agent.description ?? '') ||
      prompt !== basePrompt ||
      behaviourDirty(agent.config, behaviour)
    );
  }, [agent, draftName, draftDescription, prompt, behaviour]);

  /* ── action state ──────────────────────────────────────────────────── */
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [moderating, setModerating] = useState<'promote' | 'demote' | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  const handleSave = async (): Promise<void> => {
    if (!agent || !dirty || saving) return;
    // Validate behaviour config (structured-output schema) before hitting the
    // network, so the user gets an inline error instead of a backend 400.
    const validationError = validateBehaviour(behaviour);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateClawAgent(agent.slug, {
        name: draftName.trim(),
        description: draftDescription.trim(),
        systemPrompt: prompt,
        config: applyBehaviour(agent.config, behaviour),
      });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      // Sync drafts to the persisted (trimmed) values so `dirty` clears.
      setDraftName(updated.name);
      setDraftDescription(updated.description ?? '');
      setPrompt(updated.systemPrompt ?? updated.description ?? '');
      setBehaviour(readBehaviourDraft(updated.config));
      toast.success('Changes saved');
    } catch (err) {
      toast.error(errText(err, 'Failed to save changes'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (next: boolean): Promise<void> => {
    if (!agent || toggling) return;
    setToggling(true);
    const prev = agent;
    // Optimistic — the header reads `agent.enabled` for both badge and switch.
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, enabled: next });
    try {
      const updated = await updateClawAgent(agent.slug, { enabled: next });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success(`${agent.name} ${next ? 'enabled' : 'paused'}`);
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), prev);
      toast.error(errText(err, 'Failed to update agent'));
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!agent || !userId || deleting) return;
    setDeleting(true);
    try {
      await deleteClawAgent(agent.slug, userId);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success(`${agent.name} deleted`);
      void navigate('/claw-agents');
    } catch (err) {
      toast.error(errText(err, 'Failed to delete agent'));
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const handleClone = async (name: string): Promise<void> => {
    if (!agent || !userId || cloning) return;
    setCloning(true);
    try {
      const result = await cloneClawAgent(agent.slug, userId, name);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      setCloneOpen(false);
      if (result.cloned && result.agent) {
        toast.success(`Cloned “${agent.name}”`);
        void navigate(`/claw-agents/agents/${result.agent.slug}?tab=persona`);
      } else {
        toast.success('Clone request sent', {
          description: `${agent.name}’s owner will review it.`,
        });
      }
    } catch (err) {
      if (err instanceof ClawApiError && err.status === 409) {
        toast.info('Request already pending');
        setCloneOpen(false);
      } else {
        toast.error(errText(err, 'Clone failed'));
      }
    } finally {
      setCloning(false);
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (!agent || !userId || publishing) return;
    setPublishing(true);
    try {
      await submitClawAgentRequest(agent.slug, userId, 'push_to_global');
      toast.success('Publish request sent', { description: 'An admin will review it.' });
    } catch (err) {
      toast.error(errText(err, 'Publish failed'));
    } finally {
      setPublishing(false);
    }
  };

  const handleModerate = async (action: 'promote' | 'demote'): Promise<void> => {
    if (!agent || !userId || moderating) return;
    setModerating(action);
    const previous = agent;
    const nextScope = action === 'promote' ? 'global' : 'personal';
    queryClient.setQueryData(clawAgentDetailKey(agent.slug), { ...agent, scope: nextScope });
    try {
      if (action === 'promote') {
        await promoteClawAgent(agent.slug, userId);
      } else {
        await demoteClawAgent(agent.slug, userId);
      }
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      void queryClient.invalidateQueries({ queryKey: clawAgentDetailKey(agent.slug) });
      toast.success(
        `${agent.name} ${action === 'promote' ? 'promoted to global' : 'demoted to personal'}`,
      );
    } catch (err) {
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), previous);
      toast.error(errText(err, `${action === 'promote' ? 'Promote' : 'Demote'} failed`));
    } finally {
      setModerating(null);
    }
  };

  const handleRename = async (newSlug: string): Promise<void> => {
    if (!agent || !isActualOwner) return;
    try {
      const updated = await updateClawAgent(agent.slug, { slug: newSlug });
      queryClient.removeQueries({ queryKey: clawAgentDetailKey(agent.slug), exact: true });
      queryClient.setQueryData(clawAgentDetailKey(newSlug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      toast.success(`Handle renamed to @${newSlug}`);
      void navigate(`/claw-agents/agents/${newSlug}?tab=persona`, { replace: true });
    } catch (error) {
      if (error instanceof ClawApiError && error.status === 409) {
        throw new Error(`The handle “${newSlug}” is already in use.`);
      }
      throw new Error(errText(error, 'Could not rename this handle'));
    }
  };

  /* ── render guards ─────────────────────────────────────────────────── */
  if ((isLoading && !agent) || isAdminLoading || (agent && !permissions)) {
    return (
      <DetailShell>
        <div className='flex gap-8'>
          <div className='hidden w-44 shrink-0 flex-col gap-2 self-start pt-16 md:flex'>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className='h-7 w-full' />
            ))}
          </div>
          <div className='flex min-w-0 flex-1 flex-col gap-6'>
            <Skeleton className='h-12 w-full' />
            <div className='flex max-w-2xl flex-col gap-6'>
              <Skeleton className='h-9 w-full' />
              <Skeleton className='h-9 w-full' />
              <Skeleton className='h-60 w-full' />
            </div>
          </div>
        </div>
      </DetailShell>
    );
  }

  if (isError || !agent || !permissions || !permissions.canViewPage) {
    return (
      <div className='mx-auto flex w-full max-w-7xl flex-col items-center gap-3 px-6 py-24 text-center'>
        <p className='text-sm text-muted-foreground'>
          This agent doesn’t exist or you can’t access it.
        </p>
        <Link
          to='/claw-agents'
          className='inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2'
        >
          <ChevronLeft className='size-4' />
          Back to agents
        </Link>
      </div>
    );
  }

  return (
    <DetailShell>
      <div className='flex gap-8'>
        {/* Left: back button + tab triggers. */}
        <div className='sticky top-0 hidden w-44 shrink-0 flex-col self-start md:flex'>
          <div className='flex items-center border-b border-transparent pt-4 pb-4'>
            <Link
              to='/claw-agents'
              className='inline-flex items-center gap-1 text-sm leading-7 text-muted-foreground transition-colors hover:text-foreground'
            >
              <ChevronLeft className='size-4' />
              Back
            </Link>
          </div>
          <nav className='flex flex-col gap-1 pt-6'>
            {visibleTabs.map(tab => (
              <TabButton
                key={tab.id}
                label={tab.label}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
            <div className='my-2 border-t border-border' />
            <TabButton
              label={ACTIVITY_TAB.label}
              active={activeTab === ACTIVITY_TAB.id}
              onClick={() => setActiveTab(ACTIVITY_TAB.id)}
            />
          </nav>
        </div>

        {/* Right: header action bar + active tab content. */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <ClawAgentDetailHeader
            agent={agent}
            permissions={permissions}
            userId={userId}
            isAdmin={isAdmin}
            dirty={dirty}
            saving={saving}
            onSave={() => void handleSave()}
            toggling={toggling}
            onToggleEnabled={next => void handleToggleEnabled(next)}
            cloning={cloning}
            onClone={() => setCloneOpen(true)}
            publishing={publishing}
            onPublish={() => void handlePublish()}
            onDelete={() => setDeleteOpen(true)}
            moderating={moderating}
            onModerate={action => void handleModerate(action)}
          />

          <div className='pt-6'>
            {activeTab === 'persona' ? (
              <PersonaTab
                agent={agent}
                permissions={permissions}
                draftName={draftName}
                onDraftNameChange={setDraftName}
                draftDescription={draftDescription}
                onDraftDescriptionChange={setDraftDescription}
                prompt={prompt}
                onPromptChange={setPrompt}
                isActualOwner={isActualOwner}
                onRenameRequested={() => setRenameOpen(true)}
              />
            ) : activeTab === 'behaviour' ? (
              <BehaviourTab
                permissions={permissions}
                value={behaviour}
                onChange={updateBehaviour}
              />
            ) : activeTab === 'people' ? (
              <PeopleTab agent={agent} permissions={permissions} />
            ) : activeTab === 'model' ? (
              <ModelProviderTab agent={agent} isActualOwner={isActualOwner} />
            ) : activeTab === 'tools' ? (
              <ToolsTab agent={agent} permissions={permissions} />
            ) : activeTab === 'knowledge' ? (
              <KnowledgeTab agent={agent} permissions={permissions} />
            ) : activeTab === 'memory' ? (
              <MemoryTab agent={agent} permissions={permissions} />
            ) : activeTab === 'connections' ? (
              <ConnectionsTab agent={agent} permissions={permissions} />
            ) : activeTab === 'schedule' ? (
              <ScheduleTab agent={agent} permissions={permissions} />
            ) : activeTab === 'requests' && isActualOwner ? (
              <CloneRequestsTab agent={agent} />
            ) : activeTab === 'activity' ? (
              <ActivityTab agent={agent} permissions={permissions} />
            ) : (
              <PersonaTab
                agent={agent}
                permissions={permissions}
                draftName={draftName}
                onDraftNameChange={setDraftName}
                draftDescription={draftDescription}
                onDraftDescriptionChange={setDraftDescription}
                prompt={prompt}
                onPromptChange={setPrompt}
                isActualOwner={isActualOwner}
                onRenameRequested={() => setRenameOpen(true)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Dialogs render outside the flex row (portalled to body). */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={open => {
          setDeleteOpen(open);
          if (!open) setDeleting(false);
        }}
        title='Delete agent?'
        description={`“${agent.name}” will be permanently deleted. This can’t be undone.`}
        confirmLabel='Delete'
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />

      <CloneAgentDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        sourceName={agent.name}
        needsApproval={!permissions.canEdit}
        submitting={cloning}
        onConfirm={name => void handleClone(name)}
      />

      <RenameHandleDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        currentHandle={agent.slug}
        onRename={handleRename}
      />
    </DetailShell>
  );
};

export default ClawAgentDetailScreen;
