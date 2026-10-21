import type { ReactNode } from 'react';
import type { PressableProps, StyleProp, TextStyle, ViewProps, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

type DropdownSide = 'top' | 'bottom' | 'left' | 'right';
type DropdownAlign = 'start' | 'center' | 'end';

interface DropdownRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DropdownSize {
  width: number;
  height: number;
}

interface DropdownState {
  internalOpen: boolean;
  mounted: boolean;
  anchorRect: DropdownRect | null;
}

interface DropdownProps {
  children: ReactNode;

  // Optional controlled mode. Leave undefined for normal internal state.
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Fires after the close animation finishes and the modal unmounts. */
  onClosed?: () => void;

  // Most menus close after choosing an item. Individual items can override this.
  closeOnSelect?: boolean;
}

interface DropdownContextValue {
  isOpen: boolean;
  mounted: boolean;
  anchorRect: DropdownRect | null;
  progress: SharedValue<number>;
  closeOnSelect: boolean;
  openDropdown: (anchorRect: DropdownRect) => void;
  closeDropdown: () => void;
}

interface DropdownTriggerProps extends PressableProps {
  children: ReactNode;
}

interface DropdownContentProps extends ViewProps {
  side?: DropdownSide;
  align?: DropdownAlign;
  sideOffset?: number;
  alignOffset?: number;
  edgePadding?: number;
  minWidth?: number;
  maxWidth?: number;
  matchTriggerWidth?: boolean;
  overlayColor?: string;
  scrollable?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

interface DropdownItemProps extends PressableProps {
  label?: string;
  left?: ReactNode;
  right?: ReactNode;
  danger?: boolean;
  closeOnSelect?: boolean;
  onSelect?: () => void;
  labelStyle?: StyleProp<TextStyle>;
}

type DropdownSeparatorProps = ViewProps;

export type {
  DropdownAlign,
  DropdownContentProps,
  DropdownContextValue,
  DropdownItemProps,
  DropdownProps,
  DropdownRect,
  DropdownSeparatorProps,
  DropdownSide,
  DropdownSize,
  DropdownState,
  DropdownTriggerProps,
};
