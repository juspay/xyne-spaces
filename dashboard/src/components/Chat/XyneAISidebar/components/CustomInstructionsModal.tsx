import { ReactElement, useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { apiInstance } from '../../../../services/clients/apiClient';
import { toast } from 'sonner';

interface CustomInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_INSTRUCTION_LENGTH = 1000;

export const CustomInstructionsModal = ({
  isOpen,
  onClose,
}: CustomInstructionsModalProps): ReactElement | null => {
  const [instruction, setInstruction] = useState<string>('');
  const [originalInstruction, setOriginalInstruction] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showLengthWarning, setShowLengthWarning] = useState<boolean>(false);

  // Load custom instruction on mount
  useEffect(() => {
    if (isOpen) {
      void loadCustomInstruction();
    }
  }, [isOpen]);

  const loadCustomInstruction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const response = await apiInstance.get<{ instruction: string | null }>('/custom-instruction');
      const loadedInstruction = response.data.instruction || '';
      setInstruction(loadedInstruction);
      setOriginalInstruction(loadedInstruction);
      setShowLengthWarning(loadedInstruction.length > MAX_INSTRUCTION_LENGTH);
    } catch {
      toast.error('Failed to load custom instructions');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await apiInstance.put('/custom-instruction', {
        instruction: instruction.trim() || null,
      });
      setOriginalInstruction(instruction);
      toast.success('Custom instructions saved!');
      onClose();
    } catch {
      toast.error('Failed to save custom instructions');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async (): Promise<void> => {
    if (!window.confirm('Are you sure you want to clear your custom instructions?')) {
      return;
    }

    setIsSaving(true);
    try {
      await apiInstance.delete('/custom-instruction');
      setInstruction('');
      setOriginalInstruction('');
      toast.success('Custom instructions cleared');
    } catch {
      toast.error('Failed to clear custom instructions');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-popover rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-6 border-b border-border'>
          <h2 className='text-xl font-semibold text-foreground'>Custom Instructions</h2>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-accent transition-colors'
            disabled={isSaving}
            data-track-category='XYNE_AI'
            data-track-name='CloseCustomInstructionsModal'
          >
            <X size={16} className='text-current' />
          </button>
        </div>

        {/* Content */}
        <div className='p-6 overflow-y-auto flex-1'>
          <div className='space-y-4'>
            {/* Length Warning */}
            {showLengthWarning && (
              <div className='p-3 bg-muted border border-border rounded-lg'>
                <p className='text-sm text-status-pending'>
                  <span className='font-semibold'>Warning:</span> Your custom instructions exceed
                  the {MAX_INSTRUCTION_LENGTH} character limit. Please edit your content to fit
                  within the limit before saving.
                </p>
              </div>
            )}

            {/* Textarea */}
            <div>
              <label
                htmlFor='instruction'
                className='block text-sm font-medium text-foreground mb-2'
              >
                Instructions
              </label>
              <textarea
                id='instruction'
                value={instruction}
                onChange={e => setInstruction(e.target.value.slice(0, MAX_INSTRUCTION_LENGTH))}
                placeholder={
                  isLoading ? 'Loading...' : 'Additional behavior, style, and tone preferences'
                }
                className='w-full h-48 px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent resize-none text-sm'
                disabled={isSaving || isLoading}
                data-track-category='XYNE_AI'
                data-track-name='EditCustomInstructions'
              />
              <div className='flex justify-end mt-1'>
                <span
                  className={`text-xs ${instruction.length >= MAX_INSTRUCTION_LENGTH ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {instruction.length}/{MAX_INSTRUCTION_LENGTH}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between p-6 border-t border-border'>
          <button
            onClick={() => void handleClear()}
            className='px-4 py-2 text-sm font-medium text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors'
            disabled={isSaving || isLoading || !instruction}
            data-track-category='XYNE_AI'
            data-track-name='ClearCustomInstructions'
          >
            Clear
          </button>
          <div className='flex gap-2'>
            <button
              onClick={onClose}
              className='px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors'
              disabled={isSaving}
              data-track-category='XYNE_AI'
              data-track-name='CancelCustomInstructions'
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary hover:bg-action-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={isSaving || isLoading || instruction.trim() === originalInstruction.trim()}
              data-track-category='XYNE_AI'
              data-track-name='SaveCustomInstructions'
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
