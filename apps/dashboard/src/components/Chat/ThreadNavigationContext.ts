import { createContext } from 'react';

/** Lets a host keep ticket and canvas links opened from a thread on its own surface. */
export const ThreadNavigationContext = createContext<{
  openTicket?: (ticketId: string) => void;
  openCanvas?: (canvasId: string) => void;
}>({});
