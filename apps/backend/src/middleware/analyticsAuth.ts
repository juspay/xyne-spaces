import { NextFunction, Request, Response } from 'express';

export const analyticsAuthMiddleware = {
  requireWorkspaceContext: (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.workspaceId) {
      res.status(400).json({
        success: false,
        error: 'Workspace context is required for analytics',
        timestamp: new Date().toISOString()
      });
      return;
    }

    next();
  }
};
