export interface BrowserSettings {
  popups: boolean;
  openLinksExternally: boolean;
}

export const defaultBrowserSettings: BrowserSettings = {
  popups: true,
  openLinksExternally: true,
};
