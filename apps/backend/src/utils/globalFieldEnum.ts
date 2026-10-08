import type { Prisma } from '@prisma/client';

// Valid entries: plain string options or canonical {id,value} option objects (§1.4 R2 legacy shape).
const isValidEnumEntry = (item: unknown): boolean => {
  if (typeof item === 'string') {
    return true;
  }
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.value === 'string';
  }
  return false;
};

export const parseGlobalFieldEnum = (value: unknown): Prisma.JsonValue | null => {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.filter(isValidEnumEntry);
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isValidEnumEntry) : null;
  } catch {
    return null;
  }
};

export const serializeGlobalFieldEnum = (
  value: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
};
