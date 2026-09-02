import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '@/config/env';
import { authMiddleware } from '@/middleware/auth';
import { certificateRotationLimiter } from '@/middleware/rateLimiters';

const router = Router();
const serialPattern = /^[0-9a-f]{1,64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const serialHeader = 'x-verified-client-cert-serial';

type ErrorBody = { error: { code: string; message: string; retry_after?: string | number } };

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function clientCertificateSerial(req: Request): string | null {
  const suppliedSecret = req.header('x-mtls-ingress-key') ?? '';
  const expectedSecret = config.mtlsAuth.ingressSharedSecret;
  const supplied = Buffer.from(suppliedSecret);
  const expected = Buffer.from(expectedSecret);
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  const value = req.header(serialHeader)?.trim().toLowerCase();
  return value && serialPattern.test(value) ? value : null;
}

function hasOnlyKeys(body: unknown, keys: string[]): body is Record<string, unknown> {
  return !!body
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).every(key => keys.includes(key))
    && Object.keys(body).length === keys.length;
}

function isUpstreamError(value: unknown): value is ErrorBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const error = (value as { error?: unknown }).error;
  return !!error
    && typeof error === 'object'
    && !Array.isArray(error)
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { message?: unknown }).message === 'string';
}

async function proxyRotation(
  req: Request,
  res: Response,
  path: string,
  body: Record<string, string>,
  forwardCurrentSerial = false,
): Promise<void> {
  const serial = clientCertificateSerial(req);
  if (!serial) {
    sendError(res, 401, 'CLIENT_CERTIFICATE_REQUIRED', 'Verified client certificate is required');
    return;
  }
  if (!req.user || !config.mtlsAuth.url || !config.mtlsServiceSecret) {
    sendError(res, 503, 'CERTIFICATE_SERVICE_UNAVAILABLE', 'Certificate service is unavailable');
    return;
  }

  try {
    const upstream = await fetch(new URL(path, `${config.mtlsAuth.url.replace(/\/$/, '')}/`), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-s2s-key': config.mtlsServiceSecret,
      },
      body: JSON.stringify({
        ...body,
        user_email: req.user.email.toLowerCase(),
        ...(forwardCurrentSerial ? { current_certificate_serial: serial } : {}),
      }),
      signal: AbortSignal.timeout(config.mtlsAuth.requestTimeoutMs),
    });
    const payload: unknown = await upstream.json().catch(() => null);
    if (upstream.ok) {
      if (!payload || typeof payload !== 'object') {
        sendError(res, 502, 'INVALID_CERTIFICATE_SERVICE_RESPONSE', 'Certificate service returned an invalid response');
        return;
      }
      res.status(upstream.status).json(payload);
      return;
    }
    if (isUpstreamError(payload)) {
      res.status(upstream.status).json(payload);
      return;
    }
    sendError(res, 502, 'CERTIFICATE_SERVICE_ERROR', 'Certificate service request failed');
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    sendError(
      res,
      timedOut ? 504 : 503,
      timedOut ? 'CERTIFICATE_SERVICE_TIMEOUT' : 'CERTIFICATE_SERVICE_UNAVAILABLE',
      timedOut ? 'Certificate service request timed out' : 'Certificate service is unavailable',
    );
  }
}

router.post('/re-enroll', authMiddleware.authenticate, certificateRotationLimiter, async (req, res) => {
  if (!hasOnlyKeys(req.body, ['csr'])
    || typeof req.body.csr !== 'string'
    || req.body.csr.length === 0
    || Buffer.byteLength(req.body.csr, 'utf8') > 32 * 1024) {
    sendError(res, 400, 'INVALID_ROTATION_REQUEST', 'CSR is required');
    return;
  }
  await proxyRotation(req, res, 'internal/v1/certificate-rotations', {
    csr: req.body.csr,
  }, true);
});

router.post('/cert-ack', authMiddleware.authenticate, certificateRotationLimiter, async (req, res) => {
  if (!hasOnlyKeys(req.body, ['rotation_id'])
    || typeof req.body.rotation_id !== 'string'
    || !uuidPattern.test(req.body.rotation_id)) {
    sendError(res, 400, 'INVALID_ACK_REQUEST', 'UUID rotation_id is required');
    return;
  }
  await proxyRotation(
    req,
    res,
    `internal/v1/certificate-rotations/${req.body.rotation_id}/ack`,
    {},
  );
});

export default router;
