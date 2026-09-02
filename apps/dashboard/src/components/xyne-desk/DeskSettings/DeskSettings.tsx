import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useDeskSettingsForm } from './useDeskSettingsForm';
import { InboxTab } from './tabs/InboxTab';
import { AssignmentTab } from './tabs/AssignmentTab';
import { AutomationTab } from './tabs/AutomationTab';
import { AIFeaturesTab } from './tabs/AIFeaturesTab';
import { MetricsTab } from './tabs/MetricsTab';
import { Inbox, Route, Zap, Bot, X, BarChart3 } from 'lucide-react';
import { Button } from '../../ui/Button/Button';

/** Props for the DeskSettings modal component */
export interface DeskSettingsProps {
  open: boolean;
  onClose: () => void;
  channelId: string | null;
  userID: string | null | undefined;
}

export type TabId = 'inbox' | 'assignment' | 'automation' | 'Agent' | 'metrics';

/** Configuration for a single settings tab */
export interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

export interface DeskSignature {
  id: string;
  name: string;
  content: string;
}

export const DESK_SETTINGS_TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'assignment', label: 'Assignment & Routing', icon: Route },
  { id: 'automation', label: 'Automations', icon: Zap },
  { id: 'Agent', label: 'Agent', icon: Bot },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export type AIFeaturesSubTabId = 'ai-draft' | 'knowledge' | 'attribution' | 'ai-sync';

export const AI_FEATURES_SUB_TABS: { id: AIFeaturesSubTabId; label: string }[] = [
  { id: 'ai-draft', label: 'AI Draft' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'ai-sync', label: 'AI Sync' },
];

/**
 * Desk Settings modal for inbox configuration.
 */
