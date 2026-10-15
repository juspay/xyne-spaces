import { LayoutPosition } from '@/src/hooks/useRelativePosition';
import { LayoutRectangle } from 'react-native';
import {
  ForceMountable,
  PositionedContentProps,
  PressableRef,
  SlottablePressableProps,
  SlottableViewProps,
  ViewRef,
} from '../types';

/**
 * Content Sizing Strategy
 * - 'content-fit': Auto-size to content width (default)
 * - 'trigger': Match trigger width exactly
 * - 'full': 100% width
 * - number: fixed width in pixels
 */
type ContentSizing = 'content-fit' | 'trigger' | 'full' | number;

/**
 * Internal context interface for managing popover state and positioning
 */
interface IRootContext {
  /**
   * Whether the popover is currently open
   */
  isOpen: boolean;
  /**
   * Callback to change the opne state of the popover
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the popover should be open by default (uncontrolled mode)
   */
  isDefaultOpen?: boolean;
  /**
   * Whether the popover is disabled
   */
  isDisabled?: boolean;
  /**
   * The position of trigger element relative to the viewport
   */
  triggerPosition: LayoutPosition | null;
  /**
   * Updates trigger element's position
   */
  setTriggerPosition: (triggerPosition: LayoutPosition | null) => void;
  /**
   * The layout measurements of the popover content
   */
  contentLayout: LayoutRectangle | null;
  /**
   * Updates layout content measurements
   */
  setContentLayout: (contentLayout: LayoutRectangle | null) => void;
  /**
   * Unique identifier for the popover instance
   */
  nativeID: string;
  /**
   * Presentation mode for the popover content
   * - 'popover': Default floating popover with positioning
   * - 'bottom-sheet': Bottom sheet-like presentation
   * @default 'popover'
   */
  presentation: 'popover' | 'bottom-sheet';
}

/**
 * Props for the Popover Root component
 */
type RootProps = SlottableViewProps & {
  /**
   * Presentation mode for the popover content
   * - 'popover': Default floating popover with positioning
   * - 'bottom-sheet': Bottom sheet modal presentation
   * @default 'popover'
   */
  presentation?: 'popover' | 'bottom-sheet';
  /**
   * The controlled open state of the popover
   */
  isOpen?: boolean;
  /**
   * The open state of the popover when initially rendered (uncontrolled)
   */
  isDefaultOpen?: boolean;
  /**
   * Whether the popover is disabled
   */
  isDisabled?: boolean;
  /**
   * Callback fired when the popover open state changes
   * @param open - Whether the popover is open or closed
   */
  onOpenChange?: (open: boolean) => void;
};

/**
 * Props for the Popover Portal component
 */
interface PortalProps extends ForceMountable {
  /**
   * The content to render within the portal
   */
  children: React.ReactNode;
  /**
   * Optional name of the host element for the portal
   */
  hostName?: string;
}

/**
 * Props for the Popover Overlay component
 */
type OverlayProps = ForceMountable &
  SlottablePressableProps & {
    /**
     * Whether to close the popover when the overlay is pressed
     * @default true
     */
    closeOnPress?: boolean;
  };

/**
 * Props for the Popover Trigger component
 */
type TriggerProps = Omit<SlottablePressableProps, 'disabled'> & {
  isDisabled?: boolean;
};

/**
 * Props for the Popover Content component
 */
type ContentProps = SlottableViewProps &
  PositionedContentProps & {
    /**
     * Content width sizing strategy
     * - 'content-fit': Auto-size to content width (default)
     * - 'trigger': Match trigger width exactly
     * - 'full': 100% width
     * - number: Fixed width in pixels
     * @default 'content-fit'
     */
    width?: ContentSizing;
  };

/**
 * Props for the Popover Close Component
 */
type CloseProps = SlottablePressableProps;

/**
 * Props for customizing the close icon
 */
export interface CloseButtonIconProps {
  /**
   * Size of the icon
   * @default 16
   */
  size?: number;
  /**
   * Color of the icon
   * @default Uses theme foreground color
   */
  color?: string;
}

type CloseButtonProps = {
  iconProps?: CloseButtonIconProps;
};

/**
 * Ref type for the Popover Close component
 */
type CloseRef = PressableRef;

/**
 * Ref type for the Popover Content component
 */
type ContentRef = ViewRef;

/**
 * Ref type for the Popover Overlay component
 */
type OverlayRef = PressableRef;

/**
 * Ref type for the Popover Root component
 */
type RootRef = ViewRef;

/**
 * Ref type for the Popover Trigger component
 */
type TriggerRef = PressableRef & {
  /**
   * Programmatically open the popover
   */
  open: () => void;
  /**
   * Programmatically close the popover
   */
  close: () => void;
};

export type {
  CloseProps,
  CloseRef,
  ContentProps,
  ContentRef,
  ContentSizing,
  IRootContext,
  OverlayProps,
  OverlayRef,
  PortalProps,
  RootProps,
  RootRef,
  TriggerProps,
  TriggerRef,
  CloseButtonProps,
};
