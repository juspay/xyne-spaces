import { Request, Response, NextFunction } from 'express';
import { jwtService } from '../services/jwtService';
import { UserService } from '../services/userService';
import { logger } from '../utils/logger';
import '../types/express';

class AuthV2Middleware {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let token: string | null = null;

      const cookieToken = req.cookies?.google_access_token;
      if (cookieToken) {
        token = cookieToken;
      }

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      if (!token) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'No access token provided',
          needsReauth: true
        });
        return;
      }

      const decoded = jwtService.verifyToken(token);

      if (!decoded || !decoded.sub) {
        res.status(401).json({
          error: 'Invalid token',
          message: 'Token verification failed',
          needsReauth: true
        });
        return;
      }

      const user = await this.userService.getUserById(decoded.sub);

      if (!user) {
        res.status(401).json({
          error: 'User not found',
          message: 'Token is valid but user does not exist',
          needsReauth: true
        });
        return;
      }

      req.user = {
        id: user.id,
        googleId: user.providerUserId,
        email: user.email,
        name: user.name,
      };

      next();

    } catch (error) {
      if (error instanceof Error && error.message === 'JWT token has expired') {
        logger.warn('Token expired - client must refresh');
        res.status(401).json({
          error: 'Token expired',
          message: 'Access token has expired',
          needsRefresh: true
        });
        return;
      }

      if (error instanceof Error && error.message === 'Invalid JWT token') {
        logger.warn('Invalid token format or signature');
        res.status(401).json({
          error: 'Invalid token',
          message: 'Token verification failed',
          needsRefresh: true
        });
        return;
      } 

      logger.error('Authentication middleware error:', error);
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Internal server error during authentication'
      });
    }
  };
}

export const authV2Middleware = new AuthV2Middleware();
