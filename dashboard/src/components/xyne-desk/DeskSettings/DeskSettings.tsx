import React, { useState, useEffect, useMemo } from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useDeskSettingsForm } from './useDeskSettingsForm';
import { InboxTab } from './tabs/InboxTab';
import { AssignmentTab } from './tabs/AssignmentTab';
import { AutomationTab } from './tabs/AutomationTab';
import { AIFeaturesTab } from './tabs/AIFeaturesTab';
import { Inbox, Route, Zap, Bot, X } from 'lucide-react';

/** Props for the DeskSettings modal component */
export interface DeskSettingsProps {
  open: boolean;
  onClose: () => void;
  channelId: string | null;
  userID: string | null | undefined;
}

export type TabId = 'inbox' | 'assignment' | 'automation' | 'ai-features';

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
  { id: 'ai-features', label: 'AI Features', icon: Bot },
];

/**
 * Desk Settings modal for inbox configuration.
 */
export const DeskSettings: React.FC<DeskSettingsProps> = ({ open, onClose, channelId, userID }) => {
  const [activeTab, setActiveTab] = useState<TabId>('inbox');
  const [signatures] = useCachedQuery(queries.userEmailSignatures());

  const form = useDeskSettingsForm(channelId, userID, open);
  const { isEmail } = form;

  const availableTabs = useMemo(
    () =>
      isEmail ? DESK_SETTINGS_TABS : DESK_SETTINGS_TABS.filter(tab => tab.id !== 'automation'),
    [isEmail],
  );

  useEffect(() => {
    if (!availableTabs.some(tab => tab.id === activeTab)) {
      setActiveTab(availableTabs[0]?.id ?? 'inbox');
    }
  }, [availableTabs, activeTab]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
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
            onClick={onClose}
            className='absolute left-[96%] z-10 mt-[8px] ml-2 top-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-desk-border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
            data-track-category='DeskSettings'
            data-track-name='CloseButton'
          >
            <X size={16} />
          </button>
          <div className='isolate flex h-[82vh] max-h-[800px] flex-col overflow-hidden rounded-[12px] border border-desk-border bg-popover shadow-lg dark:border-border'>
            <div className='flex flex-1 min-h-0'>
              <div className='w-[240px] shrink-0 flex flex-col px-[8px]'>
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
                  {activeTab === 'ai-features' && <AIFeaturesTab form={form} />}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};
