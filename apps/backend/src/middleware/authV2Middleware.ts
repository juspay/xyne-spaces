import { Request, Response, NextFunction } from 'express';
import { OAuth2Client, gaxios } from 'google-auth-library';
import axios from 'axios';
import { jwtService } from '../services/jwtService';
import { logger as baseLogger } from '../utils/logger';
import '../types/express';
import { UserSessionService } from '../services/userSessionService';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { AuthProvider } from '@xyne/shared';

const logger = baseLogger.child({ module: 'AuthV2Middleware' });
class AuthV2Middleware {
  private userSessionService: UserSessionService;
  private googleClient: OAuth2Client;

  constructor() {
    this.userSessionService = new UserSessionService();
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      logger.error('[AUTH] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Cannot start AuthV2Middleware.');
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret);
  }

  /**
   * Helper to extract token from workspace-specific cookie
   * Uses X-Workspace-Id header or xyne_last_workspace cookie
   */
  private extractToken(req: Request): string | null {
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.xyne_last_workspace;
    
    if (workspaceId) {
      return req.cookies?.[`xyne_ws_${workspaceId}_token`] || null;
    }
    
    return null;
  }
  
  /**
   * Helper to get global session ID (not workspace-scoped)
   */
  private getSessionId(req: Request): string | undefined {
    // Header-based session ID (API clients / old dashboards that can't set cookies)
    const headerSessionId = req.headers['x-session-id'] as string | undefined;
    if (headerSessionId) {
      return headerSessionId;
    }

    // Backward compat: user_session_id cookie (for old dashboard versions)
    return req.cookies?.user_session_id;
  }

  /**
   * Helper to attempt honest refresh using session cookie
   */
  private attemptRefresh = async (req: Request, res: Response, next: NextFunction): Promise<boolean> => {
    try {
      const sessionId = this.getSessionId(req);
      const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.xyne_last_workspace;
      logger.info(`[AUTH] [Auto-Refresh] Attempting refresh. Cookie found:`, {
        method: req.method,
        path: req.path,
        workspaceId,
        workspaceTokenPresent: workspaceId ? !!req.cookies?.[`xyne_ws_${workspaceId}_token`] : false,
      });

      if (!sessionId) {
        logger.info('[AUTH] [Auto-Refresh] No session ID cookie found - cannot refresh', {
          method: req.method,
          path: req.path,
        });
        return false;
      }

      const session = await this.userSessionService.getSessionById(sessionId);

      if (!session || !session.user) {
        logger.warn(`[AUTH] [Auto-Refresh] Session check failed: Session or user not found`, {
          sessionFound: !!session,
          userFound: !!session?.user,
        });
        return false;
      }

      // Check expiry and status
      const now = new Date();
      const isActive = session.status === 'ACTIVE';
      const isExpired = now >= session.refreshTokenExpiry;

      if (!isActive || isExpired) {
        logger.warn(`[AUTH] [Auto-Refresh] Session invalid: Status=${session.status}, Expired=${isExpired} (Expiry: ${session.refreshTokenExpiry})`, {
          userId: session.user.id,
          email: session.user.email,
          sessionStatus: session.status,
          refreshTokenExpiry: session.refreshTokenExpiry.toISOString(),
        });
        return false;
      }

      // Check if user has been removed from the organization entirely
      if (session.user.orgMember?.leftAt) {
        logger.warn(`[AUTH] [Auto-Refresh] User ${session.user.email} has left organization (leftAt=${session.user.orgMember.leftAt.toISOString()}). Session rejected.`, {
          userId: session.user.id,
          email: session.user.email,
          orgMemberLeftAt: session.user.orgMember.leftAt.toISOString(),
        });
        return false;
      }

      if (session.user.leftAt) {
        logger.warn(`[AUTH] [Auto-Refresh] Workspace user ${session.user.email} has left workspace ${session.user.workspaceId} (leftAt=${session.user.leftAt.toISOString()}). Session rejected.`, {
          userId: session.user.id,
          email: session.user.email,
          workspaceId: session.user.workspaceId,
          userLeftAt: session.user.leftAt.toISOString(),
        });
        return false;
      }

      // --- Provider Verification Step ---
      // Only verify with Google if the user authenticated via Google
      if (session.user.authProvider === AuthProvider.GOOGLE && session.refreshToken) {
        try {
          // Verify if the user is still valid in Google by checking their refresh token
          this.googleClient.setCredentials({ refresh_token: session.refreshToken });

          // Attempt to get a new access token.
          // If the user has been deleted or suspended in Google, this should throw.
          await this.googleClient.getAccessToken();
          
          logger.info(`[AUTH] [Auto-Refresh] Google verification successful for user ${session.user.email}`, {
                      userId: session.user.id,
                      email: session.user.email,
                    });
        } catch (err) {
          const googleError = err as gaxios.GaxiosError;
          // Check if it's a user-related error vs system error
          const isInvalidGrant = googleError.response?.data?.error === 'invalid_grant';

          if (isInvalidGrant) {
            logger.warn(`[AUTH] [Auto-Refresh] User token revoked for ${session.user.email}`, {
              userId: session.user.id,
              email: session.user.email,
            });
            return false;
          } else {
            // For system errors, allow the refresh but log the issue
            logger.warn(`[AUTH] [Auto-Refresh] Google verification FAILED (Transient): Allowing session. User: ${session.user.email}. Error: ${googleError}`, {
              userId: session.user.id,
              email: session.user.email,
              error: googleError.message,
            });
          }
          // Proceed with local session if it's just a network/transient error
        }
      } else if (session.user.authProvider === AuthProvider.MICROSOFT) {
        // Verify if the user is still valid in Azure AD via Microsoft Graph API
        if (session.accessToken) {
          try {
            const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
              headers: { Authorization: `Bearer ${session.accessToken}` },
              validateStatus: () => true, // Don't throw on non-2xx
            });

            if (graphResponse.status === 200) {
              logger.info(`[Auto-Refresh] Microsoft Graph verification successful for user ${session.user.email}`);
            } else if (graphResponse.status === 401) {
              // Access token expired — try refreshing via Microsoft token endpoint
              const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
              const tokenResponse = await axios.post(
                `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                new URLSearchParams({
                  client_id: process.env.MICROSOFT_CLIENT_ID!,
                  client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
                  grant_type: 'refresh_token',
                  refresh_token: session.refreshToken,
                  scope: 'openid email profile User.Read',
                }),
                {
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  validateStatus: () => true,
                }
              );

              if (tokenResponse.status === 200) {
                const tokenData = tokenResponse.data as { access_token: string };
                await this.userSessionService.updateSession(session.id, {
                  accessToken: tokenData.access_token,
                });
                logger.info(`[Auto-Refresh] Microsoft token refreshed for user ${session.user.email}`);
              } else {
                logger.warn(`[Auto-Refresh] Microsoft token refresh failed for ${session.user.email}. User may be disabled in Azure AD.`);
                return false;
              }
            } else {
              // 403 or other error — user likely disabled/deleted in Azure AD
              logger.warn(`[Auto-Refresh] Microsoft Graph returned ${graphResponse.status} for ${session.user.email}. User may be disabled in Azure AD.`);
              return false;
            }
          } catch (err) {
            // Network/transient error — allow session to continue
            logger.warn(`[Auto-Refresh] Microsoft Graph verification failed (transient) for ${session.user.email}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          logger.info(`[Auto-Refresh] No access token for Microsoft user ${session.user.email}. Skipping Graph check.`);
        }
      } else if (session.user.authProvider === AuthProvider.EMAIL) {
        // Email auth: we issued the refresh token ourselves
        // No external provider to verify against
        logger.info(`[Auto-Refresh] Email auth session for ${session.user.email} — skipping provider check`);
      } else if (!session.refreshToken) {
         logger.info(`[Auto-Refresh] No refresh token in session for user ${session.user.email}. Skipping provider check.`);
      }
      // --------------------------------

      logger.info(`[AUTH] [Auto-Refresh] Valid session found for user ${session.user.email}`, {
        userId: session.user.id,
        email: session.user.email,
        googleId: session.user.providerUserId,
      });

      // Generate new token - role is fetched fresh from DB, not stored in JWT
      const customToken = jwtService.generateToken({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: session.user.picture,
        workspaceId: session.user.workspaceId,
        memberId: session.user.orgMemberId,
      });

      const tokenPreview = `${customToken.slice(0, 8)}...${customToken.slice(-6)}`;

      // Update session activity
      await this.userSessionService.updateSession(session.id, {
        lastActivity: new Date(),
      });

      // Set new cookie with updated lifespan
      const isProduction = process.env.NODE_ENV === 'production';
      const targetWorkspaceId = session.user.workspaceId;

      // NEW: Multi-workspace cookies
      if (targetWorkspaceId) {
        res.cookie(`xyne_ws_${targetWorkspaceId}_token`, customToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: config.jwt.expirationSeconds * 1000,
        });
        
        res.cookie('xyne_last_workspace', targetWorkspaceId, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: '/',
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }

      // Attach user to request so downstream handlers work
      // Safe non-null assertion: orgMember exists via FK constraint
      req.user = {
        id: session.user.id,
        googleId: session.user.providerUserId,
        email: session.user.email,
        name: session.user.name,
        displayName: session.user.displayName,
        workspaceId: session.user.workspaceId,
        role: session.user.role,
        orgRole: session.user.orgMember.role,
        memberId: session.user.orgMemberId,
        authProvider: session.user.authProvider,
      };

      logger.info(`[AUTH] [Auto-Refresh] SUCCESS: Token refreshed and user attached to request`, {
        userId: session.user.id,
        googleId: session.user.providerUserId,
        email: session.user.email,
        tokenPreview,
        workspaceId: session.user.workspaceId,
      });
      next();
      return true;

    } catch (refreshError) {
      logger.error('[AUTH] [Auto-Refresh] CRITICAL ERROR during auto-refresh:', {
        error: refreshError instanceof Error ? refreshError.message : 'Unknown error',
        stack: refreshError instanceof Error ? refreshError.stack : undefined,
      });
      return false;
    }
  };

  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[Auth] [${req.method} ${req.path}]`;
    const sessionId = this.getSessionId(req);
    const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.xyne_last_workspace;
    
    try {
      // 1. Try to get a valid access token first
      const token = this.extractToken(req);
      const tokenSource = workspaceId && req.cookies?.[`xyne_ws_${workspaceId}_token`]
        ? 'workspace_cookie'
        : req.cookies?.google_access_token
          ? 'legacy_cookie'
          : req.headers.authorization?.startsWith('Bearer ')
            ? 'authorization_header'
            : 'none';
      const tokenPreview = token ? `${token.slice(0, 8)}...${token.slice(-6)}` : undefined;
      logger.info(`[AUTH] ${logPrefix} Step 1: Token extraction result: ${!!token}`, {
        method: req.method,
        path: req.path,
        workspaceId,
        tokenSource,
        tokenPresent: !!token,
        tokenPreview,
      });
      
      let tokenIsValid = false;

      if (token) {
        try {
          const decoded = jwtService.verifyToken(token);
          
          if (decoded && decoded.sub) {
              /**
               * BACKWARD COMPATIBILITY SUPPORT
               *
               * Old JWTs contain only { sub: userId }. New JWTs include
               * { workspaceId, memberId, role, orgRole }.
               *
               * For old tokens: look up workspace context from DB so the request
               * can proceed without requiring re-login.
               */
              const hasWorkspaceClaims = decoded.memberId && decoded.workspaceId;

              let effectiveWorkspaceId: string | undefined = decoded.workspaceId;
              let effectiveMemberId: string | undefined = decoded.memberId;

              if (!hasWorkspaceClaims) {
                logger.info(`[AUTH] ${logPrefix} LEGACY JWT FORMAT - User ${decoded.sub} using pre-workspace client`, {
                  userId: decoded.sub,
                  tokenSource,
                  tokenPreview,
                });

                const legacyUser = await db.user.findUnique({
                  where: { id: decoded.sub },
                  select: { workspaceId: true, orgMemberId: true },
                });

                effectiveWorkspaceId = legacyUser?.workspaceId ?? undefined;
                effectiveMemberId = legacyUser?.orgMemberId ?? undefined;
              }
              // END BACKWARD COMPAT

              if (!effectiveWorkspaceId || !effectiveMemberId) {
                logger.warn(`[AUTH] ${logPrefix} No workspace context resolved for user ${decoded.sub}`, {
                  tokenSource,
                  tokenPreview,
                  effectiveWorkspaceId,
                  effectiveMemberId,
                });
                res.status(401).json({
                  error: 'Workspace context missing',
                  message: 'Unable to determine workspace for this session. Please log in again.',
                });
                return;
              }

              // Fetch fresh roles from database using parallel queries
              const [user, orgMember] = await Promise.all([
                db.user.findUnique({
                  where: { id: decoded.sub },
                  select: {
                    id: true,
                    role: true,
                    email: true,
                    name: true,
                    displayName: true,
                    leftAt: true,
                    providerUserId: true,
                    authProvider: true,
                  }
                }),
                db.orgMember.findUnique({
                  where: { memberId: effectiveMemberId! },
                  select: { role: true, leftAt: true }
                })
              ]);
              
              if (user) {
                if (user.leftAt) {
                  logger.warn(`[AUTH] ${logPrefix} User has been removed from workspace: ${user.email}`, {
                    tokenSource,
                    tokenPreview,
                    userId: user.id,
                    leftAt: user.leftAt,
                  });
                  res.status(401).json({
                    error: 'User removed from workspace',
                    message: 'You have been removed from this workspace',
                  });
                  return;
                }

                if (orgMember?.leftAt) {
                  logger.warn(`[AUTH] ${logPrefix} User has been removed from organization: ${user.email}`, {
                    tokenSource,
                    tokenPreview,
                    userId: user.id,
                    orgMemberLeftAt: orgMember.leftAt,
                  });
                  res.status(401).json({
                    error: 'User removed from organization',
                    message: 'You have been removed from this organization',
                  });
                  return;
                }
                
                // Use fresh roles from database
                const workspaceRole = user.role;
                const orgRole = orgMember!.role;
                
                req.user = {
                  id: user.id,
                  googleId: user.providerUserId,
                  email: user.email,
                  name: user.name,
                  displayName: user.displayName,
                  workspaceId: effectiveWorkspaceId,
                  role: workspaceRole,
                  orgRole: orgRole,
                  memberId: effectiveMemberId!,
                  authProvider: user.authProvider,
                };
                logger.info(`[AUTH] ${logPrefix} Token verified successfully for user: ${user.email}`, {
                  tokenSource,
                  tokenPreview,
                  tokenSub: decoded.sub,
                  userId: user.id,
                  googleId: user.providerUserId,
                  email: user.email,
                  workspaceRole,
                  orgRole,
                });
                tokenIsValid = true;
                return next();
              } else {
                logger.warn(`[AUTH] ${logPrefix} Token valid, but user not found in DB: ${decoded.sub}`, {
                  tokenSource,
                  tokenPreview,
                  tokenSub: decoded.sub,
                });
              }
          }
        } catch (err) {
           // Token invalid/expired, log and fall through to refresh logic
           const isExpired = err instanceof Error && err.message === 'JWT token has expired';
           if (isExpired) {
              logger.info(`[AUTH] ${logPrefix} Token expired. Falling back to refresh.`, {
                tokenSource,
                tokenPreview,
              });
           } else {
              logger.warn(`[AUTH] ${logPrefix} Token invalid. Falling back to refresh. Error: ${err instanceof Error ? err.message : String(err)}`, {
                tokenSource,
                tokenPreview,
                error: err instanceof Error ? err.message : String(err),
              });
           }
        }
      } else {
        logger.info(`[AUTH] ${logPrefix} No token provided. Falling back to refresh.`, {
          tokenSource,
        });
      }

      // If we reached here, token is either missing or invalid/expired.
      // 2. Fallback to Session Refresh
      if (!tokenIsValid) {
        logger.info(`[AUTH] ${logPrefix} Step 2: Attempting session refresh`, {
          tokenSource,
          tokenPreview,
        });
        
      // Only attempt if we have a session cookie
      const hasWorkspaceSession = sessionId !== undefined;
      if (hasWorkspaceSession) {
         const refreshed = await this.attemptRefresh(req, res, next);
         if (refreshed) {
           // Logs inside attemptRefresh will handle success details
           return; 
          } else {
            logger.info(`[AUTH] ${logPrefix} Refresh attempt failed.`, {
              tokenSource,
              tokenPreview,
            });
         }
      } else {
        logger.info(`[AUTH] ${logPrefix} No workspace session cookie present.`, {
          tokenSource,
          tokenPreview,
        });
      }
      }

      // 3. Final Failure
      logger.warn(`[AUTH] ${logPrefix} Authentication FAILED. No valid token and no valid session.`, {
        tokenSource,
        tokenPreview,
      });
      res.status(401).json({
        error: 'No session found',
        message: 'Session ID cookie is missing',
      });

    } catch (error) {
      logger.error(`[AUTH] ${logPrefix} CRITICAL middleware error:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ 
        error: 'Authentication failed',
        message: 'Internal server error during authentication'
      });
    }
  };
}

export const authV2Middleware = new AuthV2Middleware();
