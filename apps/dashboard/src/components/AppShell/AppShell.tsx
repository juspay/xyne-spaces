import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '@juspay/blend-design-system';
import { Toaster } from 'sonner';
import {
  CheckTickCircle,
  AlertCircle,
  AlertTriangle,
  InformationCircle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { useTheme } from '../../hooks/useTheme';
import { XYNE_FOUNDATION_TOKENS } from '../../themes/XYNE_FOUNDATION_TOKENS';
import { XYNE_DARK_FOUNDATION_TOKENS } from '../../themes/XYNE_DARK_FOUNDATION_TOKENS';
import {
  XYNE_THEME_COMPONENT_TOKENS,
  XYNE_THEME_COMPONENT_TOKENS_DARK,
} from '../../themes/componentTokens';

/**
 * The theme and toaster every top-level page shares: the app (App.tsx) and the
 * desktop call window (callWindow/CallWindowApp.tsx).
 */

export function AppThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const { theme } = useTheme();
  const isDark = theme === 'midnight';
  return (
    <ThemeProvider
      foundationTokens={isDark ? XYNE_DARK_FOUNDATION_TOKENS : XYNE_FOUNDATION_TOKENS}
      componentTokens={isDark ? XYNE_THEME_COMPONENT_TOKENS_DARK : XYNE_THEME_COMPONENT_TOKENS}
      theme={isDark ? 'dark' : 'light'}
    >
      {children}
    </ThemeProvider>
  );
}

export function AppToaster({ className }: { className?: string }): ReactElement {
  return (
    <Toaster
      position='top-right'
      richColors
      closeButton
      {...(className !== undefined && { className })}
      icons={{
        success: <CheckTickCircle size={20} />,
        error: <AlertCircle size={20} />,
        warning: <AlertTriangle size={20} />,
        info: <InformationCircle size={20} />,
        close: <MultipleCrossCancelDefault size={16} />,
      }}
      toastOptions={{
        style: {
          alignItems: 'flex-start',
          background: 'hsl(var(--card))',
          color: 'hsl(var(--card-foreground))',
          border: '1px solid hsl(var(--border))',
          pointerEvents: 'auto',
        },
        classNames: {
          toast: 'relative items-start group !pt-3 !pr-3 !pb-3 !pl-4',
          icon: 'mt-1',
          title: '!text-card-foreground !font-semibold !max-w-[calc(100%-2rem)] !mr-8',
          description: '!text-card-foreground/80',

          actionButton: '!bg-primary !text-primary-foreground hover:!bg-primary/90 !mt-8',
          cancelButton: '!bg-secondary !text-secondary-foreground hover:!bg-secondary/80 !mt-8',

          closeButton:
            '!absolute !right-3 !top-5 !left-auto !bg-transparent !border-0 !ring-0 focus:!ring-0 focus:!outline-none !opacity-100 !text-card-foreground hover:!opacity-50 rounded-md z-10',

          success: '!text-status-success',
          error: '!text-status-failure',
          warning: '!text-status-pending',
          info: '!text-status-scheduled',
        },
      }}
    />
  );
}
