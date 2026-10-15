import { Tray as TrayRoot } from './tray';
import { TrayContent } from './tray-content';
import { TrayTrigger } from './tray-trigger';
import { TrayView } from './tray-view';

/**
 * Compound tray.
 */
export const Tray = Object.assign(TrayRoot, {
  Trigger: TrayTrigger,
  Content: TrayContent,
  View: TrayView,
});

export { useTray } from './tray-context';
export { useTrayBodySpace } from './use-tray-space';
export type { TrayApi } from './tray-context';
export type { TrayProps } from './tray';
export type { TrayContentProps } from './tray-content';
export type { TrayTriggerProps } from './tray-trigger';
export type { TrayViewProps } from './tray-view';
