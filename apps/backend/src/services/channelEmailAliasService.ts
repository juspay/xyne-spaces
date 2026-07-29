import { db } from '@/database/client';

export const CHANNEL_EMAIL_SOURCE_TYPES = ['google-channel-email', 'microsoft-channel-email'] as const;

export interface ChannelEmailMailboxStatus {
  configured: boolean;
  displayName: string | null;
  sourceType: string | null;
  isActive: boolean;
}

interface ParsedBaseAddress {
  localPart: string;
  domain: string;
}

const ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SUBADDRESS_PREFIX = 'ch_';

function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const match = trimmed.match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[\w.-]+/);
  return match?.[0] ?? trimmed;
}

export class ChannelEmailAliasService {
  async getWorkspaceChannelEmailSource(workspaceId: string) {
    return db.externalSource.findFirst({
      where: { workspaceId, sourceType: { in: [...CHANNEL_EMAIL_SOURCE_TYPES] } },
      select: { id: true, displayName: true, sourceType: true, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getChannelEmailInfo(workspaceId: string, channelId: string): Promise<{
    emailAlias: string | null;
    configured: boolean;
    isActive: boolean;
    sourceType: string | null;
    mailboxEmail: string | null;
  }> {
    const source = await this.getWorkspaceChannelEmailSource(workspaceId);
    const mailboxEmail = source?.displayName ? normalizeEmail(source.displayName) : null;
    const emailAlias =
      source?.isActive && mailboxEmail ? this.getChannelEmailAlias(channelId, mailboxEmail) : null;

    return {
      emailAlias,
      configured: !!source,
      isActive: source?.isActive ?? false,
      sourceType: source?.sourceType ?? null,
      mailboxEmail,
    };
  }

  async getWorkspaceChannelEmailMailboxStatus(
    workspaceId: string,
  ): Promise<ChannelEmailMailboxStatus> {
    const source = await this.getWorkspaceChannelEmailSource(workspaceId);

    return {
      configured: !!source,
      displayName: source?.displayName ?? null,
      sourceType: source?.sourceType ?? null,
      isActive: source?.isActive ?? false,
    };
  }

  isChannelEmailSourceType(sourceType: string): boolean {
    return CHANNEL_EMAIL_SOURCE_TYPES.includes(sourceType as (typeof CHANNEL_EMAIL_SOURCE_TYPES)[number]);
  }

  getChannelEmailAlias(channelId: string, baseAddress: string): string | null {
    const parsed = this.parseBaseAddress(baseAddress);
    if (!parsed || !channelId) {
      return null;
    }

    return `${parsed.localPart}+${SUBADDRESS_PREFIX}${channelId}@${parsed.domain}`;
  }

  extractChannelIdFromRecipients(recipients: string[], baseAddress: string): string | null {
    const parsed = this.parseBaseAddress(baseAddress);
    if (!parsed) {
      return null;
    }

    for (const recipient of recipients) {
      const normalized = normalizeEmail(recipient);
      const [localPart, domain] = normalized.split('@');
      if (!localPart || !domain || domain !== parsed.domain) {
        continue;
      }

      const expectedPrefix = `${parsed.localPart}+${SUBADDRESS_PREFIX}`;
      if (!localPart.startsWith(expectedPrefix)) {
        continue;
      }

      const channelId = localPart.slice(expectedPrefix.length).trim();
      if (channelId) {
        return channelId;
      }
    }

    return null;
  }

  private parseBaseAddress(baseAddress: string): ParsedBaseAddress | null {
    const normalized = normalizeEmail(baseAddress);
    if (!ADDRESS_PATTERN.test(normalized)) {
      return null;
    }

    const [localPart, domain] = normalized.split('@');
    if (!localPart || !domain) {
      return null;
    }

    return { localPart, domain };
  }
}
