import tailwindcssAnimate from 'tailwindcss-animate';
import { XYNE_FOUNDATION_TOKENS } from './src/themes/XYNE_FOUNDATION_TOKENS.tsx';
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './index.html',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"Geist Mono"', 'monospace'],
        serif: ['"Libre Baskerville"', 'Georgia', 'serif'],
      },
      maxWidth: {
        'ai-content': '50rem',
      },
      colors: {
        // Xyne Foundation Theme Colors
        'xyne-gray': XYNE_FOUNDATION_TOKENS.colors.gray,
        'xyne-primary': XYNE_FOUNDATION_TOKENS.colors.primary,
        'xyne-purple': XYNE_FOUNDATION_TOKENS.colors.purple,
        'xyne-orange': XYNE_FOUNDATION_TOKENS.colors.orange,
        'xyne-red': XYNE_FOUNDATION_TOKENS.colors.red,
        'xyne-green': XYNE_FOUNDATION_TOKENS.colors.green,
        'xyne-yellow': XYNE_FOUNDATION_TOKENS.colors.yellow,
        // Xyne semantic tokens — mirror claw's `tokens.css` so shared claw
        // components (the Ask AI debugger) render with identical surfaces/text/
        // borders. Values resolve from CSS vars in global.css (light on :root,
        // dark under [data-theme="midnight"]). Only the debugger uses these
        // today, so the addition is additive and collision-free.
        'xyne-surface': 'var(--color-xyne-surface)',
        'xyne-surface-subtle': 'var(--color-xyne-surface-subtle)',
        'xyne-surface-sunken': 'var(--color-xyne-surface-sunken)',
        'xyne-fg-primary': 'var(--color-xyne-fg-primary)',
        'xyne-fg-secondary': 'var(--color-xyne-fg-secondary)',
        'xyne-fg-tertiary': 'var(--color-xyne-fg-tertiary)',
        'xyne-fg-muted': 'var(--color-xyne-fg-muted)',
        'xyne-fg-inverse': 'var(--color-xyne-fg-inverse)',
        'xyne-border': 'var(--color-xyne-border)',
        'xyne-border-subtle': 'var(--color-xyne-border-subtle)',
        'xyne-border-strong': 'var(--color-xyne-border-strong)',
        'xyne-brand': 'var(--color-xyne-brand)',
        'xyne-brand-ghost': 'var(--color-xyne-brand-ghost)',
        // Existing shadcn colors

        border: 'hsl(var(--border))',
        'root-border': 'var(--root-border)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        action: {
          primary: 'var(--action-primary)',
          accent: 'hsl(var(--action-accent) / <alpha-value>)',
          'primary-foreground': 'var(--action-primary-foreground)',
        },
        'chat-composer': {
          border: 'var(--chat-composer-border)',
          'border-active': 'var(--chat-composer-border-active)',
        },
        activity: {
          'sidebar-primary': 'var(--activity-sidebar-primary)',
        },
        desk: {
          helper: 'var(--desk-helper-foreground)',
          muted: 'var(--desk-muted-foreground)',
          border: 'var(--desk-border)',
          accent: {
            DEFAULT: 'var(--desk-accent)',
            hover: 'var(--desk-accent-hover)',
            foreground: 'var(--desk-accent-foreground)',
            subtle: 'var(--desk-accent-subtle)',
            badge: 'var(--desk-accent-badge-bg)',
          },
          destructive: 'var(--desk-destructive)',
          'switch-off': 'var(--desk-switch-track-off)',
        },
        status: {
          new: 'var(--status-new)',
          pending: 'var(--status-pending)',
          scheduled: 'var(--status-scheduled)',
          success: 'var(--status-success)',
          failure: 'var(--status-failure)',
          paused: 'var(--status-paused)',
        },
        'claw-ai': {
          fg: 'var(--claw-ai-fg)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          'border-muted': 'var(--sidebar-border-muted)',
          'accent-ring': 'var(--sidebar-accent-ring)',
        },
        stage: {
          todo: {
            DEFAULT: 'hsl(var(--stage-todo-bg))',
            border: 'hsl(var(--stage-todo-border))',
          },
          completed: {
            DEFAULT: 'hsl(var(--stage-completed-bg))',
            border: 'hsl(var(--stage-completed-border))',
          },
          cancelled: {
            DEFAULT: 'hsl(var(--stage-cancelled-bg))',
            border: 'hsl(var(--stage-cancelled-border))',
          },
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        // Incoming-call modal: the radar ping behind a solo caller's avatar.
        'call-radar': {
          '0%': { transform: 'scale(1)', opacity: '0.45' },
          '100%': { transform: 'scale(1.92)', opacity: '0' },
        },
        'live-ping': {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '70%, 100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'call-card-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'call-overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeLeft: {
          '0%': { opacity: '0', transform: 'translateX(32px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        railTravel: {
          '0%': { left: '0%', opacity: '0' },
          '12%': { opacity: '1' },
          '88%': { opacity: '1' },
          '100%': { left: '100%', opacity: '0' },
        },
        railTravelVertical: {
          '0%': { top: '0%', opacity: '0' },
          '12%': { opacity: '1' },
          '88%': { opacity: '1' },
          '100%': { top: '100%', opacity: '0' },
        },
        'slide-in-up': {
          from: {
            opacity: '0',
            transform: 'translateY(8px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'slide-in-from-right': {
          from: {
            transform: 'translateX(100%)',
            opacity: '0.5',
          },
          to: {
            transform: 'translateX(0)',
            opacity: '1',
          },
        },
        'slide-in-from-left': {
          from: {
            transform: 'translateX(-100%)',
            opacity: '0.5',
          },
          to: {
            transform: 'translateX(0)',
            opacity: '1',
          },
        },
        shine: {
          '0%': {
            'background-position': '0% 0%',
          },
          '50%': {
            'background-position': '100% 100%',
          },
          to: {
            'background-position': '0% 0%',
          },
        },
        'ai-pop': {
          '0%': { transform: 'scale(1) rotate(0deg)' },
          '50%': { transform: 'scale(1.15) rotate(180deg)' },
          '100%': { transform: 'scale(1) rotate(360deg)' },
        },
        slideUpIn: {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUpOut: {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-100%)' },
        },
        // Subtle fade-up — used by ActivityBlock's tool subtext to crossfade
        // when the currently-running tool changes. Smaller travel distance
        // than slideUpIn (4px instead of 100%) so consecutive swaps stay calm.
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Opacity-only fade — for crossfading inline text/icons in place (e.g.
        // the activity header morphing "Thinking…" → "Thought process") without
        // the vertical travel of fadeInUp, which reads as a jump on one line.
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'call-radar': 'call-radar 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'live-ping': 'live-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'live-pulse': 'live-pulse 2s ease-in-out infinite',
        'call-card-in': 'call-card-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'call-overlay-in': 'call-overlay-in 150ms linear',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-up': 'slide-in-up 0.2s ease-in forwards',
        'slide-in-from-right': 'slide-in-from-right 0.3s ease-out forwards',
        'slide-in-from-left': 'slide-in-from-left 0.3s ease-out forwards',
        shine: 'shine var(--duration) infinite linear',
        'ai-pop': 'ai-pop 700ms ease-in-out',
        'slide-up-in': 'slideUpIn 280ms cubic-bezier(0.22, 0.9, 0.3, 1) both',
        'slide-up-out': 'slideUpOut 280ms cubic-bezier(0.22, 0.9, 0.3, 1) both',
        'fade-in-up': 'fadeInUp 220ms ease-out both',
        'fade-in': 'fadeIn 220ms ease-out both',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
