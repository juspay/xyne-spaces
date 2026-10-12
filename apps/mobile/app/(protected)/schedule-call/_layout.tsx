import type { ReactElement } from 'react';
import { Stack } from 'expo-router';
import { useCSSVariable } from 'uniwind';

/**
 * The form and its picker screens (repeat, people, guests, channel). The form is the first screen
 * of this stack, so closing it dismisses the whole modal; the pickers push and pop over it with
 * the normal screen transition.
 */
export default function ScheduleCallLayout(): ReactElement {
  const backgroundColor = useCSSVariable('--color-settings-bg') as string;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }} />;
}
