import { Tray as MorphletTray } from 'morphlet';

import { TrayContent } from './tray-content';

/**
 * The app's bottom tray: Morphlet, as published, with a themed `Content`.
 *
 * Composition, same as the library:
 *
 *   <Tray.Root defaultView='a'>
 *     <Tray.Content>
 *       <Tray.Body>
 *         <Tray.View name='a' />
 *         <Tray.View name='b' />      // setView('b') morphs a → b in place
 *       </Tray.Body>
 *       <Tray.Footer />               // pinned; holds still across views
 *     </Tray.Content>
 *   </Tray.Root>
 *
 * It is a native presentation, so it covers the bar and the floating buttons
 * on its own and needs no portal. Requires a development build.
 */
export const Tray = {
  Root: MorphletTray.Root,
  Trigger: MorphletTray.Trigger,
  Content: TrayContent,
  Header: MorphletTray.Header,
  Body: MorphletTray.Body,
  View: MorphletTray.View,
  Footer: MorphletTray.Footer,
  Close: MorphletTray.Close,
  Title: MorphletTray.Title,
  Description: MorphletTray.Description,
  Morph: MorphletTray.Morph,
} as const;

export { useTray } from 'morphlet';
export { useTrayBodySpace } from './use-tray-space';
export type { TrayContentProps } from './tray-content';
export type {
  TrayAnimation,
  TrayBodyProps,
  TrayCloseProps,
  TrayRootProps,
  TraySectionProps,
  TrayState,
  TrayTriggerProps,
  TrayViewProps,
} from 'morphlet';
