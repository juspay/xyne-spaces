// The same desk-wide number as the Avg Resolution KPI, just over time — so on desks saved
// before this chart existed it follows whatever that KPI is set to. Resolved At follows RT
// the same way, since Created At + RT gives it away.
export const inheritedVisibilityKey = (key: string): string | undefined => {
  if (key === 'chart:resolutionTrend') return 'kpi:avgResolution';
  if (key === 'column:resolvedAt') return 'column:rt';
  // Resolved By names an agent as Assignee does; Stage Movement is the Stage column's history.
  if (key === 'column:resolvedBy') return 'column:assignee';
  if (key === 'column:stageMoves') return 'column:stage';
  return undefined;
};

/** Whether guests see `key`: its own setting, else the one it inherits, else shown. */
export const isGuestVisible = (
  visibility: Record<string, boolean> | undefined,
  key: string,
): boolean => {
  if (visibility?.[key] !== undefined) return visibility[key] !== false;
  const inherited = inheritedVisibilityKey(key);
  return inherited ? visibility?.[inherited] !== false : true;
};
