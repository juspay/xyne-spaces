import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { ConfluenceUser } from './confluenceClient';

const db = DatabaseClient.getInstance();

export interface UnresolvedConfluenceUser {
  displayName: string | null;
  publicName: string | null;
  accountId: string | null;
  email: string | null;
  suggestedEmails: string[];
  pageIds: string[];
}

type UserResolutionLookup = {
  byExactName: Map<string, string>;
  byProfileDisplayName: Map<string, string>;
  byNormalizedComparable: Map<string, string>;
  byEmail: Map<string, string>;
  byEmailLocalPart: Map<string, string>;
  emailLocalPartCandidates: Array<{ normalizedLocalPart: string; userId: string; email: string }>;
};

const stripNonAscii = (value: string): string =>
  Array.from(value).filter(character => character.charCodeAt(0) <= 0x7f).join('');

const normalizeNamePart = (value: string): string =>
  stripNonAscii(value.normalize('NFKD'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeComparableValue = (value?: string | null): string => normalizeNamePart(value || '');

const normalizeEmailLocalPart = (value?: string | null): string =>
  stripNonAscii((value || '').normalize('NFKD'))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '');

const inferEmailCandidatesFromName = (name?: string): string[] => {
  if (!name) return [];

  const cleaned = name.replace(/_juspay$/i, '').replace(/[_-]+/g, ' ');
  const nameParts = cleaned
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter(Boolean);

  const candidates = new Set<string>();
  const rawLocalPart = normalizeEmailLocalPart(cleaned);
  if (rawLocalPart) {
    candidates.add(`${rawLocalPart}@juspay.in`);
  }

  if (nameParts.length === 0) {
    return [...candidates];
  }

  const first = nameParts[0];
  const second = nameParts[1];
  const last = nameParts[nameParts.length - 1];
  const firstInitial = first?.[0];
  const lastInitial = last?.[0];

  candidates.add(`${nameParts.join('.')}@juspay.in`);
  candidates.add(`${nameParts.join('')}@juspay.in`);

  if (nameParts.length >= 2) {
    candidates.add(`${first}.${last}@juspay.in`);
    candidates.add(`${first}${last}@juspay.in`);
    candidates.add(`${first}.${lastInitial}@juspay.in`);
    candidates.add(`${first}${lastInitial}@juspay.in`);
    candidates.add(`${firstInitial}.${last}@juspay.in`);

    if (second) {
      candidates.add(`${first}.${second}@juspay.in`);
      candidates.add(`${first}${second}@juspay.in`);
      candidates.add(`${second}.${last}@juspay.in`);
      candidates.add(`${second}${last}@juspay.in`);
    }
  }

  return [...candidates].filter(Boolean);
};

export class ConfluenceUserResolver {
  private resolvedUserCache = new Map<string, string>();
  private userResolutionLookup: UserResolutionLookup | null = null;

  constructor(private readonly workspaceId: string) {}

  async warmUserResolutionLookup(): Promise<void> {
    if (this.userResolutionLookup) return;

    const [users, profiles] = await Promise.all([
      db.user.findMany({
        where: { workspaceId: this.workspaceId },
        select: { id: true, name: true, email: true },
      }),
      db.userProfile.findMany({
        where: { displayName: { not: null } },
        select: { userId: true, displayName: true },
      }),
    ]);

    const byExactName = new Map<string, string>();
    const byProfileDisplayName = new Map<string, string>();
    const byNormalizedComparable = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const byEmailLocalPart = new Map<string, string>();
    const emailLocalPartCandidates: Array<{ normalizedLocalPart: string; userId: string; email: string }> = [];

    for (const user of users) {
      if (user.name) {
        byExactName.set(user.name.toLowerCase(), user.id);
      }

      const normalizedName = normalizeComparableValue(user.name);
      if (normalizedName && !byNormalizedComparable.has(normalizedName)) {
        byNormalizedComparable.set(normalizedName, user.id);
      }

      const email = user.email.toLowerCase();
      byEmail.set(email, user.id);

      const normalizedLocalPart = normalizeComparableValue(email.split('@')[0] || '');
      if (normalizedLocalPart) {
        if (!byEmailLocalPart.has(normalizedLocalPart)) {
          byEmailLocalPart.set(normalizedLocalPart, user.id);
        }
        emailLocalPartCandidates.push({
          normalizedLocalPart,
          userId: user.id,
          email: user.email,
        });
      }
    }

    for (const profile of profiles) {
      if (!profile.displayName) continue;

      byProfileDisplayName.set(profile.displayName.toLowerCase(), profile.userId);
      const normalizedDisplayName = normalizeComparableValue(profile.displayName);
      if (normalizedDisplayName && !byNormalizedComparable.has(normalizedDisplayName)) {
        byNormalizedComparable.set(normalizedDisplayName, profile.userId);
      }
    }

    this.userResolutionLookup = {
      byExactName,
      byProfileDisplayName,
      byNormalizedComparable,
      byEmail,
      byEmailLocalPart,
      emailLocalPartCandidates,
    };
  }

  async resolveUserOrNull(
    user: ConfluenceUser | undefined,
    unresolvedUsers: Map<string, UnresolvedConfluenceUser>,
    pageId?: string,
  ): Promise<string | null> {
    if (!user) return null;

    const cacheKey = this.buildUserCacheKey(user);
    if (cacheKey && this.resolvedUserCache.has(cacheKey)) {
      return this.resolvedUserCache.get(cacheKey)!;
    }

    await this.warmUserResolutionLookup();

    const email = user.email || user.emailAddress;
    if (email) {
      const emailMatch = this.userResolutionLookup?.byEmail.get(email.toLowerCase());
      if (emailMatch) {
        if (cacheKey) this.resolvedUserCache.set(cacheKey, emailMatch);
        return emailMatch;
      }
    }

    const names = [user.displayName, user.publicName, user.username, user.userKey]
      .filter((value): value is string => Boolean(value?.trim()));
    const inferredEmails = [...new Set(names.flatMap(inferEmailCandidatesFromName))];

    for (const name of names) {
      const exactNameMatch = this.userResolutionLookup?.byExactName.get(name.toLowerCase());
      if (exactNameMatch) {
        if (cacheKey) this.resolvedUserCache.set(cacheKey, exactNameMatch);
        return exactNameMatch;
      }

      const profileDisplayNameMatch = this.userResolutionLookup?.byProfileDisplayName.get(name.toLowerCase());
      if (profileDisplayNameMatch) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by profile display name', {
          displayName: name,
          resolvedUserId: profileDisplayNameMatch,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, profileDisplayNameMatch);
        return profileDisplayNameMatch;
      }

      const normalizedLookupMatch = this.userResolutionLookup?.byNormalizedComparable.get(normalizeComparableValue(name));
      if (normalizedLookupMatch) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by normalized name match', {
          displayName: name,
          resolvedUserId: normalizedLookupMatch,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, normalizedLookupMatch);
        return normalizedLookupMatch;
      }
    }

    for (const candidateEmail of inferredEmails) {
      const inferredEmailMatch = this.userResolutionLookup?.byEmail.get(candidateEmail.toLowerCase());
      if (inferredEmailMatch) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by inferred email', {
          displayName: user.displayName || user.publicName || null,
          inferredEmail: candidateEmail,
          resolvedUserId: inferredEmailMatch,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, inferredEmailMatch);
        return inferredEmailMatch;
      }
    }

    for (const candidateEmail of inferredEmails) {
      const normalizedLocalPart = normalizeComparableValue(candidateEmail.split('@')[0] || '');
      if (!normalizedLocalPart) continue;

      const exactLocalPartMatch = this.userResolutionLookup?.byEmailLocalPart.get(normalizedLocalPart);
      if (exactLocalPartMatch) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by inferred email prefix', {
          displayName: user.displayName || user.publicName || null,
          resolvedUserId: exactLocalPartMatch,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, exactLocalPartMatch);
        return exactLocalPartMatch;
      }

      const prefixMatch = this.userResolutionLookup?.emailLocalPartCandidates.find(candidate =>
        candidate.normalizedLocalPart.startsWith(normalizedLocalPart) ||
        candidate.normalizedLocalPart.includes(normalizedLocalPart),
      );
      if (prefixMatch) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by inferred email prefix', {
          displayName: user.displayName || user.publicName || null,
          resolvedUserId: prefixMatch.userId,
          resolvedEmail: prefixMatch.email,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, prefixMatch.userId);
        return prefixMatch.userId;
      }
    }

    for (const name of names) {
      const byName = await db.user.findFirst({
        where: {
          workspaceId: this.workspaceId,
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });
      if (byName) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by database name lookup', {
          displayName: name,
          resolvedUserId: byName.id,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, byName.id);
        return byName.id;
      }

      const byProfileDisplayName = await db.userProfile.findFirst({
        where: {
          displayName: {
            equals: name,
            mode: 'insensitive',
          },
        },
        select: { userId: true },
      });

      if (byProfileDisplayName?.userId) {
        const profileUser = await db.user.findFirst({
          where: {
            id: byProfileDisplayName.userId,
            workspaceId: this.workspaceId,
          },
          select: { id: true, email: true },
        });

        if (profileUser?.id) {
          logger.info('[ConfluenceMigration] Resolved Confluence user by database profile display name lookup', {
            displayName: name,
            resolvedUserId: profileUser.id,
            resolvedEmail: profileUser.email,
          });
          if (cacheKey) this.resolvedUserCache.set(cacheKey, profileUser.id);
          return profileUser.id;
        }
      }
    }

    const possibleNameParts = [...new Set(names.flatMap(name =>
      name
        .split(/\s+/)
        .map(normalizeNamePart)
        .filter(Boolean),
    ))];
    if (possibleNameParts.length > 0) {
      const possibleNameMatches = await db.user.findMany({
        where: {
          workspaceId: this.workspaceId,
          OR: possibleNameParts.map(part => ({
            name: {
              contains: part,
              mode: 'insensitive' as const,
            },
          })),
        },
        take: 20,
        select: { id: true, name: true, email: true },
      });

      const normalizedNames = new Set(names.map(normalizeComparableValue).filter(Boolean));
      const inferredEmailLocalParts = new Set(
        inferredEmails.map(candidateEmail => normalizeComparableValue(candidateEmail.split('@')[0] || '')).filter(Boolean),
      );
      const normalizedNameMatch = possibleNameMatches.find(candidate => {
        const normalizedCandidateName = normalizeComparableValue(candidate.name);
        const normalizedCandidateEmailLocalPart = normalizeComparableValue(candidate.email.split('@')[0] || '');
        return (
          normalizedNames.has(normalizedCandidateName) ||
          inferredEmailLocalParts.has(normalizedCandidateEmailLocalPart)
        );
      });

      if (normalizedNameMatch) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by database normalized name lookup', {
          displayName: names[0] || null,
          resolvedUserId: normalizedNameMatch.id,
          resolvedEmail: normalizedNameMatch.email,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, normalizedNameMatch.id);
        return normalizedNameMatch.id;
      }
    }

    for (const candidateEmail of inferredEmails) {
      const byInferredEmail = await db.user.findUnique({
        where: {
          email_workspaceId: {
            email: candidateEmail,
            workspaceId: this.workspaceId,
          },
        },
        select: { id: true },
      });
      if (byInferredEmail) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by database inferred email lookup', {
          displayName: names[0] || null,
          inferredEmail: candidateEmail,
          resolvedUserId: byInferredEmail.id,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, byInferredEmail.id);
        return byInferredEmail.id;
      }
    }

    if (email) {
      const existingByConfluenceEmail = await db.user.findUnique({
        where: {
          email_workspaceId: {
            email,
            workspaceId: this.workspaceId,
          },
        },
        select: { id: true },
      });
      if (existingByConfluenceEmail) {
        if (cacheKey) this.resolvedUserCache.set(cacheKey, existingByConfluenceEmail.id);
        return existingByConfluenceEmail.id;
      }
    }

    if (inferredEmails.length > 0) {
      const byEmailPrefix = await db.user.findFirst({
        where: {
          workspaceId: this.workspaceId,
          OR: inferredEmails.flatMap(candidateEmail => {
            const localPart = candidateEmail.split('@')[0] || '';
            const normalizedLocalPart = normalizeComparableValue(localPart);
            return [
              {
                email: {
                  startsWith: localPart,
                  mode: 'insensitive' as const,
                },
              },
              {
                email: {
                  contains: normalizedLocalPart,
                  mode: 'insensitive' as const,
                },
              },
            ];
          }),
        },
        select: { id: true, email: true },
      });

      if (byEmailPrefix) {
        logger.info('[ConfluenceMigration] Resolved Confluence user by database inferred email prefix lookup', {
          displayName: names[0] || null,
          resolvedUserId: byEmailPrefix.id,
          resolvedEmail: byEmailPrefix.email,
        });
        if (cacheKey) this.resolvedUserCache.set(cacheKey, byEmailPrefix.id);
        return byEmailPrefix.id;
      }
    }

    const unresolvedUserKey = this.unresolvedUserKey(user);
    const existingUnresolvedUser = unresolvedUsers.get(unresolvedUserKey);
    unresolvedUsers.set(unresolvedUserKey, {
      displayName: user.displayName || null,
      publicName: user.publicName || null,
      accountId: user.accountId || null,
      email: email || null,
      suggestedEmails: inferredEmails,
      pageIds: [...new Set([...(existingUnresolvedUser?.pageIds || []), ...(pageId ? [pageId] : [])])],
    });

    logger.warn('[confluence-migration][user-resolution] Could not resolve Confluence user', {
      displayName: user.displayName || null,
      publicName: user.publicName || null,
      email: email || null,
      accountId: user.accountId || null,
    });
    return null;
  }

  async resolveUser(
    user: ConfluenceUser | undefined,
    fallbackUserId: string,
    unresolvedUsers: Map<string, UnresolvedConfluenceUser>,
    pageId?: string,
  ): Promise<string> {
    const resolvedUserId = await this.resolveUserOrNull(user, unresolvedUsers, pageId);
    if (resolvedUserId) return resolvedUserId;

    logger.warn('[confluence-migration][user-resolution] Falling back to migration actor for unresolved Confluence user', {
      displayName: user?.displayName || null,
      publicName: user?.publicName || null,
      accountId: user?.accountId || null,
      fallbackUserId,
    });
    return fallbackUserId;
  }

  private buildUserCacheKey(user: ConfluenceUser | undefined): string | null {
    if (!user) return null;

    const parts = [
      user.accountId?.trim(),
      user.email?.trim().toLowerCase(),
      user.emailAddress?.trim().toLowerCase(),
      user.displayName?.trim().toLowerCase(),
      user.publicName?.trim().toLowerCase(),
    ].filter(Boolean);

    return parts.length > 0 ? parts.join('|') : null;
  }

  private unresolvedUserKey(user: ConfluenceUser): string {
    return user.accountId || user.email || user.emailAddress || user.displayName || user.publicName || 'unknown';
  }
}
