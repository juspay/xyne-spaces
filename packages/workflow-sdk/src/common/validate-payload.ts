import { ATTACHMENT_FORMAT, isAttachment, mimeAccepted } from './attachment.js';

/**
 * A single validation failure against a trigger's `inputSchema`. `path` is the
 * field name (top-level for now); `message` is human-readable.
 */
export interface PayloadError {
  path: string;
  message: string;
}

/**
 * Validate a manual-trigger payload against its `inputSchema` — the ONE place
 * payloads are checked, shared by the runtime (server, in `triggerManual`) and
 * the UI (client-side, before firing) so the rules never drift.
 *
 * Focuses on the constraints the framework actually enforces:
 * - **required** fields present (the schema's `required[]`),
 * - **attachment** fields (`format: 'attachment'`, single or array) carry real
 *   {@link Attachment} refs, satisfy `accept`/`maxSize`, and respect
 *   `minItems`/`maxItems` for the array form.
 *
 * Ordinary scalar fields are not deep-validated here (the form layer handles
 * those UI-side); this guards the file-handling invariants that make the
 * workflow runtime-safe.
 */
export function validateTriggerPayload(
  inputSchema: Record<string, unknown> | undefined,
  payload: Record<string, unknown>,
): PayloadError[] {
  const errors: PayloadError[] = [];
  if (!inputSchema || typeof inputSchema !== 'object') return errors;

  const props = inputSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
  if (!props) return errors;

  const required = new Set((inputSchema['required'] as string[] | undefined) ?? []);

  for (const [key, prop] of Object.entries(props)) {
    const value = payload[key];
    const missing = value === undefined || value === null;

    if (required.has(key) && missing) {
      errors.push({ path: key, message: `"${key}" is required` });
      continue;
    }
    if (missing) continue;

    const items = prop['items'] as Record<string, unknown> | undefined;
    const isAtt = prop['format'] === ATTACHMENT_FORMAT;
    const isAttArray = prop['type'] === 'array' && items?.['format'] === ATTACHMENT_FORMAT;

    if (isAtt) {
      validateOne(key, value, prop, errors);
    } else if (isAttArray) {
      if (!Array.isArray(value)) {
        errors.push({ path: key, message: `"${key}" must be a list of files` });
        continue;
      }
      const minItems = prop['minItems'] as number | undefined;
      const maxItems = prop['maxItems'] as number | undefined;
      if (minItems !== undefined && value.length < minItems) {
        errors.push({ path: key, message: `"${key}" requires at least ${String(minItems)} file(s)` });
      }
      if (maxItems !== undefined && value.length > maxItems) {
        errors.push({ path: key, message: `"${key}" allows at most ${String(maxItems)} file(s)` });
      }
      for (const entry of value) validateOne(key, entry, items ?? {}, errors);
    }
  }

  return errors;
}

/** Validate a single attachment value against a per-file schema (accept/maxSize). */
function validateOne(
  key: string,
  value: unknown,
  schema: Record<string, unknown>,
  errors: PayloadError[],
): void {
  if (!isAttachment(value)) {
    errors.push({ path: key, message: `"${key}" must be a file` });
    return;
  }
  const accept = schema['accept'] as string[] | undefined;
  if (accept && !mimeAccepted(value.mimeType, accept)) {
    errors.push({ path: key, message: `"${value.name}" (${value.mimeType}) is not an accepted type for "${key}"` });
  }
  const maxSize = schema['maxSize'] as number | undefined;
  if (maxSize !== undefined && value.size !== undefined && value.size > maxSize) {
    errors.push({ path: key, message: `"${value.name}" exceeds the max size for "${key}"` });
  }
}
