import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '@xyne/spaces-contract';
import { randomUUID } from 'node:crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id echoed on every /sdk response and embedded in error envelopes. */
      apiRequestId?: string;
    }
  }
}

/**
 * Accept a caller-supplied request id (so a client can correlate across a retry
 * chain) or mint one. Echoed on success and failure alike.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(REQUEST_ID_HEADER);
  const id = inbound && inbound.length <= 200 ? inbound : `req_${randomUUID()}`;
  req.apiRequestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
