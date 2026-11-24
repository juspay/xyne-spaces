import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import {
  derivedFactsSchema,
  derivedNames,
  makeReadable,
  makeUnreadable,
  sourceFieldNames,
} from '@xyne/shared';
import type { RequestContract } from '@xyne/shared';
import { config } from '@/config/env';
import {
  getEncryptionProvider,
  isDekPassthrough,
  manifestEnvironmentForRequest,
  runWithDekPassthrough,
} from '@/services/encryption';
import type { TransitCaller } from '@/services/encryption';
import { decryptRequestBody, hasTransitCaller, sanitizeForLog, transitCaller } from './decryptionMiddleware';

/**
 * Everything a route whose body is under a client manifest rule runs, in order:
 *
 * 1. enterDekPassthrough: the rest of the request runs with DEK passthrough on, so the
 *    Prisma encryption extension leaves storage ciphertext in the rows it returns.
 * 2. transformRequest: transit ciphertext (CEK) in the body becomes workspace-DEK ciphertext
 *    (encryption service /internal/transit/transform-request); the handler never sees
 *    plaintext of a MASTER_DEK field.
 * 3. makeBodyUnreadable: the contract's `unreadableString()` fields are wrapped in
 *    `UnreadableString`, whatever they hold by now (ciphertext or plaintext), so the handler
 *    reads them only through reveal().
 * 4. transformResponse: the JSON response's storage ciphertext becomes transit ciphertext
 *    for the caller (encryption service /internal/transit/transform-response).
 * 5. writeResponse: the response's `unreadableString()` fields, which the handler passed as
 *    `UnreadableString`, become their text here, as the body is written; outside production
 *    a 2xx body that does not match the contract's `response` schema is also logged. It
 *    wraps res.json last, so it gets the body as the handler wrote it, before step 4.
 *
 * The manifest is the encryption service's alone: it picks the rule for the request and
 * runs every check against it; this file forwards the request and relays its verdict.
 *
 * Mount it after the upload middleware (multer fills req.body) and right before the handler:
 *   router.post(path, uploadMultiple, ...encryptedRoute(contract, { resolveWorkspaceId }), handler)
 */
export function encryptedRoute(contract: RequestContract, options: Omit<EncryptedRouteOptions, 'contract'>) {
  return [
    enterDekPassthrough,
    transformRequest({ contract, ...options }),
    makeBodyUnreadable(contract),
    transformResponse,
    writeResponse(contract),
  ];
}

export type EncryptedRouteOptions = {
  /** This route's request shape. */
  contract: RequestContract;
  /** Workspace whose DEK the encrypted fields are stored under: the one the row belongs to. */
  resolveWorkspaceId: (req: Request) => Promise<string>;
};

/** Entity type of the keys the Prisma encryption extension writes rows under. */
const WORKSPACE_ENTITY_TYPE = 'WORKSPACE';

function enterDekPassthrough(req: Request, _res: Response, next: NextFunction): void {
  if (config.enc.enableDbEncryption && config.enc.apiClientEncryptionEnabled && req.user?.sid) {
    runWithDekPassthrough(() => next());
    return;
  }
  next();
}

/** Last step before the handler, on every path through transformRequest (encryption on or off). */
function makeBodyUnreadable(contract: RequestContract) {
  return function makeBodyUnreadableMiddleware(req: Request, _res: Response, next: NextFunction): void {
    if (contract.unreadableFields.length > 0 && req.body && typeof req.body === 'object') {
      req.body = makeUnreadable(contract, req.body);
    }
    next();
  };
}

/**
 * Per-route counterpart of decryptRequestBodyMiddleware. It runs after the upload
 * middleware: express.json() skips multipart, so `req.body` is still undefined when the
 * auth middleware runs and is only filled in by multer. Checks the body against the
 * route's contract, then has the encryption service transform it. With DB encryption off
 * there is no DEK to re-encrypt under, so it decrypts to plaintext as before.
 */
function transformRequest(options: EncryptedRouteOptions) {
  const contractFields = Object.keys(options.contract.schema.shape);
  const contractEncrypted = sourceFieldNames(options.contract);
  const contractDerived = derivedNames(options.contract);
  return async function transformRequestMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!config.enc.apiClientEncryptionEnabled) {
      return next();
    }

    // Shape check against the route's contract. passthrough() on purpose: keys the
    // contract does not list are allowed for now. Only validates; req.body is not replaced
    // with the parsed (coerced) value.
    const parsed = options.contract.schema.passthrough().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Request body does not match its contract',
        code: 'ENC_CONTRACT_VIOLATION',
        issues: parsed.error.issues,
      });
      return;
    }

    if (!config.enc.enableDbEncryption) {
      return decryptRequestBody(req, next);
    }
    // The response comes back from the DEK as transit ciphertext for the caller, so the
    // caller's transit public key must be known before the handler writes anything.
    const caller = transitCaller(req);
    if (!hasTransitCaller(caller)) {
      getCryptoOperations().add(1, {
        operation: 'transform_request_body',
        status: 'error',
        reason: 'missing_client_key',
        path: sanitizeForLog(req.path),
      });
      res.status(400).json({
        error: 'Encrypted route requires the client transit key',
        code: 'TRANSIT_KEY_REQUIRED',
      });
      return;
    }
    return transformRequestBody(req, res, next, options, caller, { contractFields, contractEncrypted, contractDerived });
  };
}

