/**
 * Draws a Xyne icon by its kebab-case id, with a fixed fallback for "no icon".
 *
 * Apps store an icon NAME, not a component: the name is what the agent chose
 * and what the user can change, and it has to survive being written to
 * Postgres and read back on another device. `ICON_META` is the package's own
 * index from name to export, so this stays correct as icons are added — there
 * is no hand-kept map to drift.
 *
 * Unknown or null names render the diamond every app used before icons
 * existed, so an app whose icon was renamed out of the set degrades to the
 * old look rather than to nothing.
 */

import type { ComponentType, ReactElement } from 'react';
import * as Icons from '@xyne/icons';
import { DiamondComponent, ICON_META, type PikaIconProps } from '@xyne/icons';

type IconComponent = ComponentType<PikaIconProps>;

const COMPONENT_BY_NAME: ReadonlyMap<string, string> = new Map(
  ICON_META.map(m => [m.name, m.component]),
);

/** The component for a name, or null when the set has no such icon. */
export function resolveAppIcon(name: string | null | undefined): IconComponent | null {
  if (!name) return null;
  const component = COMPONENT_BY_NAME.get(name);
  if (!component) return null;
  return (Icons as unknown as Record<string, IconComponent | undefined>)[component] ?? null;
}

export const APP_ICON_FALLBACK: IconComponent = DiamondComponent;

// `PikaIconProps` carries its own optional `name` (the icon's baked-in id);
// ours is the LOOKUP key and may be null, so it has to replace, not intersect.
export type AppIconProps = { name: string | null | undefined } & Omit<PikaIconProps, 'name'>;

export const AppIcon = ({ name, ...props }: AppIconProps): ReactElement => {
  const Icon = resolveAppIcon(name) ?? APP_ICON_FALLBACK;
  return <Icon {...props} />;
};
