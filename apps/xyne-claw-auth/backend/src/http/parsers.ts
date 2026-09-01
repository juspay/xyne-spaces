import express, { type Express } from "express";

export function installParsers(app: Express): void {
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
