import { DatabaseClient } from '@/database/client';
import { UserRepository } from '@/database/repositories/users';
import { logger } from '@/utils/logger';

const db = DatabaseClient.getInstance();

export interface JiraUserLike {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
}

export interface UnresolvedJiraUser {
  displayName: string | null;
  accountId: string | null;
  suggestedEmails: string[];
}

type UserResolutionLookup = {
  byExactName: Map<string, string>;
  byProfileDisplayName: Map<string, string>;
  byNormalizedComparable: Map<string, string>;
  byEmail: Map<string, string>;
  byEmailLocalPart: Map<string, string>;
  emailLocalPartCandidates: Array<{ normalizedLocalPart: string; userId: string; email: string }>;
};

const normalizeNamePart = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeComparableValue = (value?: string | null): string => normalizeNamePart(value || '');

const normalizeEmailLocalPart = (value?: string | null): string =>
  (value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '');

const inferEmailCandidatesFromDisplayName = (displayName?: string): string[] => {
  if (!displayName) return [];

  const nameParts = displayName
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter(Boolean);

  const candidates = new Set<string>();
  const rawLocalPart = normalizeEmailLocalPart(displayName);
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

export class JiraUserResolver {
  private userRepository = new UserRepository();
  private resolvedUserCache = new Map<string, string>();
  private userResolutionLookup: UserResolutionLookup | null = null;

  private unresolvedUserKey(user: JiraUserLike): string {
    return user.accountId || user.displayName || user.emailAddress || 'unknown';
  }

  reset(): void {
    this.resolvedUserCache.clear();
    this.userResolutionLookup = null;
  }

  private buildUserCacheKey(user: JiraUserLike | undefined): string | null {
    if (!user) return null;

    const parts = [
      user.accountId?.trim(),
      user.displayName?.trim().toLowerCase(),
      user.emailAddress?.trim().toLowerCase(),
    ].filter(Boolean);

    return parts.length > 0 ? parts.join('|') : null;
  }

  async warmUserResolutionLookup(): Promise<void> {
    if (this.userResolutionLookup) return;

    const [users, profiles] = await Promise.all([
      db.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
        },
      }),
      db.userProfile.findMany({
        where: {
          displayName: {
            not: null,
          },
        },
        select: {
          userId: true,
          displayName: true,
        },
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
    user: JiraUserLike | undefined,
    unresolvedUsers: Map<string, UnresolvedJiraUser>,
  ): Promise<string | null> {
    if (!user) return null;

    const userCacheKey = this.buildUserCacheKey(user);
    if (userCacheKey && this.resolvedUserCache.has(userCacheKey)) {
      return this.resolvedUserCache.get(userCacheKey)!;
    }

    await this.warmUserResolutionLookup();

    if (user.displayName) {
      const normalizedDisplayName = normalizeComparableValue(user.displayName);
      const inferredEmails = inferEmailCandidatesFromDisplayName(user.displayName);

      const exactNameMatch = this.userResolutionLookup?.byExactName.get(user.displayName.toLowerCase());
      if (exactNameMatch) {
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, exactNameMatch);
        return exactNameMatch;
      }

      const profileDisplayNameMatch = this.userResolutionLookup?.byProfileDisplayName.get(user.displayName.toLowerCase());
      if (profileDisplayNameMatch) {
        logger.info('[JiraMigration] Resolved Jira user by user profile display name', {
          displayName: user.displayName,
          resolvedUserId: profileDisplayNameMatch,
        });
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, profileDisplayNameMatch);
        return profileDisplayNameMatch;
      }

      const normalizedLookupMatch = this.userResolutionLookup?.byNormalizedComparable.get(normalizedDisplayName);
      if (normalizedLookupMatch) {
        logger.info('[JiraMigration] Resolved Jira user by normalized name match', {
          displayName: user.displayName,
          resolvedUserId: normalizedLookupMatch,
        });
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, normalizedLookupMatch);
        return normalizedLookupMatch;
      }

      for (const email of inferredEmails) {
        const inferredEmailMatch = this.userResolutionLookup?.byEmail.get(email.toLowerCase());
        if (inferredEmailMatch) {
          logger.info('[JiraMigration] Resolved Jira user by inferred email', {
            displayName: user.displayName,
            inferredEmail: email,
            resolvedUserId: inferredEmailMatch,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, inferredEmailMatch);
          return inferredEmailMatch;
        }
      }

      if (user.emailAddress) {
        const jiraEmailMatch = this.userResolutionLookup?.byEmail.get(user.emailAddress.toLowerCase());
        if (jiraEmailMatch) {
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, jiraEmailMatch);
          return jiraEmailMatch;
        }
      }

      for (const email of inferredEmails) {
        const localPart = email.split('@')[0] || '';
        const normalizedLocalPart = normalizeComparableValue(localPart);
        if (!normalizedLocalPart) continue;

        const exactLocalPartMatch = this.userResolutionLookup?.byEmailLocalPart.get(normalizedLocalPart);
        if (exactLocalPartMatch) {
          logger.info('[JiraMigration] Resolved Jira user by inferred email prefix', {
            displayName: user.displayName,
            resolvedUserId: exactLocalPartMatch,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, exactLocalPartMatch);
          return exactLocalPartMatch;
        }

        const prefixMatch = this.userResolutionLookup?.emailLocalPartCandidates.find(candidate =>
          candidate.normalizedLocalPart.startsWith(normalizedLocalPart) ||
          candidate.normalizedLocalPart.includes(normalizedLocalPart),
        );
        if (prefixMatch) {
          logger.info('[JiraMigration] Resolved Jira user by inferred email prefix', {
            displayName: user.displayName,
            resolvedUserId: prefixMatch.userId,
            resolvedEmail: prefixMatch.email,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, prefixMatch.userId);
          return prefixMatch.userId;
        }
      }

      const byName = await db.user.findFirst({
        where: {
          name: {
            equals: user.displayName,
            mode: 'insensitive',
          },
        },
      });
      if (byName) {
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, byName.id);
        return byName.id;
      }

      const byProfileDisplayName = await db.userProfile.findFirst({
        where: {
          displayName: {
            equals: user.displayName,
            mode: 'insensitive',
          },
        },
      });

      if (byProfileDisplayName?.userId) {
        const profileUser = await db.user.findUnique({
          where: { id: byProfileDisplayName.userId },
        });

        if (profileUser?.id) {
          logger.info('[JiraMigration] Resolved Jira user by user profile display name', {
            displayName: user.displayName,
            resolvedUserId: profileUser.id,
            resolvedEmail: profileUser.email,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, profileUser.id);
          return profileUser.id;
        }
      }

      const possibleNameMatches = await db.user.findMany({
        where: {
          OR: user.displayName
            .split(/\s+/)
            .map(normalizeNamePart)
            .filter(Boolean)
            .map(part => ({
              name: {
                contains: part,
                mode: 'insensitive' as const,
              },
            })),
        },
        take: 20,
      });

      const normalizedNameMatch = possibleNameMatches.find(candidate => {
        const normalizedCandidateName = normalizeComparableValue(candidate.name);
        const normalizedCandidateEmailLocalPart = normalizeComparableValue(candidate.email.split('@')[0] || '');
        return (
          normalizedCandidateName === normalizedDisplayName ||
          inferredEmails.some(email => normalizeComparableValue(email.split('@')[0] || '') === normalizedCandidateEmailLocalPart)
        );
      });

      if (normalizedNameMatch) {
        logger.info('[JiraMigration] Resolved Jira user by normalized name match', {
          displayName: user.displayName,
          resolvedUserId: normalizedNameMatch.id,
          resolvedEmail: normalizedNameMatch.email,
        });
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, normalizedNameMatch.id);
        return normalizedNameMatch.id;
      }

      for (const email of inferredEmails) {
        const byInferredEmail = await this.userRepository.findByEmail(email);
        if (byInferredEmail) {
          logger.info('[JiraMigration] Resolved Jira user by inferred email', {
            displayName: user.displayName,
            inferredEmail: email,
            resolvedUserId: byInferredEmail.id,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, byInferredEmail.id);
          return byInferredEmail.id;
        }
      }

      if (user.emailAddress) {
        const existingByJiraEmail = await this.userRepository.findByEmail(user.emailAddress);
        if (existingByJiraEmail) {
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, existingByJiraEmail.id);
          return existingByJiraEmail.id;
        }
      }

      const byEmailPrefix = await db.user.findFirst({
        where: {
          OR: inferredEmails.flatMap(email => {
            const localPart = email.split('@')[0] || '';
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
      });

      if (byEmailPrefix) {
        logger.info('[JiraMigration] Resolved Jira user by inferred email prefix', {
          displayName: user.displayName,
          resolvedUserId: byEmailPrefix.id,
          resolvedEmail: byEmailPrefix.email,
        });
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, byEmailPrefix.id);
        return byEmailPrefix.id;
      }

      unresolvedUsers.set(this.unresolvedUserKey(user), {
        displayName: user.displayName || null,
        accountId: user.accountId || null,
        suggestedEmails: inferredEmails,
      });
    }

    logger.warn('[jira-migration][user-resolution] Could not resolve Jira user', {
      displayName: user.displayName || null,
      emailAddress: user.emailAddress || null,
      accountId: user.accountId || null,
    });
    return null;
  }

  async resolveUser(
    user: JiraUserLike | undefined,
    fallbackUserId: string,
    unresolvedUsers: Map<string, UnresolvedJiraUser>,
  ): Promise<string> {
    const resolvedUserId = await this.resolveUserOrNull(user, unresolvedUsers);
    if (resolvedUserId) {
      return resolvedUserId;
    }

    logger.warn('[jira-migration][user-resolution] Falling back to actor user for unresolved Jira user', {
      displayName: user?.displayName || null,
      emailAddress: user?.emailAddress || null,
      accountId: user?.accountId || null,
      fallbackUserId,
    });
    return fallbackUserId;
  }
}
