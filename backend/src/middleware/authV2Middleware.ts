import { Request, Response, NextFunction } from 'express';
import { OAuth2Client, gaxios } from 'google-auth-library';
import axios from 'axios';
import { jwtService } from '../services/jwtService';
import { UserService } from '../services/userService';
import { logger as baseLogger } from '../utils/logger';
import '../types/express';
import { UserSessionService } from '../services/userSessionService';
import { config } from '@/config/env';

const logger = baseLogger.child({ module: 'AuthV2Middleware' });
class AuthV2Middleware {
  private userService: UserService;
  private userSessionService: UserSessionService;
  private googleClient: OAuth2Client;

  constructor() {
    this.userService = new UserService();
    this.userSessionService = new UserSessionService();
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      logger.error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. Cannot start AuthV2Middleware.');
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret);
  }

  /**
   * Helper to extract token from various sources
   */
  private extractToken(req: Request): string | null {
    if (req.cookies?.google_access_token) {
      return req.cookies.google_access_token;
    }
    
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    return null;
  }

  /**
   * Helper to attempt honest refresh using session cookie
   */
  private attemptRefresh = async (req: Request, res: Response, next: NextFunction): Promise<boolean> => {
    try {
      const sessionId = req.cookies?.user_session_id;
      logger.info(`[Auto-Refresh] Attempting refresh. Cookie found: ${!!sessionId}`);

      if (!sessionId) {
        logger.info('[Auto-Refresh] No session ID cookie found - cannot refresh');
        return false;
      }

      const session = await this.userSessionService.getSessionById(sessionId);

      if (!session || !session.user) {
        logger.warn(`[Auto-Refresh] Session check failed: Session or user not found for ID ${sessionId}`);
        return false;
      }

      // Check expiry and status
      const now = new Date();
      const isActive = session.status === 'ACTIVE';
      const isExpired = now >= session.refreshTokenExpiry;

      if (!isActive || isExpired) {
        logger.warn(`[Auto-Refresh] Session invalid: Status=${session.status}, Expired=${isExpired} (Expiry: ${session.refreshTokenExpiry})`);
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

          logger.info(`[Auto-Refresh] Google verification successful for user ${session.user.email}`);
        } catch (err) {
          const googleError = err as gaxios.GaxiosError;
          // Check if it's a user-related error vs system error
          const isInvalidGrant = googleError.response?.data?.error === 'invalid_grant';

          if (isInvalidGrant) {
            logger.warn(`[Auto-Refresh] User token revoked for ${session.user.email}`);
            return false;
          } else {
            // For system errors, allow the refresh but log the issue
            logger.warn(`[Auto-Refresh] Google verification FAILED (Transient): Allowing session. User: ${session.user.email}. Error: ${googleError}`);
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

      logger.info(`[Auto-Refresh] Valid session found: ${sessionId} for user ${session.user.email}`);

      // Generate new token
      const customToken = jwtService.generateToken({
        sub: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: session.user.picture,
      });

      // Update session activity
      await this.userSessionService.updateSession(session.id, {
        lastActivity: new Date(),
      });

      // Set new cookie with updated lifespan
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('google_access_token', customToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: config.jwt.expirationSeconds * 1000,
      });

      // Attach user to request so downstream handlers work
      req.user = {
        id: session.user.id,
        googleId: session.user.providerUserId,
        email: session.user.email,
        name: session.user.name,
      };

      logger.info('[Auto-Refresh] SUCCESS: Token refreshed and user attached to request');
      next();
      return true;

    } catch (refreshError) {
      logger.error('[Auto-Refresh] CRITICAL ERROR during auto-refresh:', refreshError);
      return false;
    }
  };

  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logPrefix = `[Auth] [${req.method} ${req.path}]`;
    
    try {
      // 1. Try to get a valid access token first
      const token = this.extractToken(req);
      logger.info(`${logPrefix} Step 1: Token extraction result: ${!!token}`);
      
      let tokenIsValid = false;

      if (token) {
        try {
          const decoded = jwtService.verifyToken(token);
          
          if (decoded && decoded.sub) {
             const user = await this.userService.getUserById(decoded.sub);
             if (user) {
               req.user = {
                 id: user.id,
                 googleId: user.providerUserId,
                 email: user.email,
                 name: user.name,
               };
               logger.info(`${logPrefix} Token verified successfully for user: ${user.email}`);
               tokenIsValid = true;
               return next();
             } else {
               logger.warn(`${logPrefix} Token valid, but user not found in DB: ${decoded.sub}`);
             }
          }
        } catch (err) {
           // Token invalid/expired, log and fall through to refresh logic
           const isExpired = err instanceof Error && err.message === 'JWT token has expired';
           if (isExpired) {
             logger.info(`${logPrefix} Token expired. Falling back to refresh.`);
           } else {
             logger.warn(`${logPrefix} Token invalid. Falling back to refresh. Error: ${err instanceof Error ? err.message : String(err)}`);
           }
        }
      } else {
        logger.info(`${logPrefix} No token provided. Falling back to refresh.`);
      }

      // If we reached here, token is either missing or invalid/expired.
      // 2. Fallback to Session Refresh
      if (!tokenIsValid) {
        logger.info(`${logPrefix} Step 2: Attempting session refresh`);
        
        // Only attempt if we have a session cookie
        if (req.cookies?.user_session_id) {
           const refreshed = await this.attemptRefresh(req, res, next);
           if (refreshed) {
             // Logs inside attemptRefresh will handle success details
             return; 
           } else {
             logger.info(`${logPrefix} Refresh attempt failed.`);
           }
        } else {
          logger.info(`${logPrefix} No session cookie (user_session_id) present.`);
        }
      }

      // 3. Final Failure
      logger.warn(`${logPrefix} Authentication FAILED. No valid token and no valid session.`);
      res.status(401).json({
        error: 'No session found',
        message: 'Session ID cookie is missing',
      });

    } catch (error) {
      logger.error(`${logPrefix} CRITICAL middleware error:`, error);
      res.status(500).json({ 
        error: 'Authentication failed',
        message: 'Internal server error during authentication'
      });
    }
  };
}

export const authV2Middleware = new AuthV2Middleware();
