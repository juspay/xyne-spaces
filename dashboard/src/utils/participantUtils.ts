/**
 * Utility functions for parsing and matching participant inputs
 * Supports plain emails and Google Calendar format: "Name <email@domain.com>"
 */

import type { User } from '@xyne/shared';

export interface ParsedParticipant {
  /** Original input token */
  raw: string;
  /** Extracted email (from <email> or the whole string) */
  email: string;
  /** Extracted name (if format was "Name <email>") */
  name?: string | undefined;
}

export interface ParticipantMatchResult {
  /** Successfully matched users with their parsed participant info */
  matched: Array<{ userId: string; participant: ParsedParticipant }>;
  /** Parsed participants that couldn't be matched to any user */
  notFound: ParsedParticipant[];
}

/**
 * Extract email from Google Calendar format or return as-is for plain emails
 * Examples:
 *   "Jane Doe <jane.doe@example.com>" -> "jane.doe@example.com"
 *   "user@example.com" -> "user@example.com"
 *   "  Name <email@test.com>  " -> "email@test.com"
 */
export function extractEmail(input: string): string {
  const trimmed = input.trim();
  const angleMatch = /<([^>]+)>/.exec(trimmed);
  return angleMatch && angleMatch[1] ? angleMatch[1].trim().toLowerCase() : trimmed.toLowerCase();
}

/**
 * Extract name from Google Calendar format
 * Examples:
 *   "Jane Doe <jane.doe@example.com>" -> "Jane Doe"
 *   "user@example.com" -> undefined
 */
export function extractName(input: string): string | undefined {
  const trimmed = input.trim();
  const angleMatch = /<([^>]+)>/.exec(trimmed);
  if (angleMatch) {
    const namePart = trimmed.substring(0, trimmed.indexOf('<')).trim();
    return namePart || undefined;
  }
  return undefined;
}

/**
 * Parse a comma/semicolon separated string into individual participants
 * Handles both plain emails and Google Calendar "Name <email>" format
 */
export function parseParticipants(input: string): ParsedParticipant[] {
  const isCommaSeparated = input.includes(',') || input.includes(';');
  const isSingleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());

  if (!isCommaSeparated && !isSingleEmail) {
    // Check if it's a single "Name <email>" entry
    const angleMatch = /<([^>]+)>/.exec(input.trim());
    if (!angleMatch) {
      return [];
    }
  }

  const tokens = isCommaSeparated
    ? input
        .split(/[,;]/)
        .map(token => token.trim())
        .filter(Boolean)
    : [input.trim()];

  return tokens.map(token => ({
    raw: token,
    email: extractEmail(token),
    name: extractName(token),
  }));
}

/**
 * Match parsed participants against active users
 * Matches by email or by name (case-insensitive)
 */
export function matchParticipants(
  parsed: ParsedParticipant[],
  activeUsers: User[],
  currentUserId?: string,
): ParticipantMatchResult {
  const normalizedTokenToUserId = new Map<string, string>();

  for (const candidateUser of activeUsers) {
    if (candidateUser.id === currentUserId) continue;

    const email = candidateUser.email?.trim().toLowerCase();
    const name = candidateUser.name?.trim().toLowerCase();

    if (email) {
      normalizedTokenToUserId.set(email, candidateUser.id);
    }
    if (name) {
      normalizedTokenToUserId.set(name, candidateUser.id);
    }
  }

  const matched: Array<{ userId: string; participant: ParsedParticipant }> = [];
  const notFound: ParsedParticipant[] = [];

  for (const participant of parsed) {
    // Try matching by extracted email first
    const matchedByEmail = normalizedTokenToUserId.get(participant.email);
    if (matchedByEmail) {
      matched.push({ userId: matchedByEmail, participant });
      continue;
    }

    // Try matching by extracted name (if available)
    if (participant.name) {
      const matchedByName = normalizedTokenToUserId.get(participant.name.toLowerCase());
      if (matchedByName) {
        matched.push({ userId: matchedByName, participant });
        continue;
      }
    }

    // Try matching by the raw input (for backwards compatibility)
    const matchedByRaw = normalizedTokenToUserId.get(participant.raw.toLowerCase());
    if (matchedByRaw) {
      matched.push({ userId: matchedByRaw, participant });
      continue;
    }

    notFound.push(participant);
  }

  return { matched, notFound };
}

/**
 * Check if a string looks like it might contain comma-separated participants
 * Useful for deciding whether to trigger bulk entry handling
 */
export function looksLikeBulkEntry(input: string): boolean {
  const trimmed = input.trim();
  return (
    trimmed.includes(',') ||
    trimmed.includes(';') ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ||
    /<[^>]+@[^>]+>/.test(trimmed)
  );
}
