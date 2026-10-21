import type GorhomBottomSheet from '@gorhom/bottom-sheet';
import type { ReactNode } from 'react';
import type { PressableProps, TextProps } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { AnimationRoot, PopupOverlayAnimation } from '@/src/types/animation';
import { BaseBottomSheetContentProps } from '@/src/types/bottom-sheet';

import * as BottomSheetPrimitivesTypes from '@/src/components/primitives/bottom-sheet/bottom-sheet.types';

export interface CloseButtonIconProps {
  size?: number;
  color?: string;
}

type CloseButtonProps = {
  iconProps?: CloseButtonIconProps;
};

export interface BottomSheetAnimationContextValue {
  progress: SharedValue<number>;
  isDragging: SharedValue<boolean>;
}

export interface BottomSheetRootProps extends BottomSheetPrimitivesTypes.RootProps {
  children?: ReactNode;
  animation?: AnimationRoot;
}

export interface BottomSheetTriggerProps extends BottomSheetPrimitivesTypes.TriggerProps {
  children?: ReactNode;
}

export interface BottomSheetPortalProps extends BottomSheetPrimitivesTypes.PortalProps {
  disableFullWindowOverlay?: boolean;
  children: ReactNode;
}

export interface BottomSheetOverlayProps extends BottomSheetPrimitivesTypes.OverlayProps {
  className?: string;
  animation?: Omit<PopupOverlayAnimation, 'entering' | 'exiting'>;
  isAnimatedStyleActive?: boolean;
}

export interface BottomSheetContentProps
  extends Partial<React.ComponentProps<typeof GorhomBottomSheet>>, BaseBottomSheetContentProps {}

export type BottomSheetCloseProps = PressableProps & CloseButtonProps;

export interface BottomSheetTitleProps extends TextProps {
  className?: string;
}

export interface BottomSheetDescriptionProps extends TextProps {
  className?: string;
}

export interface UseBottomSheetAnimationReturn {
  progress: SharedValue<number>;
}
