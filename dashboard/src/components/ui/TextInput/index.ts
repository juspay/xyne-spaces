export declare enum TextInputSize {
  SMALL = 'sm',
  MEDIUM = 'md',
  LARGE = 'lg',
}
export declare enum TextInputState {
  DEFAULT = 'default',
  HOVER = 'hover',
  FOCUS = 'focus',
  ERROR = 'error',
  DISABLED = 'disabled',
}
export type TextInputProps = {
  label?: string;
  sublabel?: string;
  hintText?: string;
  className?: string;
  error?: string | boolean;
  size?: TextInputSize;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  cursor?: 'text' | 'pointer' | 'default' | 'not-allowed';
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'style' | 'className' | 'onBlur' | 'onFocus'
>;
