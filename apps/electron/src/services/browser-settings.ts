import Store from 'electron-store';

export interface BrowserSettings {
  popups: boolean;
  openLinksExternally: boolean;
}

const defaultSettings: BrowserSettings = {
  popups: true,
  openLinksExternally: true,
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
    // Strictly allowlist known keys and validate value
    // types before persisting. Unknown keys and wrong-typed values are dropped so
    // a compromised renderer cannot pollute the persisted store or alter policy
    // via unexpected fields.
    const sanitized: Partial<BrowserSettings> = {};
    if (settings && typeof settings.popups === 'boolean') {
      sanitized.popups = settings.popups;
    }
    if (settings && typeof settings.openLinksExternally === 'boolean') {
      sanitized.openLinksExternally = settings.openLinksExternally;
    }
    const newSettings = { ...currentSettings, ...sanitized };
    this.store.set('browserSettings', newSettings);
    return newSettings;
  }
}

export const browserSettingsService = new BrowserSettingsService();
