/**
 * Connects the `ui.shell` flag to the pure route builder.
 *
 * Kept out of `routes.ts` so that module stays free of MMKV and React Native —
 * it is imported by logic the pure unit tests exercise. Import this once, from
 * the root layout, before any route resolves.
 */
import { isFlagOn } from '@/src/flags';

import { CLASSIC_SHELL_SEGMENT, SPACES_SHELL_SEGMENT, setTabShellResolver } from './routes';

/**
 * Whether `app/(protected)/(spaces)/` exists yet.
 *
 * It does. Kept as a named constant rather than deleted, because it is the one
 * switch that makes `ui.shell` inert if the group ever has to be pulled.
 */
const SPACES_SHELL_EXISTS = true;

export function installTabShellResolver(): void {
  setTabShellResolver((): string =>
    SPACES_SHELL_EXISTS && isFlagOn('ui.shell') ? SPACES_SHELL_SEGMENT : CLASSIC_SHELL_SEGMENT,
  );
}
