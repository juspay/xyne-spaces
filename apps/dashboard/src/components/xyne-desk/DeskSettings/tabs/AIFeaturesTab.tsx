import React, { useState, useEffect, useCallback } from 'react';
import { Pencil, CircleHelp, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '../../../ui/Switch';
import Tooltip from '../../../ui/Tooltip';
import { AIClassificationConfig } from '../AIClassificationConfig';
import { AutoDraftAgentPicker } from '../AutoDraftAgentPicker';
import { AutoDraftAgentChatPanel } from '../AutoDraftAgentChatPanel';
import { PriorityClassificationConfigPanel } from '../PriorityClassificationConfig';
import { TagGenerationConfig } from '../TagGenerationConfig';
import { useClawAgentDetail } from '../../../../hooks/useClawAgentDetail';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import { apiInstance } from '../../../../services/clients/apiClient';
import { Button } from '../../../ui/Button/Button';
import KnowledgeTab from '../../../../routes/ClawAgentsScreen/tabs/KnowledgeTab';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';
import type { AIFeaturesSubTabId } from '../DeskSettings';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AIFeaturesTabProps {
  channelId: string;
  form: DeskSettingsForm;
  section: AIFeaturesSubTabId;
}

export const AIFeaturesTab: React.FC<AIFeaturesTabProps> = ({ channelId, form, section }) => {
  const allUserGroups = useUserGroups();
  const {
    canManage,
    autoAIDraft,
    setAutoAIDraft,
    autoDraftAgentSlug,
    setAutoDraftAgentSlug,
    classificationEnabledDraft,
    classificationEnabledSaved,
    setClassificationEnabled,
    priorityEnabledDraft,
    priorityEnabledSaved,
    setPriorityEnabled,
    clawAgents,
    aiFeatureConfig,
    setAiFeatureConfig,
    openClassificationConfig,
    openPriorityConfig,
    // classification config (controlled)
    classificationPromptDraft,
    setClassificationPromptDraft,
    categoryFieldDraft,
    setCategoryFieldDraft,
    subCategoryFieldDraft,
    setSubCategoryFieldDraft,
    classificationMappings,
    saveClassificationMapping,
    updateClassificationMapping,
    deleteClassificationMapping,
    classificationPreviewResult,
    isClassificationPreviewing,
    runClassificationPreview,
    classificationError,
    classificationConfigError,
    // priority config (controlled)
    priorityPromptDraft,
    setPriorityPromptDraft,
    priorityThresholdDraft,
    setPriorityThresholdDraft,
    priorityPreviewResult,
    isPriorityPreviewing,
    runPriorityPreview,
    priorityError,
    // tag generation
    tagCategories,
    isTagConfigLoading,
    isTagConfigSaving,
    tagConfigError,
    saveTagCategories,
    // AI sync
    autoAIDraftSaved,
  } = form;
  const knowledgeAgentSlug = autoAIDraft ? (autoDraftAgentSlug ?? undefined) : undefined;
  const { data: knowledgeAgent, isError: isKnowledgeAgentError } =
    useClawAgentDetail(knowledgeAgentSlug);

  if (aiFeatureConfig === 'priority') {
    return (
      <PriorityClassificationConfigPanel
        canManage={canManage}
        onBack={() => setAiFeatureConfig('none')}
        prompt={priorityPromptDraft}
        setPrompt={setPriorityPromptDraft}
        threshold={priorityThresholdDraft}
        setThreshold={setPriorityThresholdDraft}
        previewResult={priorityPreviewResult ?? null}
        isPreviewing={isPriorityPreviewing}
        runPreview={runPriorityPreview}
        error={priorityError ?? null}
      />
    );
  }

  if (aiFeatureConfig === 'auto-classification') {
    return (
      <AIClassificationConfig
        canManage={canManage}
        onBack={() => setAiFeatureConfig('none')}
        userGroups={allUserGroups ?? []}
        classificationPrompt={classificationPromptDraft}
        setClassificationPrompt={setClassificationPromptDraft}
        categoryField={categoryFieldDraft}
        setCategoryField={setCategoryFieldDraft}
        subCategoryField={subCategoryFieldDraft}
        setSubCategoryField={setSubCategoryFieldDraft}
        mappings={classificationMappings}
        saveMapping={saveClassificationMapping}
        updateMapping={updateClassificationMapping}
        deleteMapping={deleteClassificationMapping}
        previewResult={classificationPreviewResult}
        isPreviewing={isClassificationPreviewing}
        runPreview={runClassificationPreview}
        error={classificationError}
        validationError={classificationConfigError}
      />
    );
  }

  if (section === 'ai-draft') {
    return (
      <div className='flex flex-col gap-[20px]'>
        <div className='flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-1.5'>
              <div className='text-desk-label text-[15px] font-semibold'>Auto AI draft</div>
              <Tooltip
                content={
                  <div className='flex max-w-[260px] flex-col gap-1'>
                    <span>
                      Add a Claw agent to this channel to pick it as the draft agent — until then
                      the built-in Xyne AI is used.
                    </span>
                    <span>
                      The selected agent is also used when you click Ask AI while composing a reply.
                    </span>
                  </div>
                }
              >
                <button
                  type='button'
                  className='text-desk-muted hover:text-foreground'
                  aria-label='About the draft agent'
                >
                  <CircleHelp size={14} />
                </button>
              </Tooltip>
            </div>
            <div className='text-desk-helper w-full max-w-[400px]'>
              Automatically prepare an AI-generated draft reply each time a new email arrives on
              this desk. Drafts are shared across the team.
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-3'>
            {autoAIDraft && (
              <AutoDraftAgentPicker
                compact
                value={autoDraftAgentSlug}
                onChange={setAutoDraftAgentSlug}
                clawAgents={clawAgents}
                disabled={!canManage}
              />
            )}
            <Switch
              variant='desk'
              checked={autoAIDraft}
              onCheckedChange={setAutoAIDraft}
              disabled={!canManage}
            />
          </div>
        </div>

        {autoAIDraft && (
          <AutoDraftAgentChatPanel
            channelId={channelId}
            autoDraftAgentSlug={autoDraftAgentSlug}
            clawAgents={clawAgents}
          />
        )}
      </div>
    );
  }

  if (section === 'knowledge' && autoAIDraft) {
    if (!knowledgeAgent) {
      return (
        <div className='rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
          {!autoDraftAgentSlug
            ? 'Choose a Claw agent in AI Draft to view its knowledge.'
            : isKnowledgeAgentError
              ? 'Unable to load this agent’s knowledge.'
              : 'Loading agent knowledge…'}
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-6'>
        <div>
          <div className='text-[15px] font-semibold text-foreground'>
            Knowledge for {knowledgeAgent.name}
          </div>
          <div className='font-mono text-xs text-muted-foreground'>@{knowledgeAgent.slug}</div>
        </div>
        <KnowledgeTab
          agent={knowledgeAgent}
          permissions={{ role: 'viewer', canEdit: false, canShare: false, canViewPage: true }}
        />
      </div>
    );
  }

  if (section === 'attribution') {
    return (
      <AIFeaturesSection
        title='Attribution'
        description='Automatically prioritize, classify, and tag incoming tickets with AI.'
      >
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-[16px]'>
              <div className='text-sm font-medium text-foreground'>AI Priority Detection</div>
              <Switch
                variant='desk'
                checked={priorityEnabledDraft}
                onCheckedChange={setPriorityEnabled}
                disabled={!canManage}
              />
            </div>
            <div className='text-desk-helper w-full max-w-[400px]'>
              Automatically detect ticket priority from email content using AI.
            </div>
          </div>
          <span className={!canManage ? 'shrink-0 cursor-not-allowed' : 'shrink-0'}>
            <button
              type='button'
              disabled={!canManage}
              className='inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent active:border-border disabled:pointer-events-none disabled:opacity-50'
              onClick={e => {
                e.currentTarget.blur();
                openPriorityConfig();
              }}
              data-track-category='DeskSettings'
              data-track-name='ConfigurePriority'
            >
              <Pencil size={14} />
              Configure
            </button>
          </span>
        </div>

        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <div className='text-sm font-medium text-foreground'>Auto-Classification</div>
              <Switch
                variant='desk'
                checked={classificationEnabledDraft}
                onCheckedChange={setClassificationEnabled}
                disabled={!canManage}
              />
            </div>
            <div className='text-desk-helper w-full max-w-[400px]'>
              Automatically classify and assign incoming tickets using AI.
            </div>
          </div>
          <span className={!canManage ? 'shrink-0 cursor-not-allowed' : 'shrink-0'}>
            <button
              type='button'
              disabled={!canManage}
              className='inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent active:border-border disabled:pointer-events-none disabled:opacity-50'
              onClick={e => {
                e.currentTarget.blur();
                openClassificationConfig();
              }}
              data-track-category='DeskSettings'
              data-track-name='ConfigureClassification'
            >
              <Pencil size={14} />
              Configure
            </button>
          </span>
        </div>

        <TagGenerationConfig
          canManage={canManage}
          channelId={channelId}
          categories={tagCategories}
          isLoading={isTagConfigLoading}
          isSaving={isTagConfigSaving}
          error={tagConfigError}
          saveCategories={saveTagCategories}
        />
      </AIFeaturesSection>
    );
  }

  return (
    <AIFeaturesSection
      noDefaultGap
      title='AI Sync'
      description="Re-run AI features on tickets from the last 3 days where they haven't run yet. Enable the toggles for the features you want to include, then click Run AI Sync."
    >
      <AiSyncSection
        channelId={channelId}
        canManage={canManage}
        classificationEnabledSaved={classificationEnabledSaved}
        priorityEnabledSaved={priorityEnabledSaved}
        autoAIDraftSaved={autoAIDraftSaved}
      />
    </AIFeaturesSection>
  );
};

interface AIFeaturesSectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Skip the default inner gap when children manage their own spacing (e.g. AiSyncSection). */
  noDefaultGap?: boolean;
}

const AIFeaturesSection: React.FC<AIFeaturesSectionProps> = ({
  title,
  description,
  children,
  noDefaultGap,
}) => (
  <div className='flex flex-col gap-[20px]'>
    <div className='flex flex-col gap-[4px]'>
      <div className='text-desk-label text-[15px] font-semibold'>{title}</div>
      <div className='text-desk-helper w-full max-w-[500px]'>{description}</div>
    </div>
    <div className={noDefaultGap ? undefined : 'flex flex-col gap-[24px]'}>{children}</div>
  </div>
);

interface AiSyncSectionProps {
  channelId: string;
  canManage: boolean;
  classificationEnabledSaved: boolean;
  priorityEnabledSaved: boolean;
  autoAIDraftSaved: boolean;
}

const AiSyncSection: React.FC<AiSyncSectionProps> = ({
  channelId,
  canManage,
  classificationEnabledSaved,
  priorityEnabledSaved,
  autoAIDraftSaved,
}) => {
  const [syncClassification, setSyncClassification] = useState(false);
  const [syncPriority, setSyncPriority] = useState(false);
  const [syncAutoDraft, setSyncAutoDraft] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncCooldownUntil, setSyncCooldownUntil] = useState<number | null>(null);

  useEffect(() => {
    apiInstance
      .get<{ cooldownActive: boolean }>(`/channels/${channelId}/ai-retrigger/status`)
      .then(res => {
        if (res.data.cooldownActive) {
          setSyncCooldownUntil(Date.now() + 10 * 60 * 1000);
        }
      })
      .catch(() => undefined);
  }, [channelId]);

  // Auto-clear the cooldown when it expires
  useEffect(() => {
    if (syncCooldownUntil === null) return;
    const remaining = syncCooldownUntil - Date.now();
    if (remaining <= 0) {
      setSyncCooldownUntil(null);
      return;
    }
    const timer = setTimeout(() => setSyncCooldownUntil(null), remaining);
    return () => clearTimeout(timer);
  }, [syncCooldownUntil]);

  const inCooldown = syncCooldownUntil !== null && Date.now() < syncCooldownUntil;
  const anySelected = syncClassification || syncPriority || syncAutoDraft;

  const handleSyncToggle = useCallback(
    (
      featureEnabled: boolean,
      featureLabel: string,
      setter: (v: boolean) => void,
      value: boolean,
    ) => {
      if (!value) {
        setter(false);
        return;
      }
      if (!featureEnabled) {
        toast.warning(
          `Enable "${featureLabel}" in AI Features first before including it in AI Sync.`,
        );
        return;
      }
      setter(true);
    },
    [],
  );

  const handleRunSync = useCallback(async (): Promise<void> => {
    if (syncLoading || inCooldown || !anySelected) return;
    setSyncLoading(true);
    const toastId = toast.loading('Running AI Sync…');
    try {
      const res = await apiInstance.post<{
        enqueued: { classify: number; priority: number; draft: number };
        ticketsScanned: number;
        estimatedMinutes: number;
        cooldownSeconds: number;
      }>(`/channels/${channelId}/ai-retrigger`, {
        features: {
          classification: syncClassification,
          priority: syncPriority,
          autoDraft: syncAutoDraft,
        },
      });
      const { enqueued, ticketsScanned, estimatedMinutes, cooldownSeconds } = res.data;
      const total = enqueued.classify + enqueued.priority + enqueued.draft;
      if (cooldownSeconds > 0) setSyncCooldownUntil(Date.now() + cooldownSeconds * 1000);

      if (total === 0) {
        toast.success(`Scanned ${ticketsScanned} tickets — all up to date, nothing to sync.`, {
          id: toastId,
        });
      } else {
        const parts: string[] = [];
        if (enqueued.classify) parts.push(`${enqueued.classify} classification`);
        if (enqueued.priority) parts.push(`${enqueued.priority} priority`);
        if (enqueued.draft) parts.push(`${enqueued.draft} draft`);
        toast.success(
          `AI Sync queued ${parts.join(', ')} across ${ticketsScanned} tickets. ETA ~${estimatedMinutes} min.`,
          { id: toastId },
        );
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
      if (axiosErr?.response?.status === 429) setSyncCooldownUntil(Date.now() + 10 * 60 * 1000);
      toast.error(axiosErr?.response?.data?.error ?? 'AI Sync failed', { id: toastId });
    } finally {
      setSyncLoading(false);
    }
  }, [
    channelId,
    syncLoading,
    inCooldown,
    anySelected,
    syncClassification,
    syncPriority,
    syncAutoDraft,
  ]);

  const NON_OWNER_MSG = 'Only the desk owner or admin can manage AI Sync';

  const MaybeTooltip = ({
    children,
    side,
  }: {
    children: React.ReactElement;
    side: 'left' | 'bottom';
  }): React.ReactElement =>
    canManage ? (
      children
    ) : (
      <Tooltip content={NON_OWNER_MSG} side={side}>
        {children}
      </Tooltip>
    );

  return (
    <div className='flex flex-col gap-[32px]'>
      <div className='flex flex-col gap-[16px]'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-sm font-medium text-foreground'>Auto-Classification</div>
            <div className='text-desk-helper'>
              Re-run classification on tickets where aiCategory is missing.
            </div>
          </div>
          <MaybeTooltip side='left'>
            <span className='inline-flex'>
              <Switch
                variant='desk'
                checked={syncClassification}
                onCheckedChange={v =>
                  handleSyncToggle(
                    classificationEnabledSaved,
                    'Auto-Classification',
                    setSyncClassification,
                    v,
                  )
                }
                disabled={!canManage}
                data-track-category='DeskSettings'
                data-track-name='AiSyncToggleClassification'
              />
            </span>
          </MaybeTooltip>
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-sm font-medium text-foreground'>AI Priority Detection</div>
            <div className='text-desk-helper'>
              Re-run priority detection on tickets where aiPriority is missing.
            </div>
          </div>
          <MaybeTooltip side='left'>
            <span className='inline-flex'>
              <Switch
                variant='desk'
                checked={syncPriority}
                onCheckedChange={v =>
                  handleSyncToggle(
                    priorityEnabledSaved,
                    'AI Priority Detection',
                    setSyncPriority,
                    v,
                  )
                }
                disabled={!canManage}
                data-track-category='DeskSettings'
                data-track-name='AiSyncTogglePriority'
              />
            </span>
          </MaybeTooltip>
        </div>

        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-sm font-medium text-foreground'>Auto AI Draft</div>
            <div className='text-desk-helper'>
              Generate drafts for tickets that don&apos;t have one yet.
            </div>
          </div>
          <MaybeTooltip side='left'>
            <span className='inline-flex'>
              <Switch
                variant='desk'
                checked={syncAutoDraft}
                onCheckedChange={v =>
                  handleSyncToggle(autoAIDraftSaved, 'Auto AI Draft', setSyncAutoDraft, v)
                }
                disabled={!canManage}
                data-track-category='DeskSettings'
                data-track-name='AiSyncToggleAutoDraft'
              />
            </span>
          </MaybeTooltip>
        </div>
      </div>

      <MaybeTooltip side='bottom'>
        <span className='inline-flex self-start'>
          <Button
            type='button'
            variant='ghost'
            trackId='run_ai_sync'
            className='inline-flex h-auto items-center justify-center gap-2 rounded-[10px] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => {
              void handleRunSync();
            }}
            disabled={!canManage || syncLoading || inCooldown || !anySelected}
            data-track-category='DeskSettings'
            data-track-name='RunAiSync'
          >
            {syncLoading ? <Loader2 size={14} className='animate-spin' /> : <Sparkles size={14} />}
            {inCooldown ? 'AI Sync ran recently — wait a few minutes' : 'Run AI Sync'}
          </Button>
        </span>
      </MaybeTooltip>
    </div>
  );
};
