/**
 * GET /encryption-rules: which SDK operations run a Zero mutator with a client-encryption
 * rule, and what the client needs to know to follow that rule.
 *
 * The rules themselves (which fields the client encrypts) are the client manifest, which the
 * encryption service serves encrypted for the caller's transit key (`GET
 * /api/encryption-manifest`), so the backend relaying it can neither read nor change them.
 * Those rules are keyed by Zero mutator name, which an SDK caller never sees; this route
 * supplies the missing link, operation id → mutator name, from the version's own resolver.
 * The client looks the mutator's rule up in its decrypted manifest.
 *
 * It also names the operation's mention fields (`MENTION_FIELDS`): the server expands mention
 * shorthand in those before the mutator runs, but cannot once they are ciphertext, so a
 * client encrypting one expands it first.
 *
 * Only operations whose mutator has a rule are listed, so the answer is small and changes
 * only when a manifest rule or an operation mapping does.
 */

import { Router, type Request, type Response } from 'express';
import { getEncryptionProvider } from '@/services/encryption';
import { handle } from './handler';
import { MENTION_FIELDS } from './v1/parser';
import type { V1Target } from './v1/types';

export interface EncryptionRuleOp {
  /** The Zero mutator the operation runs: the `value` of its `MUTATOR` rule in the manifest. */
  readonly mutator: string;
  /** Arguments whose mention shorthand the client expands before encrypting them. */
  readonly mentionFields: readonly string[];
}

export interface EncryptionRulesResponse {
  /** Every operation whose mutator has a client-encryption rule, by operation id. */
  readonly ops: Readonly<Record<string, EncryptionRuleOp>>;
}

export function createEncryptionRulesRouter(
  operationIds: () => readonly string[],
  resolve: (op: string) => V1Target | undefined,
): Router {
  const router = Router();

  router.get(
    '/encryption-rules',
    handle(async (_req: Request, res: Response) => {
      const ruled = new Set(await getEncryptionProvider().getClientEncryptedMutators());
      const ops: Record<string, EncryptionRuleOp> = {};
      for (const op of operationIds()) {
        const target = resolve(op);
        if (target?.kind !== 'mutator' || !ruled.has(target.name)) continue;
        const mentionFields = Object.prototype.hasOwnProperty.call(MENTION_FIELDS, op) ? MENTION_FIELDS[op] : [];
        ops[op] = { mutator: target.name, mentionFields };
      }
      const body: EncryptionRulesResponse = { ops };
      res.set('Cache-Control', 'no-store');
      res.status(200).json(body);
    }),
  );

  return router;
}
