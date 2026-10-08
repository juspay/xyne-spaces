import type { ReactElement } from 'react';
import { ScreenPickerModal } from './ScreenPickerModal';
import { useScreenPickerFlag } from './useScreenPickerFlag';

/**
 * Electron routes every getDisplayMedia request (calls and recordings) to this picker,
 * so it is mounted once at the app root rather than inside a feature.
 */
export function ScreenPickerHost(): ReactElement {
  useScreenPickerFlag();
  return <ScreenPickerModal />;
}
