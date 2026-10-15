import { createContext } from '@/src/contexts/create-context';
import { PopoverAnimationContextValue } from './popover.types';

/**
 * Display names for the Popover components
 */
export const DISPLAY_NAME = {
  ROOT: 'Lotus.Popover.Root',
  TRIGGER: 'Lotus.Popover.Trigger',
  PORTAL: 'Lotus.Popover.Portal',
  OVERLAY: 'Lotus.Popover.Overlay',
  CONTENT: 'Lotus.Popover.Content',
  CLOSE: 'Lotus.Popover.Close',
  TITLE: 'Lotus.Popover.Title',
  DESCRIPTION: 'Lotus.Popover.Description',
  ARROW: 'Lotus.Popover.Arrow',
};

/**
 * Default offset from trigger element
 */
export const DEFAULT_OFFSET = 9;

/**
 * Default alignment offset
 */
export const DEFAULT_ALIGN_OFFSET = 0;

/**
 * Default screen edge insets
 */
export const DEFAULT_INSETS = {
  top: 12,
  bottom: 12,
  left: 12,
  right: 12,
};

/**
 * Context for popover animation state
 */
const [PopoverAnimationProvider, usePopoverAnimation] = createContext<PopoverAnimationContextValue>(
  {
    name: 'PopoverAnimationContext',
  },
);

export { PopoverAnimationProvider, usePopoverAnimation };
