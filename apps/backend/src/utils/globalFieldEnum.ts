import type { Prisma } from '@prisma/client';

export const parseGlobalFieldEnum = (value: unknown): Prisma.JsonValue | null => {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : null;
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
