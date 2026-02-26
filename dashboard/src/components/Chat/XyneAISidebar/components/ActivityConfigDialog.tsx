/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useState, useCallback, useEffect } from 'react';
import { X, AlertTriangle, Pencil } from 'lucide-react';

interface ActivityConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventName: string;
  eventCategory: string;
  currentAliasName: string | undefined;
  currentAliasCategory: string | undefined;
  hasExistingAlias: boolean;
  isBlacklisted: boolean | undefined;
  onSave: (config: {
    aliasEventName: string;
    aliasEventCategory: string;
    isBlacklisted: boolean;
  }) => void;
}

export const ActivityConfigDialog = ({
  isOpen,
  onClose,
  eventName,
  eventCategory,
  currentAliasName,
  currentAliasCategory,
  hasExistingAlias,
  isBlacklisted: initialBlacklisted = false,
  onSave,
}: ActivityConfigDialogProps): ReactElement | null => {
  const [newEventName, setNewEventName] = useState('');
  const [newEventCategory, setNewEventCategory] = useState('');
  const [isBlacklisted, setIsBlacklisted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (hasExistingAlias && currentAliasName && currentAliasCategory) {
        setNewEventName(currentAliasName);
        setNewEventCategory(currentAliasCategory);
      } else {
        setNewEventName(eventName);
        setNewEventCategory(eventCategory);
      }
      setIsBlacklisted(initialBlacklisted);
      setError(null);
    }
  }, [
    isOpen,
    hasExistingAlias,
    currentAliasName,
    currentAliasCategory,
    eventName,
    eventCategory,
    initialBlacklisted,
  ]);

  const handleSave = useCallback(() => {
    if (!isBlacklisted && (!newEventName.trim() || !newEventCategory.trim())) {
      setError('Event name and category cannot be empty unless blacklisted');
      return;
    }

    onSave({
      aliasEventName: newEventName.trim(),
      aliasEventCategory: newEventCategory.trim(),
      isBlacklisted,
    });

    onClose();
  }, [isBlacklisted, newEventName, newEventCategory, onSave, onClose]);

  const handleBlacklistChange = useCallback((checked: boolean) => {
    setIsBlacklisted(checked);
    if (checked) {
      setError(null);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50'>
      <div className='bg-white rounded-lg shadow-lg w-full max-w-md mx-4 overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-gray-200'>
          <h2 className='text-lg font-semibold text-gray-900'>
            {hasExistingAlias ? 'Edit Activity Alias' : 'Create Activity Alias'}
          </h2>
          <button
            onClick={onClose}
            className='p-1 hover:bg-gray-100 rounded transition-colors'
            type='button'
          >
            <X className='w-5 h-5 text-gray-500' />
          </button>
        </div>

        {/* Body */}
        <div className='p-4 space-y-4'>
          {/* Original Key Info (read-only) */}
          <div className='bg-gray-50 rounded-md p-3 space-y-2'>
            <div className='flex items-center gap-2'>
              <span className='text-xs text-gray-500 uppercase font-medium'>Original Key Name</span>
              <span className='text-xs text-gray-400'>(cannot change)</span>
            </div>
            <div className='text-sm font-medium text-gray-900 font-mono'>{eventName}</div>
            <div className='pt-1'>
              <span className='text-xs text-gray-500 uppercase font-medium'>
                Original Key Category
              </span>
              <div className='text-sm font-medium text-gray-900 font-mono'>{eventCategory}</div>
            </div>
          </div>

          {/* Current Alias Display (if exists) */}
          {hasExistingAlias && currentAliasName && currentAliasCategory && (
            <div className='bg-blue-50 rounded-md p-3 space-y-2'>
              <div className='flex items-center gap-2'>
                <Pencil className='w-3.5 h-3.5 text-blue-600' />
                <span className='text-xs text-blue-600 uppercase font-medium'>Current Alias</span>
              </div>
              <div className='text-sm font-medium text-blue-900'>{currentAliasName}</div>
              <div className='pt-1'>
                <span className='text-xs text-blue-600 uppercase font-medium'>
                  Current Category
                </span>
                <div className='text-sm font-medium text-blue-900'>{currentAliasCategory}</div>
              </div>
            </div>
          )}

          {/* Blacklist Toggle */}
          <div className='flex items-center gap-3 p-3 bg-red-50 rounded-md'>
            <input
              type='checkbox'
              id='blacklist'
              checked={isBlacklisted}
              onChange={e => handleBlacklistChange(e.target.checked)}
              className='w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500'
            />
            <label htmlFor='blacklist' className='flex-1 text-sm text-red-700 cursor-pointer'>
              Blacklist this activity
              <span className='block text-xs text-red-500 mt-0.5'>
                This activity will be hidden from the activity list
              </span>
            </label>
          </div>

          {/* New Name Input */}
          {!isBlacklisted && (
            <>
              <div className='bg-blue-50/50 rounded-lg p-4 space-y-4 border border-blue-100'>
                <div>
                  <label
                    htmlFor='newName'
                    className='block text-sm font-medium text-gray-700 mb-1.5'
                  >
                    New Display Name
                  </label>
                  <input
                    type='text'
                    id='newName'
                    value={newEventName}
                    onChange={e => setNewEventName(e.target.value)}
                    placeholder='Enter display name'
                    className='w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'
                  />
                </div>

                <div>
                  <label
                    htmlFor='newCategory'
                    className='block text-sm font-medium text-gray-700 mb-1.5'
                  >
                    New Display Category
                  </label>
                  <input
                    type='text'
                    id='newCategory'
                    value={newEventCategory}
                    onChange={e => setNewEventCategory(e.target.value)}
                    placeholder='Enter display category'
                    className='w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'
                  />
                </div>
              </div>

              {/* Warning if updating existing alias */}
              {hasExistingAlias && (
                <div className='flex items-start gap-2 p-3 bg-yellow-50 rounded-md'>
                  <AlertTriangle className='w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0' />
                  <div className='text-sm text-yellow-700'>
                    This will overwrite the existing alias. The new name will be shown for all
                    users.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Error message */}
          {error && <div className='text-sm text-red-600 bg-red-50 p-2 rounded'>{error}</div>}
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50'>
          <button
            onClick={onClose}
            className='px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors'
            type='button'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className='px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors'
            type='button'
          >
            {hasExistingAlias ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