export const DeskSettings: React.FC<DeskSettingsProps> = ({ open, onClose, channelId, userID }) => {
  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const [activeAIFeaturesSubTab, setActiveAIFeaturesSubTab] =
    useState<AIFeaturesSubTabId>('ai-draft');
  const [signatures] = useCachedQuery(queries.userEmailSignatures());

  const form = useDeskSettingsForm(channelId, userID, open);
  const {
    isEmail,
    isCall,
    isDirty,
    saving,
    save,
    cancel,
    sendAsAliasError,
    classificationConfigError,
  } = form;
  const saveBlockedReason = sendAsAliasError ?? classificationConfigError;
  const effectiveAIFeaturesSubTab =
    !form.autoAIDraft && activeAIFeaturesSubTab === 'knowledge'
      ? 'ai-draft'
      : activeAIFeaturesSubTab;

  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const availableTabs = useMemo(() => {
    if (isCall) {
      return DESK_SETTINGS_TABS.filter(tab => ['assignment', 'Agent'].includes(tab.id));
    }
    return isEmail ? DESK_SETTINGS_TABS : DESK_SETTINGS_TABS.filter(tab => tab.id !== 'automation');
  }, [isCall, isEmail]);

  useEffect(() => {
    if (!availableTabs.some(tab => tab.id === activeTab)) {
      setActiveTab(availableTabs[0]?.id ?? 'inbox');
    }
  }, [availableTabs, activeTab]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestClose();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title='Desk Settings'
      className={cn(
        'left-auto right-0 top-0 bottom-0 translate-x-0 translate-y-0 h-screen w-[80vw] max-w-none max-h-none rounded-l-[16px] rounded-r-none bg-transparent shadow-none',
        'data-[state=open]:!zoom-in-100 data-[state=open]:!slide-in-from-top-[0%] data-[state=open]:!slide-in-from-right-full',
        'data-[state=closed]:!zoom-out-100 data-[state=closed]:!slide-out-to-top-[0%] data-[state=closed]:!slide-out-to-right-full',
      )}
    >
      {!channelId ? null : (
        <div className='relative h-full w-full'>
          <button
            type='button'
            onClick={requestClose}
            className='absolute right-4 top-4 z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-desk-border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
            data-track-category='DeskSettings'
            data-track-name='CloseButton'
          >
            <X size={16} />
          </button>
          <div className='isolate flex h-full w-full flex-col overflow-hidden rounded-l-[16px] border border-desk-border bg-popover shadow-2xl dark:border-border'>
            <div className='flex flex-1 min-h-0'>
              <div className='w-[240px] shrink-0 flex flex-col px-[8px] border-r border-desk-border dark:border-border'>
                <div className='text-lg font-semibold text-foreground shrink-0 pt-[24px] px-[8px] pb-[16px]'>
                  Desk Settings
                </div>
                <div className='flex flex-col gap-[8px]'>
                  {availableTabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <React.Fragment key={tab.id}>
                        <button
                          type='button'
                          onClick={() => setActiveTab(tab.id)}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm font-[550] leading-[1.2] tracking-[-0.1px] transition-colors text-left',
                            isActive
                              ? 'bg-accent text-foreground'
                              : 'text-desk-muted hover:bg-accent/50',
                          )}
                          data-track-category='DeskSettings'
                          data-track-name={`Tab_${tab.id}`}
                        >
                          <Icon size={16} />
                          <span>{tab.label}</span>
                        </button>
                        {tab.id === 'Agent' && isActive && (
                          <div className='flex flex-col gap-[2px] pl-[30px]'>
                            {AI_FEATURES_SUB_TABS.filter(
                              subTab => subTab.id !== 'knowledge' || form.autoAIDraft,
                            ).map(subTab => {
                              const isSubActive = effectiveAIFeaturesSubTab === subTab.id;
                              return (
                                <button
                                  key={subTab.id}
                                  type='button'
                                  onClick={() => setActiveAIFeaturesSubTab(subTab.id)}
                                  className={cn(
                                    'px-3 py-1.5 rounded-[8px] text-sm leading-[1.2] tracking-[-0.1px] transition-colors text-left',
                                    isSubActive
                                      ? 'text-foreground font-[550] bg-accent/60'
                                      : 'text-desk-muted hover:bg-accent/40',
                                  )}
                                  data-track-category='DeskSettings'
                                  data-track-name={`AIFeaturesSubTab_${subTab.id}`}
                                >
                                  {subTab.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {activeTab === 'automation' ? (
                <div className='flex-1 min-w-0 overflow-hidden pt-12'>
                  <AutomationTab channelId={channelId} />
                </div>
              ) : (
                <div className='flex-1 min-w-0 overflow-y-auto scrollbar-none pt-[28px] pb-[16px] px-6 md:px-12 lg:px-[86px]'>
                  <div className='flex flex-col gap-[32px]'>
                    {activeTab === 'inbox' && (
                      <InboxTab channelId={channelId} form={form} signatures={signatures} />
                    )}
                    {activeTab === 'assignment' && <AssignmentTab form={form} />}
                    {activeTab === 'Agent' && (
                      <AIFeaturesTab
                        channelId={channelId}
                        form={form}
                        section={effectiveAIFeaturesSubTab}
                      />
                    )}
                    {activeTab === 'metrics' && <MetricsTab form={form} />}
                  </div>
                </div>
              )}
            </div>
            {isDirty && activeTab !== 'automation' && (
              <div className='shrink-0 border-t border-desk-border px-6 md:px-12 lg:px-[86px] py-[12px] dark:border-border'>
                <div className='flex items-center justify-end gap-[8px]'>
                  <button
                    type='button'
                    onClick={cancel}
                    disabled={saving}
                    className='rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
                    data-track-category='DeskSettings'
                    data-track-name='CancelAll'
                  >
                    Cancel
                  </button>
                  <Button
                    variant='ghost'
                    type='button'
                    onClick={() => void save()}
                    disabled={saving || !!saveBlockedReason}
                    title={saveBlockedReason ?? undefined}
                    className='rounded-[10px] border border-desk-accent bg-desk-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
                    data-track-category='DeskSettings'
                    data-track-name='SaveAll'
                    trackId='desk_settings_save'
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirmDiscardOpen}
        onOpenChange={next => {
          if (!next) setConfirmDiscardOpen(false);
        }}
        title='Discard unsaved changes?'
        description='You have unsaved changes that will be lost.'
        className='max-w-sm p-5'
      >
        <div className='flex flex-col gap-[8px]'>
          <div className='text-base font-semibold text-foreground'>Discard unsaved changes?</div>
          <div className='text-sm text-muted-foreground'>
            You have unsaved changes on this desk. If you leave now, they’ll be lost.
          </div>
          <div className='mt-[12px] flex items-center justify-end gap-[8px]'>
            <button
              type='button'
              onClick={() => setConfirmDiscardOpen(false)}
              className='rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent'
              data-track-category='DeskSettings'
              data-track-name='KeepEditing'
            >
              Keep editing
            </button>
            <button
              type='button'
              onClick={() => {
                setConfirmDiscardOpen(false);
                onClose();
              }}
              className='rounded-[10px] border border-red-500 bg-red-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500'
              data-track-category='DeskSettings'
              data-track-name='DiscardChanges'
            >
              Discard changes
            </button>
          </div>
        </div>
      </Dialog>
    </Dialog>
  );
};
