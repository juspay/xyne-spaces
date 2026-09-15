// Corporate email domain used to infer user emails from Jira display names.
// Deployment-specific: set CORPORATE_EMAIL_DOMAIN (e.g. "example.com").
// When unset, no email candidates are inferred.
const CORPORATE_EMAIL_DOMAIN = process.env.CORPORATE_EMAIL_DOMAIN ?? '';

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
  if (!displayName) return [];
  if (!CORPORATE_EMAIL_DOMAIN) return [];

  const nameParts = displayName
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter(Boolean);

  const candidates = new Set<string>();
  const rawLocalPart = normalizeEmailLocalPart(displayName);
  if (rawLocalPart) {
    candidates.add(`${rawLocalPart}@${CORPORATE_EMAIL_DOMAIN}`);
  }

  if (nameParts.length === 0) {
    return [...candidates];
  }

  const first = nameParts[0];
  const second = nameParts[1];
  const last = nameParts[nameParts.length - 1];
  const firstInitial = first?.[0];
  const lastInitial = last?.[0];

  candidates.add(`${nameParts.join('.')}@${CORPORATE_EMAIL_DOMAIN}`);
  candidates.add(`${nameParts.join('')}@${CORPORATE_EMAIL_DOMAIN}`);

  if (nameParts.length >= 2) {
    candidates.add(`${first}.${last}@${CORPORATE_EMAIL_DOMAIN}`);
    candidates.add(`${first}${last}@${CORPORATE_EMAIL_DOMAIN}`);
    candidates.add(`${first}.${lastInitial}@${CORPORATE_EMAIL_DOMAIN}`);
    candidates.add(`${first}${lastInitial}@${CORPORATE_EMAIL_DOMAIN}`);
    candidates.add(`${firstInitial}.${last}@${CORPORATE_EMAIL_DOMAIN}`);
    candidates.add(`${last}.${first}@${CORPORATE_EMAIL_DOMAIN}`);
    candidates.add(`${last}${first}@${CORPORATE_EMAIL_DOMAIN}`);
    if (firstInitial) {
      candidates.add(`${last}.${firstInitial}@${CORPORATE_EMAIL_DOMAIN}`);
      candidates.add(`${last}${firstInitial}@${CORPORATE_EMAIL_DOMAIN}`);
    }

    if (second) {
      candidates.add(`${first}.${second}@${CORPORATE_EMAIL_DOMAIN}`);
      candidates.add(`${first}${second}@${CORPORATE_EMAIL_DOMAIN}`);
      candidates.add(`${second}.${last}@${CORPORATE_EMAIL_DOMAIN}`);
      candidates.add(`${second}${last}@${CORPORATE_EMAIL_DOMAIN}`);
    }
  }

  const MAX_PERMUTATION_CANDIDATES = 100;
  if (nameParts.length >= 2 && candidates.size < MAX_PERMUTATION_CANDIDATES) {
    for (let i = 0; i < nameParts.length; i++) {
      for (let j = 0; j < nameParts.length; j++) {
        if (i === j) continue;
        const a = nameParts[i];
        const b = nameParts[j];
        candidates.add(`${a}.${b}@${CORPORATE_EMAIL_DOMAIN}`);
        candidates.add(`${a}${b}@${CORPORATE_EMAIL_DOMAIN}`);
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

