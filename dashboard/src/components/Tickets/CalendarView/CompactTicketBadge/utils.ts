/**
 * Gets the color for a ticket status
 */
export function getTicketStatusColor(status: string): string {
  const colors: Record<string, string> = {
    TODO: '#9CA3AF',
    STARTED: '#3B82F6',
    PAUSED: '#F59E0B',
    CANCELLED: '#EF4444',
    COMPLETED: '#10B981',
  };
  return colors[status] || '#9CA3AF';
}
