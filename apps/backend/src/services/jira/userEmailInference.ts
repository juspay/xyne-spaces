import { config } from '@/config/env';

const normalizeNamePart = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeEmailLocalPart = (value?: string | null): string =>
  (value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '');

export const extractEmailFromDisplayName = (displayName?: string): string | null => {
  if (!displayName) return null;
  const match = displayName.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  return match ? match.trim().toLowerCase() : null;
};

export const inferEmailCandidatesFromDisplayName = (displayName?: string): string[] => {
  // Candidate emails are only meaningful on the org's own domain (ORG_EMAIL_DOMAIN).
  const domain = config.orgEmailDomain;
  if (!displayName || !domain) return [];

  const nameParts = displayName
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter(Boolean);

  const candidates = new Set<string>();
  const rawLocalPart = normalizeEmailLocalPart(displayName);
  if (rawLocalPart) {
    candidates.add(`${rawLocalPart}@${domain}`);
  }

  if (nameParts.length === 0) {
    return [...candidates];
  }

  const first = nameParts[0];
  const second = nameParts[1];
  const last = nameParts[nameParts.length - 1];
  const firstInitial = first?.[0];
  const lastInitial = last?.[0];

  candidates.add(`${nameParts.join('.')}@${domain}`);
  candidates.add(`${nameParts.join('')}@${domain}`);

  if (nameParts.length >= 2) {
    candidates.add(`${first}.${last}@${domain}`);
    candidates.add(`${first}${last}@${domain}`);
    candidates.add(`${first}.${lastInitial}@${domain}`);
    candidates.add(`${first}${lastInitial}@${domain}`);
    candidates.add(`${firstInitial}.${last}@${domain}`);
    candidates.add(`${last}.${first}@${domain}`);
    candidates.add(`${last}${first}@${domain}`);
    if (firstInitial) {
      candidates.add(`${last}.${firstInitial}@${domain}`);
      candidates.add(`${last}${firstInitial}@${domain}`);
    }

    if (second) {
      candidates.add(`${first}.${second}@${domain}`);
      candidates.add(`${first}${second}@${domain}`);
      candidates.add(`${second}.${last}@${domain}`);
      candidates.add(`${second}${last}@${domain}`);
    }
  }

  const MAX_PERMUTATION_CANDIDATES = 100;
  if (nameParts.length >= 2 && candidates.size < MAX_PERMUTATION_CANDIDATES) {
    for (let i = 0; i < nameParts.length; i++) {
      for (let j = 0; j < nameParts.length; j++) {
        if (i === j) continue;
        const a = nameParts[i];
        const b = nameParts[j];
        candidates.add(`${a}.${b}@${domain}`);
        candidates.add(`${a}${b}@${domain}`);
        if (candidates.size >= MAX_PERMUTATION_CANDIDATES) break;
      }
      if (candidates.size >= MAX_PERMUTATION_CANDIDATES) break;
    }
  }

  return [...candidates].filter(Boolean);
};

export const getEmailCandidatesFromJiraDisplayName = (displayName?: string): string[] => {
  const embedded = extractEmailFromDisplayName(displayName);
  const inferred = inferEmailCandidatesFromDisplayName(displayName);
  return [...new Set([...(embedded ? [embedded] : []), ...inferred])];
};

