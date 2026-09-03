import React from 'react';
import { Settings, Shield } from 'lucide-react';
import Popover from '../ui/Popover';
import { Button } from '../ui/Button/Button';
import { Switch } from '../ui/Switch';
import { useSelector } from '@xstate/react';
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { isElectronApp } from '../../utils/electronApp';

interface BrowserSettingsMenuProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const BrowserSettingsMenu: React.FC<BrowserSettingsMenuProps> = ({ isOpen, setIsOpen }) => {
  const browserSettings = useSelector(browserPanelActor, state => state.context.browserSettings);

  const handleUpdateSetting = (key: keyof typeof browserSettings, value: boolean) => {
    // Optimistic UI update via state machine
    browserPanelActor.send({
      type: 'UPDATE_SETTINGS',
      settings: { ...browserSettings, [key]: value },
    });

    // Send to main process
    if (isElectronApp() && window.electronAPI?.setBrowserSettings) {
      void window.electronAPI.setBrowserSettings({ [key]: value });
    }
  };

  const handleClearSiteData = async () => {
    if (isElectronApp() && window.electronAPI?.clearSiteData) {
      const res = await window.electronAPI.clearSiteData();
      if (res?.success) {
        // Handled silently for now, as UI doesn't have a toast notification readily configured here
      }
    }
    setIsOpen(false);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      trigger={
        <button
          className='p-1.5 rounded-md hover:bg-border text-muted-foreground transition-colors'
          title='Browser Settings'
        >
          <Settings size={16} />
        </button>
      }
      side='bottom'
      align='end'
      className='w-72'
    >
      <div className='flex flex-col gap-4'>
        <div className='font-medium text-sm text-foreground'>Site Settings</div>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2 text-sm text-foreground'>
            <Shield size={16} className='text-muted-foreground' />
            <span>Popups and redirects</span>
          </div>
          <Switch
            checked={browserSettings.popups}
            onCheckedChange={(val: boolean) => handleUpdateSetting('popups', val)}
          />
        </div>

        <div className='h-px bg-border my-1' />

        <Button
          variant='ghost'
          onClick={() => {
            void handleClearSiteData();
          }}
          trackId='clear_site_data'
          className='h-auto w-full justify-start text-left text-sm text-red-500 hover:bg-red-500/10 hover:text-red-500 px-2 py-1.5 rounded-md transition-colors font-medium border border-transparent hover:border-red-500/20'
          data-track-category='browser_settings'
          data-track-name='clear_site_data'
        >
          Clear Site Data
        </Button>
      </div>
    </Popover>
  );
};
