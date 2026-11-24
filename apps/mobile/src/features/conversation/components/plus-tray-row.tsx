import {
  Camera,
  CalendarClock,
  CaseSensitive,
  FileText,
  Images,
  Smile,
  type LucideIcon,
} from 'lucide-react-native';
import { type ReactElement } from 'react';

import type { PlusTrayRow, PlusTrayRowId } from '../model/plus-tray';
import { TrayRowButton, type TrayRowButtonProps } from './tray-row';

const ROW_ICONS: Readonly<Record<PlusTrayRowId, LucideIcon>> = {
  photos: Images,
  camera: Camera,
  files: FileText,
  emoji: Smile,
  formatting: CaseSensitive,
  schedule: CalendarClock,
};

type PlusTrayRowButtonProps = Omit<TrayRowButtonProps<PlusTrayRowId>, 'row' | 'icon'> & {
  row: PlusTrayRow;
};

/** A "+" tray row, with its own icon. */
export function PlusTrayRowButton(props: PlusTrayRowButtonProps): ReactElement {
  return <TrayRowButton {...props} icon={ROW_ICONS[props.row.id]} />;
}
