/**
 * CAC key: "screen_picker_config"
 *
 * Controls whether the custom in-app Electron screen picker is used.
 * When disabled, Electron falls back to the native macOS screen picker.
 *
 * Toggle from Superposition CAC:
 *   key:   screen_picker_config
 *   value: { "customPickerEnabled": true }  ← custom in-app picker
 *   value: { "customPickerEnabled": false } ← native macOS picker
 */

export const SCREEN_PICKER_CAC_KEY = 'screen_picker_config';

export interface ScreenPickerCacConfig {
  customPickerEnabled: boolean;
}

export const DEFAULT_SCREEN_PICKER_CAC_CONFIG: ScreenPickerCacConfig = {
  customPickerEnabled: false, // default: native macOS picker
};
