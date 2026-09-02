import type { ReactElement } from 'react';

export type PreferenceSection =
  | 'appearance'
  | 'notifications'
  | 'availability'
  | 'voice'
  | 'calls'
  | 'recordings'
  | 'messaging'
  | 'launch'
  | 'claw'
  | 'toolbar'
  | 'calendar'
  | 'password'
  | 'developer';

export interface PreferencesProps {
  open: boolean;
  onClose: () => void;
  initialSection?: PreferenceSection;
}

export interface NavItem {
  id: PreferenceSection;
  label: string;
  icon: ReactElement;
  desktopOnly?: boolean;
}

export { default } from './Preferences';
export { default as Preferences } from './Preferences';
export type { PreferencesState } from '../../../hooks/usePreferencesState';
