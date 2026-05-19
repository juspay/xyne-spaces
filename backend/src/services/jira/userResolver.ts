import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  extractEmailFromDisplayName,
  inferEmailCandidatesFromDisplayName,
} from './userEmailInference';

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
  issueKeys: string[];
}

type UserResolutionLookup = {
  byExactName: Map<string, string>;
  byProfileDisplayName: Map<string, string>;
  byNormalizedComparable: Map<string, string>;
  byEmail: Map<string, string>;
  byUserIdToEmail: Map<string, string>;
};

const normalizeNamePart = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizeComparableValue = (value?: string | null): string => normalizeNamePart(value || '');

type ManualUserEmailMapping = Record<string, string>;

const normalizeMappingKey = (value?: string | null): string => (value || '').trim().toLowerCase();

export class JiraUserResolver {
  private resolvedUserCache = new Map<string, string>();
  private userResolutionLookup: UserResolutionLookup | null = null;
  private manualEmailMap: ManualUserEmailMapping | null = null;
  private workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  private unresolvedUserKey(user: JiraUserLike): string {
    return user.accountId || user.displayName || user.emailAddress || 'unknown';
  }

  setManualEmailMap(map: ManualUserEmailMapping | null): void {
    if (!map) {
      this.manualEmailMap = null;
      this.resolvedUserCache.clear();
      return;
    }

    const normalized: ManualUserEmailMapping = {};
    for (const [rawKey, rawValue] of Object.entries(map)) {
      const key = normalizeMappingKey(rawKey);
      const value = (rawValue || '').trim();
      if (!key || !value) continue;
      normalized[key] = value;
    }

    this.manualEmailMap = normalized;
    this.resolvedUserCache.clear();
  }

  reset(): void {
    this.resolvedUserCache.clear();
    this.userResolutionLookup = null;
    // Keep manualEmailMap as-is across resets.
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

  private resolveManualMappedEmail(user: JiraUserLike): string | null {
    if (!this.manualEmailMap) return null;

    const candidates = [
      user.accountId ? `accountId:${normalizeMappingKey(user.accountId)}` : null,
      user.emailAddress ? `emailAddress:${normalizeMappingKey(user.emailAddress)}` : null,
      user.displayName ? `displayName:${normalizeMappingKey(user.displayName)}` : null,
      user.displayName ? normalizeMappingKey(user.displayName) : null,
    ].filter(Boolean) as string[];

    for (const key of candidates) {
      const mapped = this.manualEmailMap[normalizeMappingKey(key)];
      if (mapped) return mapped;
    }

    return null;
  }

  async warmUserResolutionLookup(): Promise<void> {
    if (this.userResolutionLookup) return;

    const users = await db.user.findMany({
      where: { workspaceId: this.workspaceId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    const userIds = users.map(user => user.id);
    const profiles =
      userIds.length === 0
        ? []
        : await db.userProfile.findMany({
            where: {
              userId: { in: userIds },
              displayName: { not: null },
            },
            select: {
              userId: true,
              displayName: true,
            },
          });

    const byExactName = new Map<string, string>();
    const byProfileDisplayName = new Map<string, string>();
    const byNormalizedComparable = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const byUserIdToEmail = new Map<string, string>();

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
      byUserIdToEmail.set(user.id, user.email);
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
      byUserIdToEmail,
    };
  }

  getResolvedEmailByUserId(userId: string): string | null {
    return this.userResolutionLookup?.byUserIdToEmail.get(userId) || null;
  }

  async resolveUserOrNull(
    user: JiraUserLike | undefined,
    unresolvedUsers: Map<string, UnresolvedJiraUser>,
    issueKey?: string,
  ): Promise<string | null> {
    if (!user) return null;

    const userCacheKey = this.buildUserCacheKey(user);
    if (userCacheKey && this.resolvedUserCache.has(userCacheKey)) {
      return this.resolvedUserCache.get(userCacheKey)!;
    }

    await this.warmUserResolutionLookup();

    const manuallyMappedEmail = this.resolveManualMappedEmail(user);
    if (manuallyMappedEmail) {
      const match = this.userResolutionLookup?.byEmail.get(manuallyMappedEmail.toLowerCase());
      if (match) {
        logger.info('[JiraMigration] Resolved Jira user by manual email mapping', {
          displayName: user.displayName || null,
          accountId: user.accountId || null,
          emailAddress: user.emailAddress || null,
          mappedEmail: manuallyMappedEmail,
          resolvedUserId: match,
        });
        if (userCacheKey) this.resolvedUserCache.set(userCacheKey, match);
        return match;
      }
    }

    if (user.displayName) {
      const normalizedDisplayName = normalizeComparableValue(user.displayName);
      const emailInDisplayName = extractEmailFromDisplayName(user.displayName);
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

      if (emailInDisplayName) {
        const match = this.userResolutionLookup?.byEmail.get(emailInDisplayName.toLowerCase());
        if (match) {
          logger.info('[JiraMigration] Resolved Jira user by email embedded in display name', {
            displayName: user.displayName,
            embeddedEmail: emailInDisplayName,
            resolvedUserId: match,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, match);
          return match;
        }
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
          logger.info('[JiraMigration] Resolved Jira user by Jira email address', {
            displayName: user.displayName,
            emailAddress: user.emailAddress,
            resolvedUserId: jiraEmailMatch,
          });
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, jiraEmailMatch);
          return jiraEmailMatch;
        }
      }

      const byName = await db.user.findFirst({
        where: {
          workspaceId: this.workspaceId,
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
        const profileUser = await db.user.findFirst({
          where: { id: byProfileDisplayName.userId, workspaceId: this.workspaceId },
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

      for (const email of inferredEmails) {
        const byInferredEmail = await db.user.findFirst({
          where: {
            workspaceId: this.workspaceId,
            email: {
              equals: email,
              mode: 'insensitive',
            },
          },
        });
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
        const existingByJiraEmail = await db.user.findFirst({
          where: {
            workspaceId: this.workspaceId,
            email: {
              equals: user.emailAddress,
              mode: 'insensitive',
            },
          },
        });
        if (existingByJiraEmail) {
          if (userCacheKey) this.resolvedUserCache.set(userCacheKey, existingByJiraEmail.id);
          return existingByJiraEmail.id;
        }
      }

      const unresolvedUserKey = this.unresolvedUserKey(user);
      const existingUnresolvedUser = unresolvedUsers.get(unresolvedUserKey);
      unresolvedUsers.set(unresolvedUserKey, {
        displayName: user.displayName || null,
        accountId: user.accountId || null,
        suggestedEmails: inferredEmails,
        issueKeys: [...new Set([...(existingUnresolvedUser?.issueKeys || []), ...(issueKey ? [issueKey] : [])])],
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
    issueKey?: string,
  ): Promise<string> {
    const resolvedUserId = await this.resolveUserOrNull(user, unresolvedUsers, issueKey);
    if (resolvedUserId) {
      return resolvedUserId;
    }

    logger.warn('[jira-migration][user-resolution] Falling back to configured migration user for unresolved Jira user', {
      displayName: user?.displayName || null,
      emailAddress: user?.emailAddress || null,
      accountId: user?.accountId || null,
      fallbackUserId,
    });
    return fallbackUserId;
  }
}
