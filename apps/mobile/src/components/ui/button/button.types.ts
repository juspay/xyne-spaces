import type { PressableProps, StyleProp, ViewStyle } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'warning' | 'danger';

export type ButtonSize = 'xs' | 'sm' | 'md';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  readOnly?: boolean;
  className?: string;
  textClassName?: string;
  style?: StyleProp<ViewStyle>;
};
