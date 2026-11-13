/**
 * pause-form-schema — derive a JSON Schema from a pause/approval form.
 *
 * The SDK owns both the `PauseForm` shape and the `ResumePayload` it produces,
 * so the mapping from "the form the user fills in" to "the type of the submitted
 * values" lives here once, reusable by any step that surfaces a `PauseForm`
 * (today the WAIT step, via its `resolveOutputJsonSchema`). Form values are
 * submitted under `ResumePayload.data` keyed by each field's `name`, so the
 * returned schema is the shape of that `data` object.
 */
import type { PauseForm, PauseFormField } from '../types/pause-state.js';
import { attachmentProperty } from '../common/attachment.js';

/** Map a pause-form field type to the JSON Schema scalar kind of its value. */
export function jsonTypeForFormField(type: PauseFormField['type']): string {
  switch (type) {
    case 'number':
      return 'number';
    case 'checkbox':
      return 'boolean';
    // text / textarea / select all submit string values
    default:
      return 'string';
  }
}

/**
 * JSON Schema for the values submitted by a `PauseForm` — an object keyed by
 * each field's `name`. Left open (`additionalProperties: true`) since a host
 * may include extra keys beyond the declared fields.
 */
export function pauseFormToJsonSchema(form: PauseForm): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.type === 'attachment') {
      // Attachments aren't scalars — emit the canonical attachment schema (carries
      // `format:'attachment'`) so the submitted value (an Attachment ref / refs) is
      // typed and referenceable downstream like any other attachment.
      properties[field.name] = attachmentProperty({
        ...(field.multiple !== undefined ? { multiple: field.multiple } : {}),
        ...(field.accept !== undefined ? { accept: field.accept } : {}),
        ...(field.maxSize !== undefined ? { maxSize: field.maxSize } : {}),
        ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
      });
    } else {
      properties[field.name] = { type: jsonTypeForFormField(field.type), title: field.name };
    }
  }
  return { type: 'object', properties, additionalProperties: true };
}
