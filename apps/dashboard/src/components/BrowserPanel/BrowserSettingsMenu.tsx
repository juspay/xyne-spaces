import React, { useEffect, useState } from 'react';
import { Settings, Shield } from 'lucide-react';
import Popover from '../ui/Popover';

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

  const [importState, setImportState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [importSummary, setImportSummary] = useState('');
  const [importAvailable, setImportAvailable] = useState(false);

  useEffect(() => {
    if (!isOpen || !isElectronApp() || !window.electronAPI?.browserImportAvailable) return;
    void window.electronAPI
      .browserImportAvailable()
      .then(res => setImportAvailable(Boolean(res?.available)))
      .catch(() => setImportAvailable(false));
  }, [isOpen]);

  const handleImportChrome = async () => {
    if (!isElectronApp() || !window.electronAPI?.importChromeCookies) return;
    setImportState('running');
    setImportSummary('');
    try {
      const res = await window.electronAPI.importChromeCookies();
      if (res?.success) {
        setImportState('done');
        setImportSummary(`${res.imported ?? 0} cookies from ${res.hosts ?? 0} sites`);
      } else {
        setImportState('failed');
        setImportSummary(
          res?.error === 'unsupported-platform' ? 'Only supported on macOS' : 'Import failed',
        );
      }
    } catch {
      setImportState('failed');
      setImportSummary('Import failed');
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

        {importAvailable ? (
          <div className='flex flex-col gap-1'>
            <button
              onClick={() => {
                void handleImportChrome();
              }}
              disabled={importState === 'running'}
              className='h-auto w-full justify-start text-left text-sm text-foreground hover:bg-secondary/60 px-2 py-1.5 rounded-md transition-colors font-medium disabled:opacity-60'
              data-track-category='browser_settings'
              data-track-name='import_chrome_cookies'
            >
              {importState === 'running' ? 'Importing from Chrome…' : 'Import sessions from Chrome'}
            </button>
            <p className='px-2 text-xs text-muted-foreground'>
              {importState === 'idle'
                ? 'Copies your Chrome sign-ins into this browser. macOS will ask for your keychain password.'
                : importSummary}
            </p>
          </div>
        ) : null}

        <button
          onClick={() => {
            void handleClearSiteData();
          }}
          data-ph-capture-attribute-track-id='clear_site_data'
          className='h-auto w-full justify-start text-left text-sm text-red-500 hover:bg-red-500/10 hover:text-red-500 px-2 py-1.5 rounded-md transition-colors font-medium border border-transparent hover:border-red-500/20'
          data-track-category='browser_settings'
          data-track-name='clear_site_data'
        >
          Clear Site Data
        </button>
      </div>
    </Popover>
  );
};
