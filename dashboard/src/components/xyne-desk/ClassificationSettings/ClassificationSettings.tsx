import React, { useState } from 'react';
import { toast } from 'sonner';
import { ClassificationSettingsModal } from './ClassificationSettingsModal';
import { useEmailClassification } from '../../../hooks/useEmailClassification';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import type { SaveConfigPayload, UserGroupOption } from '../../../types/classification';

interface ClassificationSettingsProps {
  channelId: string;
  userGroups: UserGroupOption[];
  canManage?: boolean;
}

export const ClassificationSettings: React.FC<ClassificationSettingsProps> = ({
  channelId,
  userGroups,
  canManage = false,
}) => {
  const [modalOpen, setModalOpen] = useState(false);

  const {
    config,
    isLoading,
    isSaving,
    saveConfig,
    createMapping,
    updateMapping,
    deleteMapping,
    previewResult,
    isPreviewing,
    runPreview,
    error,
  } = useEmailClassification(channelId, modalOpen);

  const handleToggle = async () => {
    const newEnabled = !(config?.enabled ?? false);

    if (newEnabled && !config?.classificationPrompt?.trim()) {
      toast.error('Configure classification first', {
        description: 'Add a classification prompt before enabling auto-classification.',
        action: {
          label: 'Configure',
          onClick: () => setModalOpen(true),
        },
      });
      return;
    }

    const payload: SaveConfigPayload = {
      classificationPrompt: config?.classificationPrompt ?? '',
      enabled: newEnabled,
      categoryField: config?.categoryField ?? 'Query Type',
      subCategoryField: config?.subCategoryField ?? null,
    };
    await saveConfig(payload);
  };

  const enabled = config?.enabled ?? false;

  return (
    <>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Tooltip content='Only the inbox owner can manage classification settings' side='top'>
            <button
              type='button'
              role='switch'
              aria-checked={enabled}
              onClick={() => void handleToggle()}
              disabled={isLoading || isSaving || !canManage}
              title={enabled ? 'Disable AI classification' : 'Enable AI classification'}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                enabled ? 'bg-[#6276be]' : 'bg-secondary'
              }`}
              data-track-category='ClassificationSettings'
              data-track-name='ToggleAutoClassification'
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </Tooltip>
          <div>
            <p className='text-sm font-medium text-foreground'>Auto-Classification</p>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Automatically classify and assign incoming tickets using AI.
            </p>
          </div>
        </div>
        <Tooltip content='Only the inbox owner can manage classification settings' side='top'>
          <button
            type='button'
            onClick={() => setModalOpen(true)}
            disabled={isLoading || !canManage}
            className='px-3 py-1.5 text-sm font-medium text-white bg-[#6276be] rounded-lg hover:bg-[#4f62a8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            data-track-category='ClassificationSettings'
            data-track-name='OpenConfigureModal'
          >
            Configure
          </button>
        </Tooltip>
      </div>

      <ClassificationSettingsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        config={config}
        isSaving={isSaving}
        saveConfig={saveConfig}
        createMapping={createMapping}
        updateMapping={updateMapping}
        deleteMapping={deleteMapping}
        previewResult={previewResult}
        isPreviewing={isPreviewing}
        runPreview={runPreview}
        error={error}
        userGroups={userGroups}
      />
    </>
  );
};
