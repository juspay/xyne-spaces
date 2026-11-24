import { PLUS_TRAY_DISMISS_DISTANCE, PLUS_TRAY_DISMISS_VELOCITY } from '../constants';

/** A row in one of the room's tray cards: the "+" tray, the schedule tray. */
export type TrayRow<Id extends string> = Readonly<{
  id: Id;
  title: string;
  subtitle: string | null;
  disabled: boolean;
}>;

/**
 * A drag that ends far enough down, or is flung down, closes a tray card; one
 * flung back up keeps it open however far it went.
 */
export function trayDragCloses(distance: number, velocity: number): boolean {
  'worklet';
  if (velocity <= -PLUS_TRAY_DISMISS_VELOCITY) return false;
  return distance >= PLUS_TRAY_DISMISS_DISTANCE || velocity >= PLUS_TRAY_DISMISS_VELOCITY;
}
