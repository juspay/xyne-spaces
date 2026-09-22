import { logger, Event as LogEvent } from '../../../../utils/logger';
/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useState, useCallback, useEffect } from 'react';
import { ArrowLeft, X, Settings } from 'lucide-react';
import type { UserActivity } from '../../../../hooks/useUserActivity';
import { useUserActivity } from '../../../../hooks/useUserActivity';
import { useActivityAliases, ActivityAlias } from '../../../../hooks/useActivityAliases';
import { useCanManageUserActivity } from '../../../../hooks/usePermissions';
import { UserActivityItem } from './UserActivityItem';
import { ActivityConfigDialog } from './ActivityConfigDialog';
import { AliasManager } from './AliasManager';
import { useIntersectionObserver } from '../../../../hooks/useIntersectionObserver';
import { usePlatform } from '../../../../hooks/usePlatform';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';

interface UserActivityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToChat: (activities: UserActivity[]) => void;
}

interface ConfigDialogState {
  isOpen: boolean;
  eventName: string;
  eventCategory: string;
  aliasEventName?: string;
  aliasEventCategory?: string;
  hasExistingAlias: boolean;
  existingAliasId?: string;
  isBlacklisted?: boolean;
}

const initialConfigState: ConfigDialogState = {
  isOpen: false,
  eventName: '',
  eventCategory: '',
  hasExistingAlias: false,
};

