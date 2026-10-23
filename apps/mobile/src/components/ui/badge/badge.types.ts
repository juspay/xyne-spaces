import type { ReactNode } from 'react';
import type { PressableProps } from 'react-native';

export type BadgeVariant = 'default' | 'active';

export interface BadgeProps extends Omit<PressableProps, 'children'> {
  label: string;
  count?: number | undefined;
  variant?: BadgeVariant | undefined;
  /**
   * Trailing glyph — a chevron on a dropdown badge, a check on a toggle.
   *
   * The caller paints it, because Badge cannot: its inactive label colour comes
   * from a Tailwind class, and resolving that class to a value would mean
   * importing `uniwind` here. Everything this component pulls in is pure on
   * purpose (see the note on `useBubbleAccent`), so it stays cheap inside
   * recycled list rows.
   */
  trailing?: ReactNode | undefined;
}
