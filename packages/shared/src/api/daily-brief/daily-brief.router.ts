import { defineRouter } from '../../enc-contracts/api-route.js';
import { dailyBriefConfig, dailyBriefConfigSet, dailyBriefSettings, dailyBriefSettingsSet } from './daily-brief.contracts.js';

/** `/daily-brief`: daily brief config and settings. Key order is the mount order. */
export const dailyBriefRouter = defineRouter('/daily-brief', {
  config: dailyBriefConfig,
  configSet: dailyBriefConfigSet,
  settings: dailyBriefSettings,
  settingsSet: dailyBriefSettingsSet,
});
