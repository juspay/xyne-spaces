import { Request, Response, NextFunction } from 'express';
import { OAuth2Client, gaxios } from 'google-auth-library';
import axios from 'axios';
import { jwtService } from '../services/jwtService';
import { logger as baseLogger } from '../utils/logger';
import '../types/express';
import { UserSessionService } from '../services/userSessionService';
import { config } from '@/config/env';
import { db } from '@/database/client';

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
    return req.cookies?.xyne_session;
  }

  /**
   * Helper to attempt honest refresh using session cookie
   */
  private attemptRefresh = async (req: Request, res: Response, next: NextFunction): Promise<boolean> => {
    try {
      const sessionId = this.getSessionId(req);
      const workspaceId = (req.headers['x-workspace-id'] as string) || req.cookies?.xyne_last_workspace;
      
      logger.info(`[AUTH] [Auto-Refresh] Attempting refresh. Cookie found: ${!!sessionId} ${sessionId}`, {
        method: req.method,
        path: req.path,
        sessionId,
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
        logger.warn(`[AUTH] [Auto-Refresh] Session check failed: Session or user not found for ID ${sessionId}`, {
          sessionId,
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
        logger.warn(`[AUTH] [Auto-Refresh] Session invalid: Status=${session.status}, Expired=${isExpired} ${sessionId} (Expiry: ${session.refreshTokenExpiry})`, {
          sessionId,
          userId: session.user.id,
          email: session.user.email,
          sessionStatus: session.status,
          refreshTokenExpiry: session.refreshTokenExpiry.toISOString(),
        });
        return false;
      }

      // --- Provider Verification Step ---
      // Only verify with Google if the user authenticated via Google
      if (session.user.authProvider === 'GOOGLE' && session.refreshToken) {
        try {
          // Verify if the user is still valid in Google by checking their refresh token
          this.googleClient.setCredentials({ refresh_token: session.refreshToken });

          // Attempt to get a new access token.
          // If the user has been deleted or suspended in Google, this should throw.
          await this.googleClient.getAccessToken();
          
          logger.info(`[AUTH] [Auto-Refresh] Google verification successful for user ${session.user.email} ${sessionId}`, {
            userSessionId:sessionId,
            userId: session.user.id,
            email: session.user.email,
          });
        } catch (err) {
          const googleError = err as gaxios.GaxiosError;
          // Check if it's a user-related error vs system error
          const isInvalidGrant = googleError.response?.data?.error === 'invalid_grant';

          if (isInvalidGrant) {
            logger.warn(`[AUTH] [Auto-Refresh] User token revoked for ${session.user.email} ${sessionId}`, {
              sessionId,
              userId: session.user.id,
              email: session.user.email,
            });
            return false;
          } else {
            // For system errors, allow the refresh but log the issue
            logger.warn(`[AUTH] [Auto-Refresh] Google verification FAILED (Transient): Allowing session. User: ${session.user.email}. Error: ${googleError} ${sessionId}`, {
              sessionId,
              userId: session.user.id,
              email: session.user.email,
              error: googleError.message,
            });
          }
          // Proceed with local session if it's just a network/transient error
        }
      } else if (session.user.authProvider === 'MICROSOFT') {
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
      } else if (!session.refreshToken) {
         logger.info(`[Auto-Refresh] No refresh token in session for user ${session.user.email}. Skipping provider check.`);
      }
      // --------------------------------

      logger.info(`[AUTH] [Auto-Refresh] Valid session found: ${sessionId} for user ${session.user.email}`, {
        sessionId,
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
      
      // Legacy cookie (backward compatibility)
      res.cookie('google_access_token', customToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: config.jwt.expirationSeconds * 1000,
      });
      
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
      req.user = {
        id: session.user.id,
        googleId: session.user.providerUserId,
        email: session.user.email,
        name: session.user.name,
        workspaceId: session.user.workspaceId,
        role: session.user.role,
        orgRole: session.user.orgMember.role,
        memberId: session.user.orgMemberId,
      };

      logger.info(`[AUTH] [Auto-Refresh] SUCCESS: Token refreshed and user attached to request ${sessionId}`, {
        sessionId,
        userId: session.user.id,
        googleId: session.user.providerUserId,
        email: session.user.email,
        tokenPreview,
      });
      next();
      return true;

    } catch (refreshError) {
      logger.error('[AUTH] [Auto-Refresh] CRITICAL ERROR during auto-refresh:', {
        sessionId: req.cookies?.user_session_id,
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
      logger.info(`[AUTH] ${logPrefix} Step 1: Token extraction result: ${!!token} ${sessionId}`, {
        method: req.method,
        path: req.path,
        sessionId,
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
              // Validate required claims in JWT token
              if (!decoded.memberId || !decoded.workspaceId) {
                logger.error(`[AUTH] ${logPrefix} JWT token missing required claims: memberId=${!!decoded.memberId}, workspaceId=${!!decoded.workspaceId} ${sessionId}`, {
                  sessionId,
                  tokenSource,
                  tokenPreview,
                  decodedClaims: Object.keys(decoded),
                });
                res.status(401).json({
                  error: 'Invalid token',
                  message: 'Token missing required claims. Please login again.',
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
                    leftAt: true, 
                    providerUserId: true 
                  }
                }),
                db.orgMember.findUnique({
                  where: { memberId: decoded.memberId },
                  select: { role: true }
                })
              ]);
              
              if (user) {
                if (user.leftAt) {
                  logger.warn(`[AUTH] ${logPrefix} User has been removed from workspace: ${user.email} ${sessionId}`, {
                    sessionId,
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
                 } else {
                  // Use fresh roles from database
                  const workspaceRole = user.role;
                  const orgRole = orgMember!.role;
                  
                  req.user = {
                    id: user.id,
                    googleId: user.providerUserId,
                    email: user.email,
                    name: user.name,
                    workspaceId: decoded.workspaceId,
                    role: workspaceRole,
                    orgRole: orgRole,
                    memberId: decoded.memberId,
                  };
                  logger.info(`[AUTH] ${logPrefix} Token verified successfully for user: ${user.email} ${sessionId}`, {
                    sessionId,
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
                }
             } else {
               logger.warn(`[AUTH] ${logPrefix} Token valid, but user not found in DB: ${decoded.sub} ${sessionId}`, {
                 sessionId,
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
             logger.info(`[AUTH] ${logPrefix} ${sessionId} Token expired. Falling back to refresh.`, {
               sessionId,
               tokenSource,
               tokenPreview,
             });
           } else {
             logger.warn(`[AUTH] ${logPrefix} ${sessionId} Token invalid. Falling back to refresh. Error: ${err instanceof Error ? err.message : String(err)}`, {
               sessionId,
               tokenSource,
               tokenPreview,
               error: err instanceof Error ? err.message : String(err),
             });
           }
        }
      } else {
        logger.info(`[AUTH] ${logPrefix} ${sessionId} No token provided. Falling back to refresh.`, {
          sessionId,
          tokenSource,
        });
      }

      // If we reached here, token is either missing or invalid/expired.
      // 2. Fallback to Session Refresh
      if (!tokenIsValid) {
        logger.info(`[AUTH] ${logPrefix} ${sessionId} Step 2: Attempting session refresh`, {
          sessionId,
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
           logger.info(`[AUTH] ${logPrefix} ${sessionId} Refresh attempt failed.`, {
             sessionId,
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
      logger.warn(`[AUTH] ${logPrefix} ${sessionId} Authentication FAILED. No valid token and no valid session.`, {
        sessionId,
        tokenSource,
        tokenPreview,
      });
      res.status(401).json({
        error: 'No session found',
        message: 'Session ID cookie is missing',
      });

    } catch (error) {
      logger.error(`[AUTH] ${logPrefix}  ${sessionId} CRITICAL middleware error:`, {
        sessionId,
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
