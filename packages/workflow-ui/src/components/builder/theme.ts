/**
 * v2/theme — Centralized category theming.
 *
 * All visual styling for categories is derived from backend-provided category names.
 * The UI never hardcodes which step TYPE belongs to which category.
 */

export interface CategoryTheme {
  /** Tailwind class for left accent border (e.g. "border-l-sky-400") */
  accent: string;
  /** Tailwind class for icon container background */
  iconBg: string;
  /** Tailwind class for icon container text color */
  iconText: string;
  /** Tailwind class for the category dot */
  dot: string;
  /** Tailwind class for light background (cards, picker hover) */
  lightBg: string;
  /** Tailwind class for selection ring */
  ring: string;
  /** CSS color value for edges/connectors */
  edgeColor: string;
}

const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  data: {
    accent: 'border-l-sky-400',
    iconBg: 'bg-sky-50',
    iconText: 'text-sky-600',
    dot: 'bg-sky-400',
    lightBg: 'bg-sky-50/50',
    ring: 'ring-sky-200 border-sky-300',
    edgeColor: '#38bdf8',
  },
  integration: {
    accent: 'border-l-violet-400',
    iconBg: 'bg-violet-50',
    iconText: 'text-violet-600',
    dot: 'bg-violet-400',
    lightBg: 'bg-violet-50/50',
    ring: 'ring-violet-200 border-violet-300',
    edgeColor: '#a78bfa',
  },
  control: {
    accent: 'border-l-amber-400',
    iconBg: 'bg-amber-50',
    iconText: 'text-amber-600',
    dot: 'bg-amber-400',
    lightBg: 'bg-amber-50/50',
    ring: 'ring-amber-200 border-amber-300',
    edgeColor: '#fbbf24',
  },
  flow: {
    accent: 'border-l-teal-400',
    iconBg: 'bg-teal-50',
    iconText: 'text-teal-600',
    dot: 'bg-teal-400',
    lightBg: 'bg-teal-50/50',
    ring: 'ring-teal-200 border-teal-300',
    edgeColor: '#2dd4bf',
  },
};

const FALLBACK_THEME: CategoryTheme = {
  accent: 'border-l-slate-400',
  iconBg: 'bg-slate-100',
  iconText: 'text-slate-500',
  dot: 'bg-slate-400',
  lightBg: 'bg-slate-50/50',
  ring: 'ring-slate-200 border-slate-300',
  edgeColor: '#94a3b8',
};

/**
 * Get the visual theme for a category name (from backend StepSummary.category).
 * Falls back gracefully for unknown categories.
 */
export function getCategoryTheme(category?: string): CategoryTheme {
  if (!category) return FALLBACK_THEME;
  return CATEGORY_THEMES[category.toLowerCase()] ?? FALLBACK_THEME;
}
