import { DatabaseClient } from '@/database/client';
import { UserRepository } from '@/database/repositories/users';
import { AuthProvider, Prisma } from '@prisma/client';

export interface WhatsAppNameEmailMapping {
  whatsappName: string;
  email: string;
}

export interface ResolvedWhatsAppUsers {
  resolvedUsersByName: Map<string, { userId: string; email: string; displayName: string }>;
  unresolvedNames: string[];
}

const db = DatabaseClient.getInstance();
const userRepository = new UserRepository();

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

async function findOrCreateWorkspaceUser(
  workspaceId: string,
  email: string,
  displayName: string,
): Promise<{ userId: string; email: string; displayName: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  let user = await userRepository.findByEmailCaseInsensitive(normalizedEmail, workspaceId);

  if (!user) {
    let orgMember = await db.orgMember.findUnique({
      where: { email: normalizedEmail },
      select: { memberId: true },
    });

    if (!orgMember) {
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { orgId: true },
      });
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      try {
        orgMember = await db.orgMember.create({
          data: {
            orgId: workspace.orgId,
            email: normalizedEmail,
            role: 'MEMBER',
          },
          select: { memberId: true },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        orgMember = await db.orgMember.findUnique({
          where: { email: normalizedEmail },
          select: { memberId: true },
        });
        if (!orgMember) {
          throw error;
        }
      }
    }

    const existingUserByEmail = await db.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { authProvider: true },
    });
    const authProvider = existingUserByEmail?.authProvider || AuthProvider.GOOGLE;

    try {
      user = await userRepository.create({
        email: normalizedEmail,
        name: displayName,
        providerUserId: `whatsapp-migrated-${normalizedEmail}`,
        authProvider,
        status: 'ACTIVE',
        workspace: { connect: { id: workspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      user = await userRepository.findByEmailCaseInsensitive(normalizedEmail, workspaceId);
      if (!user) {
        throw error;
      }
    }
  }

  return {
    userId: user.id,
    email: user.email,
    displayName: user.name,
  };
}

export async function resolveWhatsAppUsers(params: {
  workspaceId: string;
  participantNames: string[];
  mappings: WhatsAppNameEmailMapping[];
  createMissingUsers: boolean;
}): Promise<ResolvedWhatsAppUsers> {
  const mappingByName = new Map<string, WhatsAppNameEmailMapping>();
  for (const mapping of params.mappings) {
    const normalizedName = normalizeName(mapping.whatsappName || '');
    const normalizedEmail = mapping.email.trim().toLowerCase();
    if (!normalizedName || !normalizedEmail) continue;
    mappingByName.set(normalizedName, {
      whatsappName: mapping.whatsappName.trim(),
      email: normalizedEmail,
    });
  }

  const resolvedUsersByName = new Map<string, { userId: string; email: string; displayName: string }>();
  const unresolvedNames: string[] = [];

  for (const participantName of params.participantNames) {
    const normalizedParticipantName = normalizeName(participantName);
    const mapping = mappingByName.get(normalizedParticipantName);
    if (!mapping) {
      unresolvedNames.push(participantName);
      continue;
    }

    if (!params.createMissingUsers) {
      const existingUser = await userRepository.findByEmailCaseInsensitive(mapping.email, params.workspaceId);
      if (!existingUser) {
        unresolvedNames.push(participantName);
        continue;
      }
      resolvedUsersByName.set(normalizedParticipantName, {
        userId: existingUser.id,
        email: existingUser.email,
        displayName: existingUser.name,
      });
      continue;
    }

    const resolvedUser = await findOrCreateWorkspaceUser(
      params.workspaceId,
      mapping.email,
      mapping.whatsappName.trim() || participantName,
    );
    resolvedUsersByName.set(normalizedParticipantName, resolvedUser);
  }

  return {
    resolvedUsersByName,
    unresolvedNames,
  };
}
