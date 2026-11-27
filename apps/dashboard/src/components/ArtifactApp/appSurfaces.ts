import type { ReactArtifactManifest } from '../Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * Where an app may be opened, as its author declared it in `xyne.json`
 * (`surfaces`), stored on each version's manifest by claw-auth.
 *
 *  - A bar app opens in any of the bars it declares: toolbar, Inbox, channel tabs.
 *  - A widget app opens as a widget only.
 *  - An overlay app opens as an overlay only.
 *  - Every app also opens on its own page in the Agent Hub (the library), and
 *    inline in the chat that generated it.
 *
 * claw-auth refuses a widget or overlay app that declares anything else, so
 * those two are always alone. An app built before `surfaces` existed declares
 * nothing and is a bar app in every bar.
 */
export type ArtifactAppSurface = NonNullable<ReactArtifactManifest['surfaces']>[number];
export type BarSurface = Extract<ArtifactAppSurface, 'toolbar' | 'inbox' | 'channel'>;

export const BAR_SURFACES: readonly BarSurface[] = ['toolbar', 'inbox', 'channel'];
const KNOWN: readonly string[] = [...BAR_SURFACES, 'widget', 'overlay'];

/** The declared surfaces, or every bar when the app declares none. */
export const declaredSurfaces = (
  manifest: Pick<ReactArtifactManifest, 'surfaces'> | null | undefined,
): readonly ArtifactAppSurface[] => {
  const declared = (manifest?.surfaces ?? []).filter((s): s is ArtifactAppSurface =>
    KNOWN.includes(s),
  );
  return declared.length > 0 ? declared : BAR_SURFACES;
};

/** Whether the app may open on `surface`. The Agent Hub and chat take any app. */
export const canOpenOn = (
  manifest: Pick<ReactArtifactManifest, 'surfaces'> | null | undefined,
  surface: ArtifactAppSurface | 'library' | 'chat',
): boolean =>
  surface === 'library' || surface === 'chat' || declaredSurfaces(manifest).includes(surface);

/** The Agent Hub page for an app: every app opens there. */
export const libraryAppPath = (appId: string): string =>
  `/ai/library/app/${encodeURIComponent(appId)}`;

const SURFACE_NAMES: Record<ArtifactAppSurface, string> = {
  toolbar: 'the toolbar',
  inbox: 'the Inbox',
  channel: 'channel tabs',
  widget: 'widgets',
  overlay: 'overlays',
};

/** "the toolbar and channel tabs" — where an app does open, for messages. */
export const describeSurfaces = (
  manifest: Pick<ReactArtifactManifest, 'surfaces'> | null | undefined,
): string => {
  const names = declaredSurfaces(manifest).map(s => SURFACE_NAMES[s]);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
