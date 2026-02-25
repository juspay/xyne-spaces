import { ReactElement, useState, useEffect } from 'react';
import { apiInstance } from '../../../../services/clients/apiClient';
import { toast } from 'sonner';

interface CustomInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CustomInstructionsModal = ({
  isOpen,
  onClose,
}: CustomInstructionsModalProps): ReactElement | null => {
  const [instruction, setInstruction] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

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
      setInstruction(response.data.instruction || '');
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
      toast.success('Custom instructions cleared');
    } catch {
      toast.error('Failed to clear custom instructions');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50'>
      <div className='bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between p-6 border-b border-gray-200'>
          <h2 className='text-xl font-semibold text-gray-900'>Custom Instructions</h2>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-gray-100 transition-colors'
            disabled={isSaving}
            data-track-category='XYNE_AI'
            data-track-name='CloseCustomInstructionsModal'
          >
            <img src='/svgs/icons/close.svg' alt='Close' width='16' height='16' />
          </button>
        </div>

        {/* Content */}
        <div className='p-6 overflow-y-auto flex-1'>
          <div className='space-y-4'>
            {/* Textarea */}
            <div>
              <label htmlFor='instruction' className='block text-sm font-medium text-gray-900 mb-2'>
                Instructions
              </label>
              <textarea
                id='instruction'
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder={
                  isLoading ? 'Loading...' : 'Additional behavior, style, and tone preferences'
                }
                className='w-full h-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm'
                disabled={isSaving || isLoading}
                data-track-category='XYNE_AI'
                data-track-name='EditCustomInstructions'
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className='flex items-center justify-between p-6 border-t border-gray-200'>
          <button
            onClick={() => void handleClear()}
            className='px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors'
            disabled={isSaving || isLoading || !instruction}
            data-track-category='XYNE_AI'
            data-track-name='ClearCustomInstructions'
          >
            Clear
          </button>
          <div className='flex gap-2'>
            <button
              onClick={onClose}
              className='px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors'
              disabled={isSaving}
              data-track-category='XYNE_AI'
              data-track-name='CancelCustomInstructions'
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={isSaving || isLoading || !instruction.trim()}
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
