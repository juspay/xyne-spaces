import React from 'react';
import { Pencil } from 'lucide-react';
import { Switch } from '../../../ui/Switch';
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
    autoDraftAgentSlug,
    handleAutoDraftChange,
    handleAutoDraftAgentChange,
    clawAgents,
    classificationEnabled,
    handleClassificationToggle,
    handlePriorityToggle,
    priorityConfig,
    savePriorityConfig,
    priorityPreviewResult,
    isPriorityPreviewing,
    runPriorityPreview,
    priorityError,
    aiFeatureConfig,
    setAiFeatureConfig,
    openClassificationConfig,
    openPriorityConfig,
    classificationConfig,
    classificationMappings,
    saveClassificationConfig,
    saveClassificationMapping,
    updateClassificationMapping,
    deleteClassificationMapping,
    classificationPreviewResult,
    isClassificationPreviewing,
    isClassificationSaving,
    runClassificationPreview,
    classificationError,
  } = form;

  if (aiFeatureConfig === 'priority') {
    return (
      <PriorityClassificationConfigPanel
        canManage={canManage}
        onBack={() => setAiFeatureConfig('none')}
        config={priorityConfig ?? null}
        saveConfig={savePriorityConfig}
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
        config={classificationConfig}
        mappings={classificationMappings}
        saveConfig={saveClassificationConfig}
        saveMapping={saveClassificationMapping}
        updateMapping={updateClassificationMapping}
        deleteMapping={deleteClassificationMapping}
        previewResult={classificationPreviewResult}
        isPreviewing={isClassificationPreviewing}
        isSaving={isClassificationSaving}
        runPreview={runClassificationPreview}
        error={classificationError}
      />
    );
  }

  return (
    <>
      <div className='flex flex-col gap-3'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-[16px]'>
              <div className='text-sm font-medium text-foreground'>Auto AI draft</div>
              <Switch
                variant='desk'
                checked={autoAIDraft}
                onCheckedChange={handleAutoDraftChange}
                disabled={!canManage}
              />
            </div>
            <div className='text-desk-helper w-full max-w-[400px]'>
              Automatically prepare an AI-generated draft reply each time a new email arrives on
              this desk. Drafts are shared across the team.
              {autoAIDraft && (
                <>
                  {' '}
                  The selected agent is also used when you click Ask AI later while composing a
                  reply.
                </>
              )}
            </div>
          </div>
        </div>
        {autoAIDraft && (
          <AutoDraftAgentPicker
            value={autoDraftAgentSlug}
            onChange={handleAutoDraftAgentChange}
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
              checked={priorityConfig?.enabled ?? false}
              onCheckedChange={handlePriorityToggle}
              disabled={!canManage}
            />
          </div>
          <div className='text-desk-helper w-full max-w-[400px]'>
            Automatically detect ticket priority from email content using AI.
          </div>
        </div>
        <button
          type='button'
          className='inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent active:border-border disabled:opacity-50'
          onClick={e => {
            e.currentTarget.blur();
            openPriorityConfig();
          }}
          disabled={!canManage}
          data-track-category='DeskSettings'
          data-track-name='ConfigurePriority'
        >
          <Pencil size={14} />
          Configure
        </button>
      </div>

      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <div className='text-sm font-medium text-foreground'>Auto-Classification</div>
            <Switch
              variant='desk'
              checked={classificationEnabled}
              onCheckedChange={handleClassificationToggle}
              disabled={!canManage}
            />
          </div>
          <div className='text-desk-helper w-full max-w-[400px]'>
            Automatically classify and assign incoming tickets using AI.
          </div>
        </div>
        <button
          type='button'
          className='inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent active:border-border disabled:opacity-50'
          onClick={e => {
            e.currentTarget.blur();
            openClassificationConfig();
          }}
          disabled={!canManage}
          data-track-category='DeskSettings'
          data-track-name='ConfigureClassification'
        >
          <Pencil size={14} />
          Configure
        </button>
      </div>
    </>
  );
};
