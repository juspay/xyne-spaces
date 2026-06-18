import React from 'react';
import { Pencil, CircleHelp } from 'lucide-react';
import { Switch } from '../../../ui/Switch';
import Tooltip from '../../../ui/Tooltip';
import { AIClassificationConfig } from '../AIClassificationConfig';
import { AutoDraftAgentPicker } from '../AutoDraftAgentPicker';
import { PriorityClassificationConfigPanel } from '../PriorityClassificationConfig';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import type { useDeskSettingsForm } from '../useDeskSettingsForm';

type DeskSettingsForm = ReturnType<typeof useDeskSettingsForm>;

interface AIFeaturesTabProps {
  form: DeskSettingsForm;
}

export const AIFeaturesTab: React.FC<AIFeaturesTabProps> = ({ form }) => {
  const allUserGroups = useUserGroups();
  const {
    canManage,
    autoAIDraft,
    setAutoAIDraft,
    autoDraftAgentSlug,
    setAutoDraftAgentSlug,
    classificationEnabledDraft,
    setClassificationEnabled,
    priorityEnabledDraft,
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
  } = form;

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

  return (
    <>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-[16px]'>
            <div className='flex items-center gap-1.5'>
              <div className='text-sm font-medium text-foreground'>Auto AI draft</div>
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
            <Switch
              variant='desk'
              checked={autoAIDraft}
              onCheckedChange={setAutoAIDraft}
              disabled={!canManage}
            />
          </div>
          <div className='text-desk-helper w-full max-w-[400px]'>
            Automatically prepare an AI-generated draft reply each time a new email arrives on this
            desk. Drafts are shared across the team.
          </div>
        </div>
        {autoAIDraft && (
          <AutoDraftAgentPicker
            compact
            value={autoDraftAgentSlug}
            onChange={setAutoDraftAgentSlug}
            clawAgents={clawAgents}
            disabled={!canManage}
          />
        )}
      </div>

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
    </>
  );
};
