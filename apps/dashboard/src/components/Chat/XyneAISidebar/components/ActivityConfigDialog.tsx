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
      <div className='bg-popover rounded-lg shadow-lg w-full max-w-md mx-4 overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <h2 className='text-lg font-semibold text-foreground'>
            {hasExistingAlias ? 'Edit Activity Alias' : 'Create Activity Alias'}
          </h2>
          <button
            onClick={onClose}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='CLOSE_ACTIVITY_CONFIG'
            className='p-1 hover:bg-accent rounded transition-colors'
            type='button'
          >
            <X className='w-5 h-5 text-muted-foreground' />
          </button>
        </div>

        {/* Body */}
        <div className='p-4 space-y-4'>
          {/* Original Key Info (read-only) */}
          <div className='bg-muted rounded-md p-3 space-y-2'>
            <div className='flex items-center gap-2'>
              <span className='text-xs text-muted-foreground uppercase font-medium'>
                Original Key Name
              </span>
              <span className='text-xs text-muted-foreground'>(cannot change)</span>
            </div>
            <div className='text-sm font-medium text-foreground font-mono'>{eventName}</div>
            <div className='pt-1'>
              <span className='text-xs text-muted-foreground uppercase font-medium'>
                Original Key Category
              </span>
              <div className='text-sm font-medium text-foreground font-mono'>{eventCategory}</div>
            </div>
          </div>

          {/* Current Alias Display (if exists) */}
          {hasExistingAlias && currentAliasName && currentAliasCategory && (
            <div className='bg-muted rounded-md p-3 space-y-2 border border-border'>
              <div className='flex items-center gap-2'>
                <Pencil className='w-3.5 h-3.5 text-primary' />
                <span className='text-xs text-primary uppercase font-medium'>Current Alias</span>
              </div>
              <div className='text-sm font-medium text-foreground'>{currentAliasName}</div>
              <div className='pt-1'>
                <span className='text-xs text-primary uppercase font-medium'>Current Category</span>
                <div className='text-sm font-medium text-foreground'>{currentAliasCategory}</div>
              </div>
            </div>
          )}

          {/* Blacklist Toggle */}
          <div className='flex items-center gap-3 p-3 bg-destructive/10 rounded-md'>
            <input
              type='checkbox'
              id='blacklist'
              checked={isBlacklisted}
              onChange={e => handleBlacklistChange(e.target.checked)}
              data-track-category='XYNE_AI_SIDEBAR'
              data-track-name='TOGGLE_ACTIVITY_BLACKLIST'
              className='w-4 h-4 text-destructive border-border rounded focus:ring-destructive/20'
            />
            <label htmlFor='blacklist' className='flex-1 text-sm text-destructive cursor-pointer'>
              Blacklist this activity
              <span className='block text-xs text-destructive mt-0.5'>
                This activity will be hidden from the activity list
              </span>
            </label>
          </div>

          {/* New Name Input */}
          {!isBlacklisted && (
            <>
              <div className='bg-muted rounded-lg p-4 space-y-4 border border-border'>
                <div>
                  <label
                    htmlFor='newName'
                    className='block text-sm font-medium text-muted-foreground mb-1.5'
                  >
                    New Display Name
                  </label>
                  <input
                    type='text'
                    id='newName'
                    value={newEventName}
                    onChange={e => setNewEventName(e.target.value)}
                    placeholder='Enter display name'
                    className='w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all'
                  />
                </div>

                <div>
                  <label
                    htmlFor='newCategory'
                    className='block text-sm font-medium text-muted-foreground mb-1.5'
                  >
                    New Display Category
                  </label>
                  <input
                    type='text'
                    id='newCategory'
                    value={newEventCategory}
                    onChange={e => setNewEventCategory(e.target.value)}
                    placeholder='Enter display category'
                    className='w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition-all'
                  />
                </div>
              </div>

              {/* Warning if updating existing alias */}
              {hasExistingAlias && (
                <div className='flex items-start gap-2 p-3 bg-muted rounded-md border border-border'>
                  <AlertTriangle className='w-4 h-4 text-status-pending mt-0.5 flex-shrink-0' />
                  <div className='text-sm text-status-pending'>
                    This will overwrite the existing alias. The new name will be shown for all
                    users.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Error message */}
          {error && (
            <div className='text-sm text-destructive bg-destructive/10 p-2 rounded'>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className='flex justify-end gap-2 px-4 py-3 border-t border-border bg-muted'>
          <button
            onClick={onClose}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='CANCEL_ACTIVITY_CONFIG'
            className='px-4 py-2 text-sm font-medium text-muted-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors'
            type='button'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            data-ph-capture-attribute-track-id='save_activity_config'
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='SAVE_ACTIVITY_CONFIG'
            className='px-4 py-2 text-sm font-medium text-action-primary-foreground bg-action-primary rounded-md hover:bg-action-primary/90 transition-colors'
            type='button'
          >
            {hasExistingAlias ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
