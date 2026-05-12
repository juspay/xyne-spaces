import React, { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { PrioritySettingsModal } from './PrioritySettingsModal';
import { usePriorityClassification } from '../../../hooks/usePriorityClassification';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import type { SavePriorityConfigPayload } from '../../../types/priorityClassification';

interface PrioritySettingsProps {
  channelId: string;
  canManage?: boolean;
}

export const PrioritySettings: React.FC<PrioritySettingsProps> = ({
  channelId,
  canManage = false,
}) => {
  const [modalOpen, setModalOpen] = useState(false);

  const {
    config,
    isLoading,
    isSaving,
    saveConfig,
    previewResult,
    isPreviewing,
    runPreview,
    error,
  } = usePriorityClassification(channelId);

  const handleToggle = useCallback(async () => {
    const newEnabled = !(config?.enabled ?? false);

    const payload: SavePriorityConfigPayload = {
      enabled: newEnabled,
      priorityClassificationPrompt: config?.priorityClassificationPrompt ?? null,
      priorityClassificationThreshold: config?.priorityClassificationThreshold ?? 0.5,
    };

    try {
      await saveConfig(payload);
    } catch {
      toast.error('Failed to update priority classification', {
        description: 'Your change was not saved.',
      });
      return;
    }

    if (newEnabled) {
      toast.success('Priority classification enabled', {
        description: 'Incoming emails will be automatically prioritized using AI.',
      });
    } else {
      toast.info('Priority classification disabled');
    }
  }, [config, saveConfig]);

  const enabled = config?.enabled ?? false;
  const threshold = config?.priorityClassificationThreshold ?? 0.5;

  return (
    <>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Tooltip content='Only the inbox owner can manage priority settings' side='top'>
            <button
              type='button'
              role='switch'
              aria-checked={enabled}
              onClick={() => void handleToggle()}
              disabled={isLoading || isSaving || !canManage}
              title={enabled ? 'Disable priority classification' : 'Enable priority classification'}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                enabled ? 'bg-[#6276be]' : 'bg-secondary'
              }`}
              data-track-category='PrioritySettings'
              data-track-name='TogglePriorityClassification'
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </Tooltip>
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2'>
              <p className='text-sm font-medium text-foreground'>AI Priority Detection</p>
              {enabled && (
                <span className='inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700'>
                  Active
                </span>
              )}
            </div>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Automatically detect ticket priority from email content using AI.
              {enabled && threshold > 0 && (
                <span className='ml-1 text-xs text-muted-foreground'>
                  (Threshold: {(threshold * 100).toFixed(0)}%)
                </span>
              )}
            </p>
          </div>
        </div>
        <Tooltip content='Only the inbox owner can manage priority settings' side='top'>
          <button
            type='button'
            onClick={() => setModalOpen(true)}
            disabled={isLoading || !canManage}
            className='px-3 py-1.5 text-sm font-medium text-white bg-[#6276be] rounded-lg hover:bg-[#4f62a8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            data-track-category='PrioritySettings'
            data-track-name='OpenPrioritySettingsModal'
          >
            Configure
          </button>
        </Tooltip>
      </div>

      <PrioritySettingsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        channelId={channelId}
        config={config}
        enabled={enabled}
        isSaving={isSaving}
        saveConfig={saveConfig}
        previewResult={previewResult}
        isPreviewing={isPreviewing}
        runPreview={runPreview}
        error={error}
      />
    </>
  );
};
