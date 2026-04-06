import type { Request, Response, NextFunction } from "express";
import { SERVER } from "../config.js";

export function validateS2SKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-s2s-key"];

  if (!SERVER.s2sKey) {
    next();
    return;
  }

  if (key !== SERVER.s2sKey) {
    res.status(401).json({ success: false, error: "Invalid or missing S2S key" });
    return;
  }

  next();
}
