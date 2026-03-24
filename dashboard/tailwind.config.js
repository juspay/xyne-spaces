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
  safelist: [
    { pattern: /bg-\[.*\]/ }, // allow arbitrary bg classes
    { pattern: /bg-\[color:.*\]/ }, // allow color-typed arbitrary values
    { pattern: /bg-\[color:hsl\(var\(.*\)\)\]/ }, // specific pattern for HSL with CSS variables
    { pattern: /hljs-.*/ }, // preserve all syntax highlighting classes
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
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          'secondary-foreground': 'var(--sidebar-secondary-foreground)',
          'item-hover': 'var(--sidebar-item-hover)',
          'item-active': 'var(--sidebar-item-active)',
          'badge-accent': 'var(--sidebar-badge-accent)',
          'badge-accent-foreground': 'var(--sidebar-badge-accent-foreground)',
          'divider': 'var(--sidebar-divider)',
        },
        appSidebar: {
          active: 'var(--app-sidebar-active)',
          activeForeground: 'var(--app-sidebar-active-foreground)',
          activeIcon: 'var(--nav-active-icon)',
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
          "0%": {
            "background-position": "0% 0%",
          },
          "50%": {
            "background-position": "100% 100%",
          },
          "to": {
            "background-position": "0% 0%",
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-up': 'slide-in-up 0.2s ease-in forwards',
        'slide-in-from-right': 'slide-in-from-right 0.3s ease-out forwards',
        'slide-in-from-left': 'slide-in-from-left 0.3s ease-out forwards',
        shine: "shine var(--duration) infinite linear",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
