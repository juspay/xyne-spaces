/**
 * The one place a tab-shell route is spelled out.
 *
 * The redesign adds a second route group alongside `(tabs)`, chosen by the
 * `ui.shell` flag. Every caller goes through this module so that switch is a
 * single edit here rather than ~40 string literals spread across the app — and
 * so the segment predicates below keep matching once a second group exists,
 * instead of silently returning `false` for half the users.
 *
 * This module stays pure. It is imported by logic that is unit-tested without a
 * native runtime (`search-tabs`, `navReadiness`, `notificationPath`), so it must
 * not reach into MMKV or React Native. Which shell is active is therefore
 * *injected* at startup by `installTabShellResolver` rather than read here.
 */
import type { Href } from 'expo-router';

/**
 * Every tab screen either shell hosts. `more` is classic-only and `search`
 * onward are Spaces-only; the union is fine because this module only builds a
 * path — asking for one the active shell does not host is a caller error.
 */
export const TAB_NAMES = [
  'channels',
  'dms',
  'calls',
  'activity',
  'more',
  'search',
  'threads',
  'morning-brief',
  'bookmarks',
  'drafts-sent',
  'xyne-desks',
] as const;

export type TabName = (typeof TAB_NAMES)[number];

export const CLASSIC_SHELL_SEGMENT = '(tabs)';
export const SPACES_SHELL_SEGMENT = '(spaces)';

/**
 * Both groups, unconditionally. A segment check has to match whichever shell is
 * mounted, so this never narrows to one.
 */
const TAB_SHELL_SEGMENTS: readonly string[] = [CLASSIC_SHELL_SEGMENT, SPACES_SHELL_SEGMENT];

/** Defaults to the classic shell, which is also what tests and tooling get. */
let resolveShellSegment: () => string = () => CLASSIC_SHELL_SEGMENT;

/**
 * Teach this module which shell is active. Called once at startup from
 * `src/navigation/installTabShellResolver.ts`, which owns the flag read.
 */
export function setTabShellResolver(resolver: () => string): void {
  resolveShellSegment = resolver;
}

/** Which group the resolver currently names. */
export function activeShellSegment(): string {
  return resolveShellSegment();
}

/** True when these segments sit in the shell that is currently active. */
export function isOnActiveShell(segments: readonly string[]): boolean {
  return segments.includes(activeShellSegment());
}

/** The tab shell root, with no tab selected. */
export function tabShellRoot(): string {
  return `/(protected)/${resolveShellSegment()}`;
}

/** Absolute path to a tab screen, as a plain string. */
export function tabPath(tab: TabName): string {
  return `${tabShellRoot()}/${tab}`;
}

/** Absolute path to a tab screen, typed for expo-router navigation. */
export function tabRoute(tab: TabName): Href {
  return tabPath(tab) as Href;
}

/** The tab the Spaces shell opens on, and falls back to. */
export const SPACES_INITIAL_TAB: TabName = 'dms';

/**
 * Somewhere to send a caller that wants the destinations the pills do not show.
 *
 * Classic hosts those behind a `more` tab. Spaces has no such route — its
 * overflow is a menu the bar opens in place, not a destination — so asking for
 * `more` there builds a path nothing matches. Callers that need an actual
 * destination get the tab the shell opens on instead.
 */
export function overflowTabPath(): string {
  return tabPath(activeShellSegment() === SPACES_SHELL_SEGMENT ? SPACES_INITIAL_TAB : 'more');
}

/** {@link overflowTabPath}, typed for expo-router navigation. */
export function overflowTabRoute(): Href {
  return overflowTabPath() as Href;
}

/** True when a single expo-router segment names a tab shell group. */
export function isTabShellSegment(segment: string): boolean {
  return TAB_SHELL_SEGMENTS.includes(segment);
}

/** True when the current expo-router segments sit inside the tab shell. */
export function isOnTabShell(segments: readonly string[]): boolean {
  return segments.some(isTabShellSegment);
}

/**
 * True when a pathname is the tab shell root itself, with no tab resolved yet.
 * Takes a pathname already stripped of leading and trailing slashes.
 */
export function isTabShellRootPath(normalizedPath: string): boolean {
  return TAB_SHELL_SEGMENTS.some(segment => {
    const root = `(protected)/${segment}`;
    return normalizedPath === root || normalizedPath.endsWith(`/${root}`);
  });
}