/**
 * Transform transit-encrypted fields by their manifest rule instead of decrypting them:
 * `MASTER_DEK` fields come back as workspace-DEK ciphertext the Prisma extension stores
 * as-is, `NONE` fields as plaintext. The controller never sees a MASTER_DEK plaintext.
 */
async function transformRequestBody(
  req: Request,
  res: Response,
  next: NextFunction,
  options: EncryptedRouteOptions,
  caller: TransitCaller,
  contract: { contractFields: string[]; contractEncrypted: string[]; contractDerived: Record<string, string[]> },
): Promise<void> {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    const { body, derived } = await getEncryptionProvider().transformRequest({
      body: req.body,
      ...caller,
      method: req.method,
      path: req.originalUrl,
      environment: manifestEnvironmentForRequest(req),
      ...contract,
      entityId: await options.resolveWorkspaceId(req),
      entityType: WORKSPACE_ENTITY_TYPE,
    });
    req.body = body;

    // Facts the encryption service extracted from the plaintext; validated before any
    // consumer trusts them in place of parsing `content`.
    if (derived !== undefined) {
      const parsedDerived = derivedFactsSchema.safeParse(derived);
      if (!parsedDerived.success) {
        logger.error('[encryptedRoute] encryption service returned invalid derived facts', {
          method: sanitizeForLog(req.method),
          path: sanitizeForLog(req.path),
          issues: parsedDerived.error.issues,
        });
        getCryptoOperations().add(1, {
          operation: 'transform_request_body',
          status: 'error',
          reason: 'derived_invalid',
          path: sanitizeForLog(req.path),
        });
        res.status(400).json({
          error: 'Derived content facts from the encryption service are invalid',
          code: 'ENC_DERIVED_INVALID',
        });
        return;
      }
      req.derived = parsedDerived.data;
    }

    logger.info('[encryptedRoute] request body transformed', {
      method: sanitizeForLog(req.method),
      path: sanitizeForLog(req.path),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    // The encryption service's verdict on the request (stale manifest, rule violation,
    // contract drift): it carries a `code`, and goes to the client as the service sent it.
    const { status, body } = error as { status?: unknown; body?: unknown };
    const code = (body as { code?: unknown } | undefined)?.code;
    if (typeof status === 'number' && typeof code === 'string') {
      getCryptoOperations().add(1, {
        operation: 'transform_request_body',
        status: 'error',
        reason: code,
        path: sanitizeForLog(req.path),
      });
      res.status(status).json(body);
      return;
    }
    logger.error('[encryptedRoute] failed to transform request body', {
      method: sanitizeForLog(req.method),
      path: sanitizeForLog(req.path),
      error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
    });
    getCryptoOperations().add(1, {
      operation: 'transform_request_body',
      status: 'error',
      reason: 'transform_failed',
      path: sanitizeForLog(req.path),
    });
    return next(new AppError('Failed to transform encrypted request body', 502));
  }
  next();
}

/**
 * Re-encrypt the response from the DEK to the caller's transit key. Only under DEK
 * passthrough: otherwise the global encryptResponseBodyMiddleware handles the response as
 * on any other route. Installed after it, so this wrapper runs first and hands the transit
 * ciphertext to it, which then passes it through unchanged.
 */
function transformResponse(req: Request, res: Response, next: NextFunction): void {
  const caller = transitCaller(req);
  if (!isDekPassthrough() || !req.user?.sid || !hasTransitCaller(caller)) {
    return next();
  }

  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown): Response => {
    if (!body || typeof body !== 'object') {
      return originalJson(body);
    }

    void getEncryptionProvider()
      .transformResponse(body, caller)
      .then((result) => originalJson(result.body))
      .catch((error) => {
        logger.error('[encryptedRoute] failed to transform response body', {
          method: sanitizeForLog(req.method),
          path: sanitizeForLog(req.path),
          error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
        });
        if (!res.headersSent) {
          res.status(502);
          originalJson({ error: 'Failed to encrypt response body' });
        } else {
          res.end();
        }
      });

    return res;
  }) as Response['json'];

  next();
}

/**
 * The one place a contracted route's response becomes readable: the contract's unreadable
 * response fields are turned into their text and the result is sent. Outside production it
 * also compares each 2xx body with the contract's `response` schema and logs where they
 * differ (field paths and issue codes, never values); the response is sent either way.
 */
function writeResponse(contract: RequestContract) {
  const schema = contract.response;
  return function writeResponseMiddleware(req: Request, res: Response, next: NextFunction): void {
    const sendJson = res.json.bind(res);
    res.json = ((body?: unknown): Response => {
      const wire = makeReadable(contract, body);
      if (schema && config.env !== 'production' && res.statusCode >= 200 && res.statusCode < 300) {
        const route = `${sanitizeForLog(req.method)} ${sanitizeForLog(req.baseUrl)}${String(req.route?.path ?? '')}`;
        try {
          // Through JSON first: the schema is checked against the wire form (a Date is a string there).
          const parsed = schema.safeParse(JSON.parse(JSON.stringify(wire)));
          if (!parsed.success) {
            logger.warn('[encryptedRoute] response does not match its contract', {
              route,
              issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
            });
          }
        } catch (error) {
          logger.warn('[encryptedRoute] response could not be checked against its contract', {
            route,
            reason: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      return sendJson(wire);
    }) as Response['json'];
    next();
  };
}
