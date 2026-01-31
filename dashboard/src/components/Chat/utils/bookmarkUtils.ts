// Type definitions for message metadata
export interface MessageMetadata {
  snoozeUntil?: string | null;
  [key: string]: unknown;
}

// Helper function to format date as "Today", "Yesterday", or "Month Day, Year"
export const formatDateHeader = (timestamp: number): string => {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset hours for comparison
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return 'Today';
  }
  if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// Helper function to get date key for grouping
export const getDateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
};

// Helper function to format time only (e.g., "2:30 PM")
export const formatTimeOnly = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

// Helper function to format "due in" time for snooze
export const formatDueIn = (snoozeUntil: string): string => {
  const now = Date.now();
  const targetTime = new Date(snoozeUntil).getTime();
  const diff = targetTime - now;

  if (diff < 0) {
    return 'Overdue';
  }

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `Due in ${days}d`;
  }
  if (hours > 0) {
    return `Due in ${hours}h`;
  }
  if (minutes > 0) {
    return `Due in ${minutes}m`;
  }
  return `Due in ${seconds}s`;
};

// Helper function to format full date with time (e.g., "Dec 5, 2024 at 10:30 AM")
export const formatDateWithTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} at ${timeStr}`;
};

// Helper function to calculate snooze time based on option
export const calculateSnoozeTime = (option: string): Date | null => {
  const now = new Date();
  let snoozeUntil: Date;

  switch (option) {
    case '5secs': {
      snoozeUntil = new Date(now.getTime() + 5 * 1000);
      break;
    }
    case '30mins': {
      snoozeUntil = new Date(now.getTime() + 30 * 60 * 1000);
      break;
    }
    case '1hour': {
      snoozeUntil = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    }
    case '3hours': {
      snoozeUntil = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      break;
    }
    case 'tomorrow': {
      snoozeUntil = new Date(now);
      snoozeUntil.setDate(snoozeUntil.getDate() + 1);
      snoozeUntil.setHours(9, 0, 0, 0);
      break;
    }
    case 'monday': {
      snoozeUntil = new Date(now);
      const daysUntilMonday = (8 - snoozeUntil.getDay()) % 7 || 7;
      snoozeUntil.setDate(snoozeUntil.getDate() + daysUntilMonday);
      snoozeUntil.setHours(9, 0, 0, 0);
      break;
    }
    default:
      return null;
  }

  return snoozeUntil;
};
