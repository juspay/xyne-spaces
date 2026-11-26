import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { getConfig, getSettings, saveConfig, saveSettings } from './daily-brief.controller';

/** `/daily-brief`: config and settings (login). The briefs themselves are untyped (routes/dailyBrief.ts). */
export const dailyBriefRouter = router(api.dailyBrief, {}, (serve) => ({
  config: serve('config', { controller: ({ user, headers }) => getConfig({ user, headers }) }),
  configSet: serve('configSet', { controller: ({ body, user, headers }) => saveConfig({ body, user, headers }) }),
  settings: serve('settings', { controller: ({ user, headers }) => getSettings({ user, headers }) }),
  settingsSet: serve('settingsSet', { controller: ({ body, user, headers }) => saveSettings({ body, user, headers }) }),
}));
