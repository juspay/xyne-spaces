import React, { useState } from 'react';
import Dialog from '../Dialog/Dialog';
import { RadioGroup, Radio } from '../RadioGroup/RadioGroup';
import Textarea from '../Textarea/Textarea';
import { Button } from '../Button/Button';

interface CreatePRDModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (customPrompt?: string) => Promise<void>;
  isLoading: boolean;
}

export const CreatePRDModal: React.FC<CreatePRDModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  isLoading,
}) => {
  const [mode, setMode] = useState<'standard' | 'custom'>('standard');
  const [customPrompt, setCustomPrompt] = useState('');

  const MAX_PROMPT_LENGTH = 5000;
  const isCustomPromptEmpty = mode === 'custom' && customPrompt.trim().length === 0;
  const isCustomPromptTooLong = customPrompt.length > MAX_PROMPT_LENGTH;
  const isGenerateDisabled = isCustomPromptEmpty || isCustomPromptTooLong;

  const handleGenerate = () => {
    if (isGenerateDisabled) {
      return;
    }

    if (mode === 'standard') {
      void onGenerate();
    } else {
      void onGenerate(customPrompt.trim());
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title='Generate PRD'
      description='Choose how you want to generate the Product Requirements Document.'
    >
      <div className='p-6'>
        <div className='mb-6'>
          <h2 className='text-lg font-semibold leading-none tracking-tight'>Generate PRD</h2>
          <p className='text-sm text-muted-foreground mt-2'>
            Choose how you want to generate the Product Requirements Document.
          </p>
        </div>

        <div className='grid gap-4'>
          <RadioGroup
            value={mode}
            onChange={val => setMode(val as 'standard' | 'custom')}
            className='flex flex-col gap-4'
          >
            <Radio
              value='standard'
              subtext='Generate a standard PRD based on the entire call transcript.'
            >
              Standard PRD
            </Radio>
            <Radio value='custom' subtext='Provide specific details or focus areas for the PRD.'>
              Custom Instructions
            </Radio>
          </RadioGroup>

          {mode === 'custom' && (
            <div className='grid gap-2 pl-8'>
              <Textarea
                placeholder='E.g., Focus on the API authentication flow and error handling...'
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                rows={4}
                maxLength={MAX_PROMPT_LENGTH}
                className='resize-none'
              />
              <div className='flex justify-between text-xs text-muted-foreground'>
                <span>
                  {customPrompt.length > 4500 && customPrompt.length <= MAX_PROMPT_LENGTH && (
                    <span className='text-status-pending'>Approaching limit</span>
                  )}
                </span>
                <span className={isCustomPromptTooLong ? 'text-destructive' : ''}>
                  {customPrompt.length}/{MAX_PROMPT_LENGTH} characters
                </span>
              </div>
            </div>
          )}

          <div className='flex justify-end gap-2 mt-4'>
            <Button variant='outline' onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} loading={isLoading} disabled={isGenerateDisabled}>
              Generate
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
