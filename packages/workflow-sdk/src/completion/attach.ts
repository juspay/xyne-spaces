/**
 * Folding a multipart delivery's files into its payload.
 *
 * Pure, because the files are already stored by the time anything here runs:
 * the whole merge — field grouping, the single-versus-list decision, a field
 * the contract never declared — is a table test, the same way
 * {@link resolveGate} is.
 */

import { isAttachmentArrayProperty } from '../common/attachment.js';
import type { Attachment } from '../common/attachment.js';
import type { DeliveryFile } from './types.js';
import { addMultipartValue } from '../common/multipart-values.js';

/**
 * The payload a gate's contract will be checked against: the request's text
 * fields plus every stored file under its own field name.
 *
 * `contract` only settles arity — a field it declares as a list of attachments
 * gets a list even when one file arrived. A file under a field the contract
 * never mentions is merged anyway and left for the contract check to reject,
 * which says `invalid` with the field named instead of silently dropping it.
 */
export function attachDeliveryFiles(
  payload: unknown,
  files: readonly DeliveryFile[],
  contract: Record<string, unknown> | undefined,
): unknown {
  if (files.length === 0) return payload;

  const merged: Record<string, unknown> =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : {};

  const byField = new Map<string, Attachment[]>();
  for (const file of files) {
    byField.set(file.fieldName, [...(byField.get(file.fieldName) ?? []), file.attachment]);
  }

  for (const [field, attachments] of byField) {
    addMultipartValue(
      merged,
      field,
      isAttachmentArrayProperty(contract, field) || attachments.length > 1
        ? attachments
        : attachments[0],
    );
  }
  return merged;
}
