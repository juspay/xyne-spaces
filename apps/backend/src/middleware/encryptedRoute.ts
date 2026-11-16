import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import {
  CLIENT_MANIFEST_STALE_CODE,
  CLIENT_MANIFEST_TAG_HEADER,
  CLIENT_MANIFEST_VERSION_HEADER,
  derivedContentFactsSchema,
  findRequestRule,
} from '@xyne/shared';
import type { RequestContract } from '@xyne/shared';
import { config } from '@/config/env';
import {
  getEncryptionProvider,
  getLatestClientManifest,
  isDekPassthrough,
  manifestEnvironmentForRequest,
  runWithDekPassthrough,
} from '@/services/encryption';
import type { ClientManifestRule } from '@/services/encryption';
import { decryptRequestBody, rejectIfRuleViolated, sanitizeForLog, transitTicket } from './decryptionMiddleware';

/**
 * Everything a route whose body is under a client manifest rule runs, in order:
 *
 * 1. enterDekPassthrough: the rest of the request runs with DEK passthrough on, so the
 *    Prisma encryption extension leaves storage ciphertext in the rows it returns.
 * 2. transformRequest: transit ciphertext (CEK) in the body becomes workspace-DEK ciphertext
 *    (encryption service /internal/transit/transform-request); the handler never sees
 *    plaintext of a MASTER_DEK field.
 * 3. transformResponse: the JSON response's storage ciphertext becomes transit ciphertext
 *    for the caller (encryption service /internal/transit/transform-response).
 *
 * Mount it after the upload middleware (multer fills req.body) and right before the handler:
 *   router.post(path, uploadMultiple, ...encryptedRoute(contract, { resolveWorkspaceId }), handler)
 */
export function encryptedRoute(contract: RequestContract, options: Omit<EncryptedRouteOptions, 'contract'>) {
  return [enterDekPassthrough, transformRequest({ contract, ...options }), transformResponse];
}

/** Entity type of the keys the Prisma encryption extension writes rows under. */
const WORKSPACE_ENTITY_TYPE = 'WORKSPACE';

function enterDekPassthrough(req: Request, _res: Response, next: NextFunction): void {
  if (config.enc.enableDbEncryption && config.enc.apiClientEncryptionEnabled && req.user?.sid) {
    runWithDekPassthrough(() => next());
    return;
  }
  next();
}

/**
 * Transform transit-encrypted fields by their manifest rule instead of decrypting them:
 * `MASTER_DEK` fields come back as workspace-DEK ciphertext the Prisma extension stores
 * as-is, `NONE` fields as plaintext. The controller never sees a MASTER_DEK plaintext. The
 * tickets the fields are under travel inside the ciphertext; the service opens them for the
 * request's session.
 */
