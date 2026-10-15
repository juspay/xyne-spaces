import type { ButtonSize, ButtonVariant } from './button.types';

export const BUTTON_CONTAINER_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-button-primary-bg border-button-primary-border',
  secondary: 'bg-button-secondary-bg border-button-secondary-border',
  warning: 'bg-button-warning-bg border-button-warning-border',
  danger: 'bg-button-danger-bg border-button-danger-border',
};

export const BUTTON_TEXT_CLASS: Record<ButtonVariant, string> = {
  primary: 'text-button-primary-text',
  secondary: 'text-button-secondary-text',
  warning: 'text-button-warning-text',
  danger: 'text-button-danger-text',
};

export const BUTTON_SIZE_CLASS: Record<ButtonSize, { container: string; text: string }> = {
  xs: {
    container: 'px-2 py-1',
    text: 'text-[12px] leading-[16px]',
  },
  sm: {
    container: 'px-2.5 py-1.5',
    text: 'text-[13px] leading-[18px]',
  },
  md: {
    container: 'px-2.5 py-[7px]',
    text: 'text-[14px] leading-[19px]',
  },
};

const FLOW_VARIANT_ALIASES: Record<string, ButtonVariant> = {
  primary: 'primary',
  secondary: 'secondary',
  warning: 'warning',
  danger: 'danger',
  destructive: 'danger',
};

export const normalizeButtonVariant = (variant: string | undefined): ButtonVariant =>
  FLOW_VARIANT_ALIASES[variant?.trim().toLowerCase() ?? ''] ?? 'secondary';
