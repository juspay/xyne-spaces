/**
 * SaveTitleModal - Post-recording modal to name the recording
 * Mirrors the native title input modal: auto-generated default, save/skip buttons.
 */

import { ReactElement, useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface SaveTitleModalProps {
  isOpen: boolean;
  defaultTitle: string;
  onSave: (title: string) => void | Promise<void>;
  isSaving: boolean;
}

export function SaveTitleModal({
  isOpen,
  defaultTitle,
  onSave,
  isSaving,
}: SaveTitleModalProps): ReactElement | null {
  const [title, setTitle] = useState(defaultTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(defaultTitle);
      // Focus input after modal opens
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [isOpen, defaultTitle]);

  if (!isOpen) return null;

  const handleSave = (): void => {
    const finalTitle = title.trim() || defaultTitle;
    void onSave(finalTitle);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !isSaving) {
      handleSave();
    }
  };

  return (
    <div className='fixed inset-0 z-[70] flex items-center justify-center'>
      {/* Backdrop */}
      <div className='absolute inset-0 bg-black/50 animate-in fade-in duration-200' />

      {/* Modal */}
      <div className='relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md mx-4 p-6 animate-in zoom-in-95 fade-in duration-200'>
        <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1'>
          Save Recording
        </h2>
        <p className='text-sm text-gray-500 dark:text-gray-400 mb-4'>Give your recording a name</p>

        <input
          ref={inputRef}
          type='text'
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Recording title'
          disabled={isSaving}
          className='w-full px-4 py-3 text-base bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50'
          data-track-category='SaveTitleModal'
          data-track-name='recording_title_input'
        />

        <div className='flex items-center justify-end gap-3 mt-5'>
          <button
            onClick={() => void onSave(defaultTitle)}
            disabled={isSaving}
            className='px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors disabled:opacity-50'
            data-track-category='SaveTitleModal'
            data-track-name='use_default_title'
          >
            Use Default
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className='flex items-center gap-2 px-5 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
            data-track-category='SaveTitleModal'
            data-track-name='save_recording_title'
          >
            {isSaving ? (
              <>
                <Loader2 className='w-4 h-4 animate-spin' />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