async function transformRequestBody(
  req: Request,
  res: Response,
  next: NextFunction,
  rule: ClientManifestRule,
  options: EncryptedRouteOptions,
): Promise<void> {
  try {
    // Called whenever the route has a rule, encrypted fields or not: the encryption service
    // is what rejects a body that sends a client field in plaintext, so it must see it.
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    const subject = req.user?.sid;
    if (!subject) {
      logger.warn('[encryptedRoute] encrypted fields present but session ID missing', {
        method: sanitizeForLog(req.method),
        path: sanitizeForLog(req.path),
        hasSessionId: false,
      });
      getCryptoOperations().add(1, {
        operation: 'transform_request_body',
        status: 'error',
        reason: 'missing_session',
        path: req.path,
      });
      return next(new AppError('Encrypted request body requires an active session', 400));
    }

    // The DEK is the owning workspace's, the same one the Prisma extension would pick for
    // the row, so the stored value is indistinguishable from one it encrypted itself.
    const needsDek = Object.values(rule.fields).some(
      (field) => field.client && field.transform === 'MASTER_DEK',
    );
    const owner = needsDek
      ? { entityId: await options.resolveWorkspaceId(req), entityType: WORKSPACE_ENTITY_TYPE }
      : {};

    // The client's manifest goes along so the encryption service checks the version itself.
    const versionHeader = req.get(CLIENT_MANIFEST_VERSION_HEADER);
    const { body, derived } = await getEncryptionProvider().transformRequest({
      body: req.body,
      subject,
      rule: { type: rule.type, value: rule.value, revision: rule.revision },
      manifest: {
        tag: req.get(CLIENT_MANIFEST_TAG_HEADER) || 'default',
        environment: manifestEnvironmentForRequest(req),
        version: versionHeader && /^\d+$/.test(versionHeader) ? Number(versionHeader) : null,
      },
      ...owner,
    });
    req.body = body;
    req.encRule = rule;

    // Facts the encryption service extracted from the plaintext; validated before any
    // consumer trusts them in place of parsing `content`.
    if (derived !== undefined) {
      const parsedDerived = derivedContentFactsSchema.safeParse(derived);
      if (!parsedDerived.success) {
        logger.error('[encryptedRoute] encryption service returned invalid derived facts', {
          method: sanitizeForLog(req.method),
          path: sanitizeForLog(req.path),
          route: sanitizeForLog(rule.value),
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

    logger.info('[encryptedRoute] request body transformed by manifest rule', {
      method: sanitizeForLog(req.method),
      path: sanitizeForLog(req.path),
      route: sanitizeForLog(rule.value),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    // The encryption service's own verdicts on the request: surface them as such (the
    // client refreshes its manifest and retries on 409) instead of as an outage.
    const status = (error as { status?: unknown }).status;
    if (status === 409 || status === 400) {
      getCryptoOperations().add(1, {
        operation: 'transform_request_body',
        status: 'error',
        reason: status === 409 ? 'manifest_stale' : 'rule_violation',
        path: sanitizeForLog(req.path),
      });
      res.status(status).json(
        status === 409
          ? { error: 'Client encryption manifest is stale', code: CLIENT_MANIFEST_STALE_CODE }
          : { error: 'Request violates the client encryption manifest', code: 'ENC_MANIFEST_VIOLATION' },
      );
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

export type EncryptedRouteOptions = {
  /** This route's request shape. Its fields must match the manifest rule matched for it. */
  contract: RequestContract;
  /**
   * Workspace whose DEK the rule's `MASTER_DEK` fields are re-encrypted under: the one the
   * row being written belongs to (what the Prisma extension resolves for it). Called only
   * when the matched rule has such a field. Throw an AppError (for example a 404) when the
   * target row does not exist.
   */
  resolveWorkspaceId: (req: Request) => Promise<string>;
};

/**
 * Where the route's contract (body shape, code) and the manifest rule for its URL
 * (encryption policy, DB) disagree on field names, in either direction. A rule field the
 * schema lacks is a typo or a removed field; a schema field the rule lacks would go out
 * without a policy.
 */
function contractFieldMismatches(contract: RequestContract, rule: ClientManifestRule): string[] {
  const schemaFields = new Set(Object.keys(contract.schema.shape));
  const ruleFields = new Set(Object.keys(rule.fields));
  const mismatches: string[] = [];
  const notInRule = [...schemaFields].filter((field) => !ruleFields.has(field));
  const notInSchema = [...ruleFields].filter((field) => !schemaFields.has(field));
  if (notInRule.length > 0) mismatches.push(`schema fields missing from the manifest rule: ${notInRule.join(', ')}`);
  if (notInSchema.length > 0) mismatches.push(`manifest fields missing from the schema: ${notInSchema.join(', ')}`);
  return mismatches;
}

/**
 * The route's contract and the manifest disagree: no rule for a route that has a contract
 * (the route moved or the rule was never written), or the field names differ. Fails the
 * request in development; elsewhere it is logged and counted and the request continues.
 */
function reportContractDrift(req: Request, res: Response, problem: string): boolean {
  logger.error('[encryptedRoute] request contract and client manifest disagree', {
    method: sanitizeForLog(req.method),
    path: sanitizeForLog(req.originalUrl.split('?')[0]),
    problem: sanitizeForLog(problem),
  });
  getCryptoOperations().add(1, {
    operation: 'enc_contract_mismatch',
    status: 'error',
  });
  if (config.env !== 'development') return false;
  res.status(500).json({
    error: 'Request contract and client encryption manifest disagree',
    code: 'ENC_CONTRACT_MISMATCH',
    problem,
  });
  return true;
}

/**
 * Per-route counterpart of decryptRequestBodyMiddleware. It runs after the upload
 * middleware: express.json() skips multipart, so `req.body` is still undefined when the
 * auth middleware runs and is only filled in by multer. Rejects bodies that violate the manifest rule (400
 * ENC_MANIFEST_VIOLATION), then, when the route has a rule and DB encryption is on,
 * transforms transit-encrypted fields by that rule (MASTER_DEK fields stay ciphertext, now
 * under the workspace DEK). Without a rule, or with DB encryption off (no DEK to re-encrypt
 * under), it decrypts to plaintext as before. The manifest version check already ran in
 * the auth middleware.
 */
function transformRequest(options: EncryptedRouteOptions) {
  return async function transformRequestMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!config.enc.apiClientEncryptionEnabled) {
      return next();
    }

    const tagHeader = req.get(CLIENT_MANIFEST_TAG_HEADER);
    const tag = tagHeader ? tagHeader : 'default';
    const environment = manifestEnvironmentForRequest(req);

    let latest: Awaited<ReturnType<typeof getLatestClientManifest>> = null;
    try {
      latest = await getLatestClientManifest(tag, environment);
    } catch (error) {
      // Fail open on the rule check, as enforceClientManifestVersion does; decryption below
      // still runs.
      logger.error('[encryptedRoute] failed to load client manifest, skipping rule check', {
        method: sanitizeForLog(req.method),
        path: sanitizeForLog(req.path),
        tag: sanitizeForLog(tag),
        environment,
        error: sanitizeForLog(error instanceof Error ? error.message : String(error)),
      });
    }

    const { contract } = options;
    const rule = latest ? findRequestRule(latest, req.method, req.originalUrl) : undefined;

    // Only judged when the manifest loaded (an encryption-service outage is not drift) and
    // the caller follows the manifest (it sends the version header). Callers that don't,
    // such as apps through the /conversations/claw mount of this router, have no rule by
    // design.
    if (latest && !rule && req.get(CLIENT_MANIFEST_VERSION_HEADER)) {
      if (reportContractDrift(req, res, 'no manifest rule for this route')) return;
    }
    if (rule) {
      const mismatches = contractFieldMismatches(contract, rule);
      if (mismatches.length > 0 && reportContractDrift(req, res, mismatches.join('; '))) return;

      if (latest && rejectIfRuleViolated(req, res, rule, latest, environment)) return;
    }

    // Shape check against the route's contract. passthrough() on purpose: keys the
    // contract does not list are allowed for now. Only validates; req.body is not replaced
    // with the parsed (coerced) value.
    const parsed = contract.schema.passthrough().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Request body does not match its contract',
        code: 'ENC_CONTRACT_VIOLATION',
        issues: parsed.error.issues,
      });
      return;
    }

    if (rule && config.enc.enableDbEncryption) {
      return transformRequestBody(req, res, next, rule, options);
    }

    await decryptRequestBody(req, next);
  };
}

/**
 * Re-encrypt the response from the DEK to the caller's transit ticket. Only under DEK
 * passthrough: otherwise the global encryptResponseBodyMiddleware handles the response as
 * on any other route. Installed after it, so this wrapper runs first and hands the transit
 * ciphertext to it, which then passes it through unchanged.
 */
function transformResponse(req: Request, res: Response, next: NextFunction): void {
  const subject = req.user?.sid;
  if (!isDekPassthrough() || !subject) {
    return next();
  }

  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown): Response => {
    if (!body || typeof body !== 'object') {
      return originalJson(body);
    }

    void getEncryptionProvider()
      .transformResponse(body, subject, transitTicket(req))
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