export const UserActivityPanel = ({
  isOpen,
  onClose,
  onAddToChat,
}: UserActivityPanelProps): ReactElement | null => {
  const { isMobile } = usePlatform();
  const mobileActionButtonClass =
    'flex p-4 justify-center items-center gap-2 rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-accent aspect-square';
  const { activities, isLoading, hasMore, loadMore, refresh } = useUserActivity();
  const {
    aliases,
    refresh: refreshAliases,
    createAlias,
    updateAlias,
    deleteAlias,
  } = useActivityAliases();
  const canManageUserActivity = useCanManageUserActivity();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [configDialog, setConfigDialog] = useState<ConfigDialogState>(initialConfigState);
  const [aliasManagerOpen, setAliasManagerOpen] = useState(false);

  // Reset selection when panel opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
      setLastSelectedId(null);
      void refresh();
    }
  }, [isOpen, refresh]);

  // Infinite scroll
  const loadMoreRef = useIntersectionObserver(
    () => {
      void loadMore();
    },
    { threshold: 0.1, triggerOnce: false },
  );

  const handleToggle = useCallback(
    (activity: UserActivity, isShiftKey: boolean, isMetaKey: boolean) => {
      if (isShiftKey && lastSelectedId) {
        // Range selection
        const ids = activities.map(a => a.id);
        const startIdx = ids.indexOf(lastSelectedId);
        const endIdx = ids.indexOf(activity.id);
        if (startIdx !== -1 && endIdx !== -1) {
          const range = ids.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
          setSelectedIds(prev => new Set([...prev, ...range]));
        }
      } else if (isMetaKey) {
        // Toggle single (add/remove)
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(activity.id)) {
            next.delete(activity.id);
          } else {
            next.add(activity.id);
          }
          return next;
        });
        setLastSelectedId(activity.id);
      } else {
        // Single select (clear others unless already selected)
        setSelectedIds(prev => {
          if (prev.has(activity.id) && prev.size === 1) {
            return new Set();
          }
          return new Set([activity.id]);
        });
        setLastSelectedId(activity.id);
      }
    },
    [activities, lastSelectedId],
  );

  const handleAddToChat = useCallback(() => {
    const selectedActivities = activities.filter(a => selectedIds.has(a.id));
    onAddToChat(selectedActivities);
    setSelectedIds(new Set());
  }, [activities, selectedIds, onAddToChat]);

  const handleClose = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    onClose();
  }, [onClose]);

  const handleXyneAIClose = (): void => {
    xyneAIActor.send({ type: 'CLOSE' });
  };

  const handleConfigure = useCallback(
    (activity: UserActivity) => {
      // Use original names as the key for alias lookup
      const eventName = activity.originalEventName;
      const eventCategory = activity.originalEventCategory;

      // Find existing alias for this activity
      const existingAlias = aliases.find(
        a => a.eventName === eventName && a.eventCategory === eventCategory,
      );

      if (existingAlias) {
        setConfigDialog({
          isOpen: true,
          eventName,
          eventCategory,
          aliasEventName: existingAlias.aliasEventName,
          aliasEventCategory: existingAlias.aliasEventCategory,
          hasExistingAlias: true,
          existingAliasId: existingAlias.id,
          isBlacklisted: existingAlias.isBlacklisted,
        });
      } else {
        setConfigDialog({
          isOpen: true,
          eventName,
          eventCategory,
          hasExistingAlias: false,
          isBlacklisted: false,
        });
      }
    },
    [aliases],
  );

  const handleConfigSave = useCallback(
    async (config: {
      aliasEventName: string;
      aliasEventCategory: string;
      isBlacklisted: boolean;
    }) => {
      try {
        if (configDialog.hasExistingAlias && configDialog.existingAliasId) {
          await updateAlias(configDialog.existingAliasId, {
            aliasEventName: config.aliasEventName,
            aliasEventCategory: config.aliasEventCategory,
            isBlacklisted: config.isBlacklisted,
          });
        } else {
          await createAlias({
            eventName: configDialog.eventName,
            eventCategory: configDialog.eventCategory,
            aliasEventName: config.aliasEventName,
            aliasEventCategory: config.aliasEventCategory,
            isBlacklisted: config.isBlacklisted,
          });
        }
        await refresh();
        await refreshAliases();
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error saving alias:'),
          error: error,
        });
      }
    },
    [configDialog, createAlias, updateAlias, refresh, refreshAliases],
  );

  const handleEditAlias = useCallback((alias: ActivityAlias) => {
    setConfigDialog({
      isOpen: true,
      eventName: alias.eventName,
      eventCategory: alias.eventCategory,
      aliasEventName: alias.aliasEventName,
      aliasEventCategory: alias.aliasEventCategory,
      hasExistingAlias: true,
      existingAliasId: alias.id,
      isBlacklisted: alias.isBlacklisted,
    });
    setAliasManagerOpen(false);
  }, []);

  const handleDeleteAlias = useCallback(
    async (id: string) => {
      try {
        await deleteAlias(id);
        await refresh();
        await refreshAliases();
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error deleting alias:'),
          error: error,
        });
      }
    },
    [deleteAlias, refresh, refreshAliases],
  );

  if (!isOpen) return null;

  const selectedCount = selectedIds.size;

  return (
    <div className='flex-1 overflow-hidden flex flex-col bg-background h-full rounded-xl'>
      {/* Header */}
      <div className='h-14 p-4 flex items-center justify-between gap-2 self-stretch border-b border-border flex-shrink-0'>
        <div className='flex items-center gap-2'>
          <button
            onClick={handleClose}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='CLOSE_ACTIVITY_PANEL'
            className={
              isMobile ? mobileActionButtonClass : 'p-1 hover:bg-accent rounded transition-colors'
            }
          >
            <ArrowLeft
              className={isMobile ? 'w-4 h-4 text-foreground' : 'w-4 h-4 text-foreground'}
            />
          </button>
          <span className="text-foreground text-base font-semibold font-['Inter']">
            Your Activity
          </span>
        </div>
        <div className='flex items-center gap-2'>
          {canManageUserActivity && (
            <button
              onClick={() => setAliasManagerOpen(true)}
              data-track-category='XYNE_AI_SIDEBAR'
              data-track-name='OPEN_ALIAS_MANAGER'
              className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-border flex justify-center items-center gap-2 overflow-hidden hover:bg-accent transition-colors'
              title='Manage activity aliases'
              type='button'
            >
              <Settings className='w-4 h-4 text-muted-foreground' />
            </button>
          )}
          {!isMobile && (
            <button
              onClick={handleXyneAIClose}
              data-track-category='XYNE_AI_SIDEBAR'
              data-track-name='CLOSE_XYNE_AI'
              className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            >
              <X className='w-4 h-4 text-muted-foreground' />
            </button>
          )}
        </div>
      </div>

      {/* Activity List */}
      <div className='flex-1 overflow-y-auto min-h-0'>
        {activities.length === 0 && !isLoading ? (
          <div className='px-4 py-8 text-center text-muted-foreground text-sm'>
            No activity yet. Start using the app to see your activity here.
          </div>
        ) : (
          <>
            {activities.map((activity, index) => (
              <div key={activity.id}>
                <UserActivityItem
                  key={activity.id}
                  activity={activity}
                  isSelected={selectedIds.has(activity.id)}
                  onToggle={handleToggle}
                  onConfigure={handleConfigure}
                  canConfigure={canManageUserActivity}
                />
                {index < activities.length - 1 && <div className='border-b border-border' />}
              </div>
            ))}

            {/* Loading state */}
            {isLoading && (
              <div className='px-4 py-4 space-y-3'>
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className='flex items-start gap-3'>
                    <div className='w-4 h-4 bg-muted rounded animate-pulse flex-shrink-0 mt-0.5' />
                    <div className='flex-1 space-y-2'>
                      <div className='h-4 bg-muted rounded animate-pulse w-3/4' />
                      <div className='h-3 bg-muted rounded animate-pulse w-1/2' />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Load more trigger */}
            {hasMore && !isLoading && (
              <div ref={loadMoreRef} className='h-8 flex items-center justify-center'>
                <div className='w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin' />
              </div>
            )}

            {/* End of list */}
            {!hasMore && activities.length > 0 && (
              <div className='px-4 py-4 text-center text-muted-foreground text-xs'>
                No more activity
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer with Add to Chat button */}
      {selectedCount > 0 && (
        <div className='p-4 border-t border-border flex-shrink-0'>
          <button
            onClick={handleAddToChat}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='ADD_ACTIVITY_TO_CHAT'
            className='w-full py-2.5 px-4 bg-action-primary hover:bg-action-primary/90 text-action-primary-foreground text-sm font-medium rounded-lg transition-colors'
          >
            Add {selectedCount} {selectedCount === 1 ? 'activity' : 'activities'} to chat
          </button>
        </div>
      )}

      <AliasManager
        isOpen={aliasManagerOpen}
        onClose={() => setAliasManagerOpen(false)}
        aliases={aliases}
        onEdit={handleEditAlias}
        onDelete={id => void handleDeleteAlias(id)}
      />

      <ActivityConfigDialog
        isOpen={configDialog.isOpen}
        onClose={() => setConfigDialog(initialConfigState)}
        eventName={configDialog.eventName}
        eventCategory={configDialog.eventCategory}
        currentAliasName={configDialog.aliasEventName}
        currentAliasCategory={configDialog.aliasEventCategory}
        hasExistingAlias={configDialog.hasExistingAlias}
        isBlacklisted={configDialog.isBlacklisted}
        onSave={config => void handleConfigSave(config)}
      />
    </div>
  );
};
