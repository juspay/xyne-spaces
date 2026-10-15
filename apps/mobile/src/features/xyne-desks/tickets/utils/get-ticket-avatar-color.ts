import { TICKET_AVATAR_COLORS } from '../constants';

export function getTicketAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TICKET_AVATAR_COLORS[Math.abs(hash) % TICKET_AVATAR_COLORS.length]!;
}

export function getTicketAvatarInitial(name: string): string {
  const trimmed = name.trim();
  return (trimmed[0] ?? '?').toUpperCase();
}
