/**
 * Deterministic color theme for tag/label chips
 */

export interface TagTheme {
  dot: string;
  bg: string;
  text: string;
}

const TAG_THEMES: readonly TagTheme[] = [
  {
    dot: 'bg-blue-600 [[data-theme=midnight]_&]:bg-blue-400',
    bg: 'bg-blue-600/10 [[data-theme=midnight]_&]:bg-blue-400/20',
    text: 'text-blue-600 [[data-theme=midnight]_&]:text-blue-400',
  },
  {
    dot: 'bg-emerald-700 [[data-theme=midnight]_&]:bg-emerald-400',
    bg: 'bg-emerald-700/10 [[data-theme=midnight]_&]:bg-emerald-400/20',
    text: 'text-emerald-700 [[data-theme=midnight]_&]:text-emerald-400',
  },
  {
    dot: 'bg-indigo-600 [[data-theme=midnight]_&]:bg-indigo-400',
    bg: 'bg-indigo-600/10 [[data-theme=midnight]_&]:bg-indigo-400/20',
    text: 'text-indigo-600 [[data-theme=midnight]_&]:text-indigo-400',
  },
  {
    dot: 'bg-cyan-600 [[data-theme=midnight]_&]:bg-cyan-400',
    bg: 'bg-cyan-600/10 [[data-theme=midnight]_&]:bg-cyan-400/20',
    text: 'text-cyan-600 [[data-theme=midnight]_&]:text-cyan-400',
  },
  {
    dot: 'bg-violet-600 [[data-theme=midnight]_&]:bg-violet-400',
    bg: 'bg-violet-600/10 [[data-theme=midnight]_&]:bg-violet-400/20',
    text: 'text-violet-600 [[data-theme=midnight]_&]:text-violet-400',
  },
  {
    dot: 'bg-amber-700 [[data-theme=midnight]_&]:bg-amber-400',
    bg: 'bg-amber-700/10 [[data-theme=midnight]_&]:bg-amber-400/20',
    text: 'text-amber-700 [[data-theme=midnight]_&]:text-amber-400',
  },
  {
    dot: 'bg-orange-600 [[data-theme=midnight]_&]:bg-orange-400',
    bg: 'bg-orange-600/10 [[data-theme=midnight]_&]:bg-orange-400/20',
    text: 'text-orange-600 [[data-theme=midnight]_&]:text-orange-400',
  },
  {
    dot: 'bg-teal-600 [[data-theme=midnight]_&]:bg-teal-400',
    bg: 'bg-teal-600/10 [[data-theme=midnight]_&]:bg-teal-400/20',
    text: 'text-teal-600 [[data-theme=midnight]_&]:text-teal-400',
  },
  {
    dot: 'bg-lime-700 [[data-theme=midnight]_&]:bg-lime-400',
    bg: 'bg-lime-700/10 [[data-theme=midnight]_&]:bg-lime-400/20',
    text: 'text-lime-700 [[data-theme=midnight]_&]:text-lime-400',
  },
];

function hashTagName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/**
 * @example
 * getTagTheme('customer-call'); // { dot: 'bg-indigo-600', bg: '...', text: '...' }
 */
export function getTagTheme(name: string): TagTheme {
  return TAG_THEMES[hashTagName(name) % TAG_THEMES.length]!;
}

export function getTagDotColor(name: string): string {
  return getTagTheme(name).dot;
}
