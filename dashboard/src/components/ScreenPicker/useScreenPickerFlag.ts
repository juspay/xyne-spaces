import { useEffect } from 'react';
import { useCacConfig } from '../../hooks/useCacConfig';
import {
  SCREEN_PICKER_CAC_KEY,
  DEFAULT_SCREEN_PICKER_CAC_CONFIG,
  type ScreenPickerCacConfig,
} from './screenPickerCacConfig';

/**
 * Reads the `screen_picker_config` CAC flag and tells the Electron main process
 * whether to use the custom in-app screen picker or the native macOS one.
 * No-op in web / native contexts (window.electronAPI is absent).
 */
export function useScreenPickerFlag(): void {
  const { config } = useCacConfig<ScreenPickerCacConfig>({
    key: SCREEN_PICKER_CAC_KEY,
    fallbackConfig: DEFAULT_SCREEN_PICKER_CAC_CONFIG,
  });

  useEffect(() => {
    window.electronAPI?.screenPicker?.setEnabled?.(config.customPickerEnabled);
  }, [config.customPickerEnabled]);
}
