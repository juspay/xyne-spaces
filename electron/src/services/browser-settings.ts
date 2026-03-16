import Store from 'electron-store';

export interface BrowserSettings {
  javascript: boolean;
  popups: boolean;
}

const defaultSettings: BrowserSettings = {
  javascript: true,
  popups: true,
};

class BrowserSettingsService {
  private store: Store;

  constructor() {
    this.store = new Store();
  }

  getSettings(): BrowserSettings {
    const settings = this.store.get('browserSettings') as Partial<BrowserSettings> | undefined;
    return { ...defaultSettings, ...settings };
  }

  setSettings(settings: Partial<BrowserSettings>): BrowserSettings {
    const currentSettings = this.getSettings();
    const newSettings = { ...currentSettings, ...settings };
    this.store.set('browserSettings', newSettings);
    return newSettings;
  }
}

export const browserSettingsService = new BrowserSettingsService();
