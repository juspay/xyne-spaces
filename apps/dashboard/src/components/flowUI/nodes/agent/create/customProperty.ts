export const CUSTOM_PROPERTY_TYPES = [
  'text',
  'number',
  'checkbox',
  'tags',
  'date',
  'datetime',
] as const;

export type CustomPropertyType = (typeof CUSTOM_PROPERTY_TYPES)[number];

export interface CustomProperty {
  id: string;
  type: CustomPropertyType;
  /** Visible row title. Local to the create canvas; not a form field key. */
  title: string;
  value: string;
}

export const CUSTOM_PROPERTY_LABEL: Record<CustomPropertyType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  tags: 'Tags',
  date: 'Date',
  datetime: 'Date with time',
};

/** Empty-state copy for custom property values. Checkbox has no placeholder. */
export const CUSTOM_PROPERTY_PLACEHOLDER: Record<
  Exclude<CustomPropertyType, 'checkbox'>,
  string
> = {
  text: 'Give instructions to your agent',
  number: 'Add a number',
  tags: 'Add tags',
  date: 'Add a date',
  datetime: 'Add a date and time',
};

/** Type-name titles are placeholders. They are not committed names. */
export function customPropertyTitleValue(title: string, type: CustomPropertyType): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed === CUSTOM_PROPERTY_LABEL[type]) return '';
  return trimmed;
}

export function createCustomProperty(type: CustomPropertyType): CustomProperty {
  return {
    id: `prop-${crypto.randomUUID()}`,
    type,
    title: '',
    value: type === 'checkbox' ? 'false' : '',
  };
}

let memoryClipboard = '';

export async function copyPropertyValue(value: string): Promise<void> {
  memoryClipboard = value;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Page clipboard is the fallback when the browser blocks clipboard access.
  }
}

export async function readPropertyValue(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    if (text.length > 0) return text;
  } catch {
    // Use the in-page copy when clipboard read is denied.
  }
  return memoryClipboard;
}
