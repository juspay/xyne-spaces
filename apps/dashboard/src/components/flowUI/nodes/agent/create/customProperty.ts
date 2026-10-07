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
  text: 'Add text',
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

/** A tags value's tags. Stored as "billing, refunds"; blanks and repeats drop out. */
export function splitTags(value: string): string[] {
  return mergeTags([], value.split(','));
}

/** The stored form of a tag list. */
export function joinTags(tags: readonly string[]): string {
  return tags.join(', ');
}

/** Tags typed or pasted into the field: a space or comma ends each one. */
export function tagsFromText(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

/** `tags` plus `added`, trimmed, keeping the first of any that match ignoring case. */
export function mergeTags(tags: readonly string[], added: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...tags, ...added].flatMap(raw => {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });
}

/** Whether the row holds a value. An unticked checkbox is its empty state. */
export function propertyHasValue(property: Pick<CustomProperty, 'type' | 'value'>): boolean {
  if (property.type === 'checkbox') return property.value === 'true';
  return property.value.trim().length > 0;
}

export function createCustomProperty(type: CustomPropertyType): CustomProperty {
  return {
    id: `prop-${crypto.randomUUID()}`,
    type,
    title: '',
    value: type === 'checkbox' ? 'false' : '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stored (or chat-supplied) rows, dropping anything that isn't a well-formed property. */
export function parseCustomProperties(value: unknown): CustomProperty[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): CustomProperty[] => {
    if (!isRecord(row)) return [];
    const type = row['type'];
    if (!CUSTOM_PROPERTY_TYPES.includes(type as CustomPropertyType)) return [];
    return [
      {
        id: typeof row['id'] === 'string' && row['id'] ? row['id'] : `prop-${crypto.randomUUID()}`,
        type: type as CustomPropertyType,
        title: typeof row['title'] === 'string' ? row['title'] : '',
        value: typeof row['value'] === 'string' ? row['value'] : '',
      },
    ];
  });
}

/** How a property reads in the saved instructions, or null when it says nothing yet. */
export function customPropertyPromptLine(property: CustomProperty): string | null {
  const title = property.title.trim() || CUSTOM_PROPERTY_LABEL[property.type];
  const raw = property.value.trim();
  if (property.type === 'checkbox') return `${title}: ${raw === 'true' ? 'Yes' : 'No'}`;
  if (!raw) return null;
  const value = property.type === 'datetime' ? raw.replace('T', ' ') : raw;
  return `${title}: ${value}`;
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
