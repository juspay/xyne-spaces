import { useMemo } from 'react';
import { TicketStatusV2 } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import type { ChannelTicketsPalette } from '../types';
import { getTicketStatusStyle } from '../utils';

/** The ten status-pill tokens, in a fixed order so hooks are called unconditionally. */
const STATUS_VARS: readonly string[] = Object.values(TicketStatusV2).flatMap(status => {
  const style = getTicketStatusStyle(status);
  return [style.colorVar, style.softBgVar];
});

/**
 * Resolves every colour the channel-tickets views use, once, at the container.
 * Views receive the result as props and stay free of theme hooks.
 */
export function useChannelTicketsPalette(): ChannelTicketsPalette {
  const foreground = useCSSVariable('--color-foreground') as string;
  const secondary = useCSSVariable('--color-secondary-foreground') as string;
  const urgent = useCSSVariable('--color-ticket-priority-critical') as string;
  const neutralSoft = useCSSVariable('--color-ticket-table-header-bg') as string;
  const sheetHeader = useCSSVariable('--color-bottomsheet-text-header') as string;
  const sheetLabel = useCSSVariable('--color-bottomsheet-container-foreground') as string;
  const sheetMuted = useCSSVariable('--color-bottomsheet-text-muted') as string;
  const sheetIcon = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;
  const { accentText } = useBubbleAccent();

  const status0 = useCSSVariable(STATUS_VARS[0] ?? '') as string;
  const status1 = useCSSVariable(STATUS_VARS[1] ?? '') as string;
  const status2 = useCSSVariable(STATUS_VARS[2] ?? '') as string;
  const status3 = useCSSVariable(STATUS_VARS[3] ?? '') as string;
  const status4 = useCSSVariable(STATUS_VARS[4] ?? '') as string;
  const status5 = useCSSVariable(STATUS_VARS[5] ?? '') as string;
  const status6 = useCSSVariable(STATUS_VARS[6] ?? '') as string;
  const status7 = useCSSVariable(STATUS_VARS[7] ?? '') as string;
  const status8 = useCSSVariable(STATUS_VARS[8] ?? '') as string;
  const status9 = useCSSVariable(STATUS_VARS[9] ?? '') as string;

  return useMemo(() => {
    const resolved = [
      status0,
      status1,
      status2,
      status3,
      status4,
      status5,
      status6,
      status7,
      status8,
      status9,
    ];
    const byVar = new Map<string, string>();
    STATUS_VARS.forEach((cssVar, index) => {
      const value = resolved[index];
      if (value) byVar.set(cssVar, value);
    });
    byVar.set('--color-secondary-foreground', secondary);
    byVar.set('--color-ticket-table-header-bg', neutralSoft);
    return {
      foreground,
      secondary,
      urgent,
      accent: accentText,
      tableHeaderText: secondary,
      sheetHeader,
      sheetLabel,
      sheetMuted,
      sheetIcon,
      divider,
      byVar,
    };
  }, [
    foreground,
    secondary,
    urgent,
    neutralSoft,
    accentText,
    sheetHeader,
    sheetLabel,
    sheetMuted,
    sheetIcon,
    divider,
    status0,
    status1,
    status2,
    status3,
    status4,
    status5,
    status6,
    status7,
    status8,
    status9,
  ]);
}
