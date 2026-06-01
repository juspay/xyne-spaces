import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: [
    '../dashboard/src/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    './index.html',
  ],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"Geist Mono"', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        'root-border': 'var(--root-border)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        action: { primary: 'var(--action-primary)', 'primary-foreground': 'var(--action-primary-foreground)' },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          'secondary-foreground': 'var(--sidebar-secondary-foreground)',
          'item-hover': 'var(--sidebar-item-hover)',
          'item-active': 'var(--sidebar-item-active)',
          divider: 'var(--sidebar-divider)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'slide-in-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-up': 'slide-in-up 0.2s ease-in forwards',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
