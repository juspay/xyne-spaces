import type { Request, Response, NextFunction } from "express";

export function pinUserIdParam(req: Request, res: Response, next: NextFunction): void {
  const sessionUserId = req.headers["x-user-id"];
  if (typeof sessionUserId !== "string" || !sessionUserId) {
    next();
    return;
  }
  const urlUserId = (req.params as { userId?: string }).userId;
  if (!urlUserId || urlUserId === sessionUserId) {
    next();
    return;
  }
  console.warn(`[pin-user-id] reject: session=${sessionUserId} url=${urlUserId} path=${req.path}`);
  res.status(403).json({ success: false, error: "userId in URL does not match authenticated session" });
}
