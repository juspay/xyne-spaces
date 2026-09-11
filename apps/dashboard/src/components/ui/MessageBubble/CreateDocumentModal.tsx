import React, { useEffect, useRef, useState } from 'react';
import Dialog from '../Dialog/Dialog';
import { RadioGroup, Radio } from '../RadioGroup/RadioGroup';
import Textarea from '../Textarea/Textarea';
import { Button } from '../Button/Button';
import { usePlatform } from '../../../hooks/usePlatform';

interface CreateDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (customPrompt?: string) => Promise<void>;
  isLoading: boolean;
  title: string;
  description: string;
  standardOptionLabel: string;
  standardOptionSubtext: string;
  customOptionLabel: string;
  customOptionSubtext: string;
  customInputPlaceholder: string;
}

export const CreateDocumentModal: React.FC<CreateDocumentModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  isLoading,
  title,
  description,
  standardOptionLabel,
  standardOptionSubtext,
  customOptionLabel,
  customOptionSubtext,
  customInputPlaceholder,
}) => {
  const [mode, setMode] = useState<'standard' | 'custom'>('standard');
  const [customPrompt, setCustomPrompt] = useState('');
  const customPromptRef = useRef<HTMLTextAreaElement>(null);
  const { isMobile } = usePlatform();

  const MAX_PROMPT_LENGTH = 5000;
  const isCustomPromptEmpty = mode === 'custom' && customPrompt.trim().length === 0;
  const isCustomPromptTooLong = customPrompt.length > MAX_PROMPT_LENGTH;
  const isGenerateDisabled = isCustomPromptEmpty || isCustomPromptTooLong;
  useEffect(() => {
    if (isOpen && mode === 'custom' && !isMobile) {
      const rafId = requestAnimationFrame(() => {
        customPromptRef.current?.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }

    return undefined;
  }, [isOpen, mode, isMobile]);

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
    <Dialog open={isOpen} onOpenChange={handleOpenChange} title={title} description={description}>
      <div className='p-6'>
        <div className='mb-6'>
          <h2 className='text-lg font-semibold leading-none tracking-tight text-foreground'>
            {title}
          </h2>
          <p className='text-sm text-muted-foreground mt-2'>{description}</p>
        </div>

        <div className='grid gap-4'>
          <RadioGroup
            value={mode}
            onChange={val => setMode(val as 'standard' | 'custom')}
            className='flex flex-col gap-4'
          >
            <Radio value='standard' subtext={standardOptionSubtext}>
              {standardOptionLabel}
            </Radio>
            <Radio value='custom' subtext={customOptionSubtext}>
              {customOptionLabel}
            </Radio>
          </RadioGroup>

          {mode === 'custom' && (
            <div className='grid gap-2 pl-8'>
              <Textarea
                ref={customPromptRef}
                placeholder={customInputPlaceholder}
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
            <Button
              variant='outline'
              onClick={onClose}
              data-track-category='MESSAGE'
              data-track-name='CANCEL_CREATE_DOCUMENT'
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              data-track-category='MESSAGE'
              data-track-name='GENERATE_DOCUMENT'
              loading={isLoading}
              disabled={isGenerateDisabled}
            >
              Generate
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
