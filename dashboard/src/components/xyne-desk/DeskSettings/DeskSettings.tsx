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
import { AiSyncTab } from './tabs/AiSyncTab';
import { TagsTab } from './tabs/TagsTab';
import { MetricsTab } from './tabs/MetricsTab';
import { Inbox, Route, Zap, Bot, RefreshCw, Tag, X, BarChart3 } from 'lucide-react';

/** Props for the DeskSettings modal component */
export interface DeskSettingsProps {
  open: boolean;
  onClose: () => void;
  channelId: string | null;
  userID: string | null | undefined;
}

export type TabId =
  | 'inbox'
  | 'assignment'
  | 'automation'
  | 'ai-features'
  | 'ai-sync'
  | 'tags'
  | 'metrics';

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
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'tags', label: 'Tag Generation', icon: Tag },
  { id: 'ai-features', label: 'AI Features', icon: Bot },
  { id: 'ai-sync', label: 'AI Sync', icon: RefreshCw },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
];

/**
 * Desk Settings modal for inbox configuration.
 */
export const DeskSettings: React.FC<DeskSettingsProps> = ({ open, onClose, channelId, userID }) => {
  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const [signatures] = useCachedQuery(queries.userEmailSignatures());

  const form = useDeskSettingsForm(channelId, userID, open);
  const { isEmail, isDirty, saving, save, cancel, sendAsAliasError, classificationConfigError } =
    form;
  const saveBlockedReason = sendAsAliasError ?? classificationConfigError;

  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose]);

  const availableTabs = useMemo(
    () =>
      isEmail
        ? DESK_SETTINGS_TABS
        : DESK_SETTINGS_TABS.filter(tab => tab.id !== 'automation' && tab.id !== 'tags'),
    [isEmail],
  );

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
      className='max-w-[1200px] max-h-[800px] bg-transparent shadow-none rounded-none'
    >
      {!channelId ? null : (
        <div className='relative'>
          <button
            type='button'
            onClick={requestClose}
            className='absolute left-[96%] z-10 mt-[8px] ml-2 top-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-desk-border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
            data-track-category='DeskSettings'
            data-track-name='CloseButton'
          >
            <X size={16} />
          </button>
          <div className='isolate flex h-[82vh] max-h-[800px] flex-col overflow-hidden rounded-[12px] border border-desk-border bg-popover shadow-lg dark:border-border'>
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
                      <button
                        key={tab.id}
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
                    );
                  })}
                </div>
              </div>

              <div className='flex-1 min-w-0 overflow-y-auto scrollbar-none pt-[28px] pb-[16px] px-6 md:px-12 lg:px-[86px]'>
                <div className='flex flex-col gap-[32px]'>
                  {activeTab === 'inbox' && (
                    <InboxTab channelId={channelId} form={form} signatures={signatures} />
                  )}
                  {activeTab === 'assignment' && <AssignmentTab form={form} />}
                  {activeTab === 'automation' && <AutomationTab form={form} />}
                  {activeTab === 'tags' && <TagsTab form={form} />}
                  {activeTab === 'ai-features' && <AIFeaturesTab form={form} />}
                  {activeTab === 'ai-sync' && <AiSyncTab channelId={channelId} form={form} />}
                  {activeTab === 'metrics' && <MetricsTab form={form} />}
                </div>
              </div>
            </div>
            {isDirty && activeTab !== 'ai-sync' && activeTab !== 'tags' && (
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
                  <button
                    type='button'
                    onClick={() => void save()}
                    disabled={saving || !!saveBlockedReason}
                    title={saveBlockedReason ?? undefined}
                    className='rounded-[10px] border border-desk-accent bg-desk-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
                    data-track-category='DeskSettings'
                    data-track-name='SaveAll'
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
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
