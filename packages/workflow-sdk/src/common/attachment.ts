import { z } from 'zod';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';

/**
 * Attachment — a claim check for a file the host's StorageAdapter holds.
 *
 * This is the only form in which a file travels through a workflow. Bytes are
 * never a value here: they live in the store, and what moves between steps,
 * into persisted state and across a resume is this handful of fields. That is
 * what keeps a run's memory cost independent of the size of what it handles.
 *
 * Used everywhere the framework carries a file:
 * - Trigger inputs (uploaded via `POST /uploads`, attached to `context.trigger.attachments`)
 * - Resume payloads (uploaded with feedback in a review-gate retry)
 * - Step inputs (rerunFromStep with attachments in configOverrides)
 *
 * The framework never opens `handle` — it is a host-defined reference (an
 * object key, a path, a signed token). Steps reach the bytes through
 * `ctx.files`, which streams by default and bounds the cases that cannot.
 */
export const AttachmentSchema = z.object({
  name: z.string().describe('Original filename — e.g. "contract.pdf"'),
  mimeType: z.string().describe('MIME type — e.g. "application/pdf", "image/png"'),
  handle: z.string().describe('Opaque host reference. Framework treats this as a string'),
  size: z.number().int().nonnegative().optional()
    .describe('Size in bytes, as the producer knew it. `ctx.files.info()` is authoritative'),
  hash: z.string().optional()
    .describe('Content hash, if the host computes one. For comparison and dedup; never interpreted'),
});

export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * The marker keyword that bridges the two schema worlds. zod→JSON conversion
 * drops custom `format`, so anywhere an attachment is exposed to the builder
 * (output schemas, marked input fields) carries `format: ATTACHMENT_FORMAT`.
 * The variable picker and the form renderer both key off it.
 */
export const ATTACHMENT_FORMAT = 'attachment';

/**
 * JSON Schema for a single Attachment — DERIVED from {@link AttachmentSchema}
 * (the single source of truth for the shape) plus the `format` marker. Deriving
 * rather than hand-writing keeps the JSON view from drifting from the Zod type.
 */
export const ATTACHMENT_JSON_SCHEMA: Record<string, unknown> = {
  ...zodToJsonSchemaRecord(AttachmentSchema),
  format: ATTACHMENT_FORMAT,
};

/** JSON Schema for an array of Attachments (the picker derives `attachment[]`). */
export const ATTACHMENT_ARRAY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: ATTACHMENT_JSON_SCHEMA,
};

/**
 * Runtime guard — is `value` an {@link Attachment} ref? Checks the three
 * required string fields. Used wherever a payload field is expected to carry a
 * file (trigger validation, router, UI).
 */
export function isAttachment(value: unknown): value is Attachment {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['name'] === 'string' &&
    typeof v['mimeType'] === 'string' &&
    typeof v['handle'] === 'string'
  );
}

/**
 * Does `mime` satisfy an accept-list? Supports exact (`application/pdf`),
 * wildcard subtype (`image/*`), and catch-all (`*` / `*​/*`). An empty/absent
 * list accepts anything.
 */
export function mimeAccepted(mime: string, accept: readonly string[] | undefined): boolean {
  if (!accept || accept.length === 0) return true;
  for (const a of accept) {
    if (a === '*' || a === '*/*' || a === mime) return true;
    if (a.endsWith('/*') && mime.startsWith(a.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Does `key` name an attachment *array* field in this schema?
 *
 * Decides whether a single uploaded file under that field arrives as one ref or
 * a one-element list, so a schema saying `items: attachment` never receives a
 * bare object. Shared by every inbound multipart path — a trigger's input
 * schema and a wait gate's payload contract ask the same question.
 */
export function isAttachmentArrayProperty(
  schema: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const props = schema?.['properties'];
  const prop =
    props !== null && typeof props === 'object' && !Array.isArray(props)
      ? (props as Record<string, Record<string, unknown>>)[key]
      : undefined;
  const items = prop?.['items'];
  return (
    prop?.['type'] === 'array' &&
    items !== null &&
    typeof items === 'object' &&
    !Array.isArray(items) &&
    (items as Record<string, unknown>)['format'] === ATTACHMENT_FORMAT
  );
}

/**
 * Build a JSON-Schema property for an attachment input — the single source of
 * truth for how an attachment field is shaped. `multiple` wraps it in an array.
 * `accept`/`maxSize` are per-file constraints; `minItems`/`maxItems` apply to
 * the array form. Authoring (InputSchemaBuilder) and tests both go through this.
 */
export function attachmentProperty(opts?: {
  multiple?: boolean;
  accept?: string[];
  maxSize?: number;
  minItems?: number;
  maxItems?: number;
}): Record<string, unknown> {
  const single: Record<string, unknown> = { ...ATTACHMENT_JSON_SCHEMA };
  if (opts?.accept) single['accept'] = opts.accept;
  if (opts?.maxSize !== undefined) single['maxSize'] = opts.maxSize;
  if (!opts?.multiple) return single;

  const arr: Record<string, unknown> = { type: 'array', items: single };
  if (opts.minItems !== undefined) arr['minItems'] = opts.minItems;
  if (opts.maxItems !== undefined) arr['maxItems'] = opts.maxItems;
  return arr;
}

/**
 * Stamp `format: 'attachment'` onto the named config-schema properties so the
 * builder treats them as attachment inputs (variable-only bind, filtered to
 * attachment refs). Call from a step/trigger's `decorateConfigSchema` instead
 * of hardcoding the marker per field — one consistent way to declare an
 * attachment input. Mutates and returns `jsonSchema`.
 *
 * Attachment inputs are typically declared with `variableRef(z.array(...))` so
 * they accept a `{{ref}}` binding; that converts to an `anyOf` union. The form
 * renderer unwraps the union and reads `format` from the *inner* (non-ref)
 * variant, so for those fields we stamp the inner schema (`anyOf[0]`, which is
 * always the wrapped type — see `variableRef`). Plain fields are stamped directly.
 */
export function markAttachmentFields(
  jsonSchema: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const props = jsonSchema['properties'] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!props) return jsonSchema;
  for (const field of fields) {
    const prop = props[field];
    if (!prop) continue;
    const variants = (prop['anyOf'] ?? prop['oneOf']) as
      | Record<string, unknown>[]
      | undefined;
    if (variants && variants[0]) {
      variants[0] = { ...variants[0], format: ATTACHMENT_FORMAT };
    } else {
      props[field] = { ...prop, format: ATTACHMENT_FORMAT };
    }
  }
  return jsonSchema;
}
