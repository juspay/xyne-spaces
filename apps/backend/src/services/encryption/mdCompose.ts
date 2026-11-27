import { UnreadableString, type ComposeInputs, type ComposeTemplate } from '@xyne/shared';

// Compose inputs from stored rows: the template is the only list of its inputs and of which are unreadable.

/** `value` as stored, sealed; null and undefined stay as they are. */
export function seal(value: string | null | undefined): UnreadableString | null | undefined {
  return value === null || value === undefined ? value : UnreadableString.make(value);
}

/** `template`'s inputs read from `row` (fields it lacks left out), the template's unreadable fields sealed. */
export function storedInputs<T extends ComposeTemplate>(template: T, row: object): ComposeInputs<T> {
  const values = row as Record<string, unknown>;
  const inputs: Record<string, unknown> = {};
  for (const field of Object.keys(template.inputs.shape)) {
    const value = values[field];
    if (value === undefined) continue;
    inputs[field] = template.unreadableFields.includes(field) ? seal(value as string | null) : value;
  }
  return inputs as ComposeInputs<T>;
}
