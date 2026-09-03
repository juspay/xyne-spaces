import express, { type Express, type NextFunction, type Request, type Response } from "express";

/** Storage values are capped at 64KB AFTER parsing (the authoritative check,
 *  in routes/artifact-app-storage.ts). This guard runs BEFORE the global 50MB
 *  json parser so an oversized body is refused without being buffered at all —
 *  a router-level limit could not do that, because by the time a router runs
 *  the global parser has already consumed the stream. Best-effort: a chunked
 *  request without Content-Length falls through to the post-parse check. */
const STORAGE_PATH = "/claw/api/v1/artifact-app-storage";
const STORAGE_MAX_BODY_BYTES = 128 * 1024;

function storageBodyGuard(req: Request, res: Response, next: NextFunction): void {
  const length = Number(req.headers["content-length"]);
  if (Number.isFinite(length) && length > STORAGE_MAX_BODY_BYTES) {
    res.status(413).json({ success: false, error: `Request body must be under ${STORAGE_MAX_BODY_BYTES / 1024}KB` });
    return;
  }
  next();
}

export function installParsers(app: Express): void {
  app.use(STORAGE_PATH, storageBodyGuard);
  // Capture the raw request body so verify-spaces-signature middleware can
  // HMAC-check inbound webhook bodies. express.json() consumes the stream
  // otherwise; the verify callback gets the buffer before parsing.
  app.use(express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      if (buf && buf.length > 0) {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  }));
  // Slack slash commands POST application/x-www-form-urlencoded; the signature
  // is computed over the raw form body, so capture it the same way.
  app.use(express.urlencoded({
    extended: false,
    limit: "1mb",
    verify: (req, _res, buf) => {
      if (buf && buf.length > 0) {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      }
    },
  }));
}
