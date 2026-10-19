import { SCHEMA_VERSION } from '@/src/machines/settingsMachine.schema';
import { settingsActor } from '@/src/machines/settingsMachine';
import { writeStoredSettings } from '@/src/services/settingsStorage';

/** Persist full snapshot after MMKV bootstrap so JSON stays aligned without changing settingsMachine. */
export function persistCurrentSettingsSnapshot(): void {
  writeStoredSettings({ version: SCHEMA_VERSION, settings: settingsActor.getSnapshot().context });
}
