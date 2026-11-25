import type { Request } from 'express';
import { deriveFactsFromPlaintext, derivedNames, makeUnreadable, runExtractors } from '@xyne/shared';
import type { ExtractorName, FieldFacts, RequestContract } from '@xyne/shared';

/**
 * Brings a contract route's request to the shape its handler reads: facts for every source
 * field that carried text, and the contract's `unreadableString()` fields wrapped. Facts the
 * encryption service extracted (ciphertext fields) are kept; a field that arrived as plaintext
 * gets the same facts derived here, before it is wrapped. So the handler decides on facts
 * either way and never reads the text: the REST counterpart of `deriveLocally` for mutators.
 *
 * Safe to run twice: a second call finds the fields wrapped, so it derives and wraps nothing.
 */
export function makeRequestUnreadable(contract: RequestContract, req: Request): void {
  if (!req.body || typeof req.body !== 'object') return;
  const names = derivedNames(contract);
  // Skips ciphertext and anything that is not a non-empty string (already wrapped, absent).
  const fields: Record<string, FieldFacts> = { ...deriveFactsFromPlaintext(req.body, names)?.fields };
  // An empty string is text too: it gets facts (empty, length 0) like any other, so a handler
  // never has to look at a field to tell "empty" from "facts missing".
  for (const [field, factNames] of Object.entries(names)) {
    if ((req.body as Record<string, unknown>)[field] === '' && factNames.length > 0) {
      fields[field] = runExtractors('', factNames as ExtractorName[]);
    }
  }
  if (Object.keys(fields).length > 0) {
    req.derived = { version: 2, fields: { ...fields, ...req.derived?.fields } };
  }
  if (contract.unreadableFields.length > 0) {
    req.body = makeUnreadable(contract, req.body);
  }
}
