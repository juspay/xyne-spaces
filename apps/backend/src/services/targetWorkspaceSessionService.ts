import { UserStatus } from '@prisma/client';
import { db } from '@/database/client';
import { jwtService, type JwtPayload } from '@/services/jwtService';
import { UserSessionService } from '@/services/userSessionService';
import {
  SessionProviderValidationService,
  type SessionProviderValidator,
} from '@/services/sessionProviderValidationService';

export type TargetWorkspaceSessionResult =
  | { status: 'valid' }
  | { status: 'refreshed'; token: string }
  | {
      status: 'external';
      reason: 'invalid_token' | 'inactive_user' | 'refresh_failed';
      refreshAttempted?: boolean;
    };

function hasTargetWorkspaceClaims(
  payload: JwtPayload,
  targetWorkspaceId: string
): payload is JwtPayload & { sub: string; memberId: string; workspaceId: string } {
  return (
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    typeof payload.memberId === 'string' &&
    payload.memberId.length > 0 &&
    payload.workspaceId === targetWorkspaceId
  );
}

/**
 * Authenticates one explicitly selected workspace cookie. It deliberately has
 * no request/header dependency, so it cannot fall back to x-workspace-id or
 * xyne_last_workspace.
 */
export class TargetWorkspaceSessionService {
  private readonly providerSessionValidator: SessionProviderValidator;

  constructor(
    private readonly userSessionService: UserSessionService = new UserSessionService(),
    providerSessionValidator?: SessionProviderValidator
  ) {
    this.providerSessionValidator =
      providerSessionValidator ?? new SessionProviderValidationService(userSessionService);
  }

  async authenticate(params: {
    token: string;
    targetWorkspaceId: string;
    sessionId?: string;
  }): Promise<TargetWorkspaceSessionResult> {
    const { token, targetWorkspaceId, sessionId } = params;

    let validPayload: JwtPayload | null = null;
    try {
      validPayload = jwtService.verifyToken(token);
    } catch (error) {
      const isExpired = error instanceof Error && error.message === 'JWT token has expired';
      if (!isExpired) {
        return { status: 'external', reason: 'invalid_token' };
      }
    }

    if (validPayload) {
      if (!hasTargetWorkspaceClaims(validPayload, targetWorkspaceId)) {
        return { status: 'external', reason: 'invalid_token' };
      }

      const isActive = await this.isActiveWorkspaceUser(validPayload, targetWorkspaceId);
      return isActive ? { status: 'valid' } : { status: 'external', reason: 'inactive_user' };
    }

    let expiredPayload: JwtPayload;
    try {
      expiredPayload = jwtService.verifyTokenIgnoringExpiration(token);
    } catch {
      return { status: 'external', reason: 'invalid_token' };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !hasTargetWorkspaceClaims(expiredPayload, targetWorkspaceId) ||
      typeof expiredPayload.exp !== 'number' ||
      expiredPayload.exp > nowSeconds
    ) {
      return { status: 'external', reason: 'invalid_token' };
    }

    if (!sessionId) {
      return { status: 'external', reason: 'refresh_failed', refreshAttempted: false };
    }

    try {
      const refreshedToken = await this.refreshForTargetWorkspace({
        sessionId,
        targetWorkspaceId,
        expectedUserId: expiredPayload.sub,
        expectedMemberId: expiredPayload.memberId,
      });

      return refreshedToken
        ? { status: 'refreshed', token: refreshedToken }
        : { status: 'external', reason: 'refresh_failed', refreshAttempted: true };
    } catch {
      return { status: 'external', reason: 'refresh_failed', refreshAttempted: true };
    }
  }

  private async isActiveWorkspaceUser(
    payload: JwtPayload & { sub: string; memberId: string },
    targetWorkspaceId: string
  ): Promise<boolean> {
    const user = await db.user.findFirst({
      where: {
        id: payload.sub,
        workspaceId: targetWorkspaceId,
        orgMemberId: payload.memberId,
        status: UserStatus.ACTIVE,
        leftAt: null,
      },
      select: {
        orgMember: {
          select: { leftAt: true },
        },
      },
    });

    return !!user && user.orgMember?.leftAt === null;
  }

  private async refreshForTargetWorkspace(params: {
    sessionId: string;
    targetWorkspaceId: string;
    expectedUserId: string;
    expectedMemberId: string;
  }): Promise<string | null> {
    const { sessionId, targetWorkspaceId, expectedUserId, expectedMemberId } = params;
    const session = await this.userSessionService.getSessionById(sessionId);

    if (
      !session?.user ||
      session.status !== 'ACTIVE' ||
      session.refreshTokenExpiry <= new Date() ||
      session.user.id !== expectedUserId ||
      session.user.workspaceId !== targetWorkspaceId ||
      session.user.orgMemberId !== expectedMemberId ||
      (session.workspaceId !== null && session.workspaceId !== targetWorkspaceId) ||
      session.user.status !== UserStatus.ACTIVE ||
      session.user.leftAt !== null ||
      !session.user.orgMember ||
      session.user.orgMember.leftAt !== null
    ) {
      return null;
    }

    if (!(await this.providerSessionValidator.isValid(session))) {
      return null;
    }

    const token = jwtService.generateToken({
      sub: session.user.id,
      email: session.user.email,
      name: session.user.name,
      picture: session.user.picture ?? undefined,
      workspaceId: targetWorkspaceId,
      memberId: session.user.orgMemberId,
      providerUserId: session.user.providerUserId,
    });

    await this.userSessionService.updateSession(session.id, { lastActivity: new Date() });
    return token;
  }
}

export const targetWorkspaceSessionService = new TargetWorkspaceSessionService();
