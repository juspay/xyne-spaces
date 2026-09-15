import React, { useState } from 'react';
import type { AppAction, ActionedItem } from '../../../utils/markdownAppActions';
import { conversationService } from '../../../services/Chat/conversationService';
import { toast } from 'sonner';

interface AppActionsProps {
  appActions: AppAction[];
  actioned: ActionedItem[];
  messageId: string;
  conversationId: string;
}

export const AppActions: React.FC<AppActionsProps> = ({
  appActions,
  actioned,
  messageId,
  conversationId,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleClick = async (action: AppAction) => {
    setLoadingAction(action.actionId);
    try {
      await conversationService.dispatchAppAction({
        actionId: action.actionId,
        actionableUrl: action.actionableUrl,
        context: action.context ?? {},
        messageId,
        conversationId,
      });
      toast.success(`"${action.label}" completed`);
    } catch (error) {
      toast.error(`Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingAction(null);
    }
  };

  if (appActions.length === 0 && actioned.length === 0) return null;

  return (
    <div className='mt-3 flex flex-wrap items-center gap-2'>
      {/* Actioned items (read-only status) */}
      {actioned.map(item => (
        <span
          key={item.actionId}
          className='inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium opacity-60'
          style={{
            backgroundColor: `${item.color}20`,
            color: item.color,
          }}
        >
          {item.label}
          <span className='text-muted-foreground'>
            {new Date(item.actionedAt).toLocaleString()}
          </span>
        </span>
      ))}

      {/* Pending action buttons */}
      {appActions.map(action => {
        const isLoading = loadingAction === action.actionId;

        return (
          <button
            key={action.actionId}
            onClick={() => void handleClick(action)}
            data-track-category='MESSAGE'
            data-track-name='CLICK_APP_ACTION'
            data-track-metadata={JSON.stringify({ actionId: action.actionId })}
            disabled={isLoading || loadingAction !== null}
            className='inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed'
            style={{ backgroundColor: action.color }}
          >
            {isLoading ? 'Processing...' : action.label}
          </button>
        );
      })}
    </div>
  );
};
