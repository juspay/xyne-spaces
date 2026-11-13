/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  // Preflight is Tailwind's global element reset (html/body/h1-h6/a/hr/…), and it
  // is written with bare element selectors — nothing scopes it to this package.
  // A component library shipping it asserts document-wide styling it does not
  // own: loaded into a host that already has preflight, whichever stylesheet
  // comes last silently wins. In xyne-spaces this reset `html { font-family }`
  // back to Tailwind's stock stack and dropped the app's Inter everywhere.
  //
  // The host owns the reset. We ship utilities and tokens only.
  corePlugins: { preflight: false },
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Host (app) tokens. The package's components use shadcn/Figma class names
      // (bg-background, border-border, text-muted-foreground, bg-surface-*,
      // bg-secondary, bg-brand …) alongside the --wui-* tokens. Those names are
      // not Tailwind defaults, so without this block they compile to nothing and
      // the panels render transparent/unstyled. Map them to the host's global
      // CSS vars (raw HSL triplets) with the <alpha-value> placeholder so both
      // solid (bg-secondary) and translucent (bg-secondary/60) forms resolve.
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        surface: {
          DEFAULT: "hsl(var(--surface-default) / <alpha-value>)",
          page: "hsl(var(--surface-page) / <alpha-value>)",
          hover: "hsl(var(--surface-hover) / <alpha-value>)",
          elevated: "hsl(var(--surface-elevated) / <alpha-value>)",
          muted: "hsl(var(--surface-muted) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "hsl(var(--surface-brand) / <alpha-value>)",
          subtle: "hsl(var(--surface-brand-subtle) / <alpha-value>)",
          hover: "hsl(var(--surface-brand-hover) / <alpha-value>)",
          pressed: "hsl(var(--surface-brand-pressed) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
}
