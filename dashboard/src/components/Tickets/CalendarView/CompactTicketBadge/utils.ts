/**
 * Gets the color for a ticket status
 * Using CSS custom properties for theme-aware colors
 */
export function getTicketStatusColor(status: string): string {
  // Map statuses to semantic CSS variables for proper dark mode support
  const statusToCssVar: Record<string, string> = {
    TODO: 'var(--status-new)',
    STARTED: 'var(--status-scheduled)',
    PAUSED: 'var(--status-paused)',
    CANCELLED: 'var(--status-failure)',
    COMPLETED: 'var(--status-success)',
  };
  return statusToCssVar[status] || 'var(--status-new)';
}
