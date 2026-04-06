import type { Request } from "express";

export interface JwtPayload {
  readonly userId: string;
}

export interface AuthenticatedRequest extends Request {
  userId: string;
}
