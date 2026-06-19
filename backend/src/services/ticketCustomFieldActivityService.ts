import { ActivityType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

const formatCustomFieldValue = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const normalized = value
      .map(item => formatCustomFieldValue(item))
      .filter((item): item is string => Boolean(item));
    return normalized.length > 0 ? normalized.join(', ') : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const serialized = JSON.stringify(value);
  return serialized && serialized !== '{}' ? serialized : null;
};

export async function createTicketCustomFieldActivity(params: {
  ticketId: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  updatedBy: string;
  timestamp?: Date;
}): Promise<void> {
  const { ticketId, fieldName, oldValue, newValue, updatedBy, timestamp } = params;
  const normalizedOldValue = formatCustomFieldValue(oldValue);
  const normalizedNewValue = formatCustomFieldValue(newValue);

  if (normalizedOldValue === normalizedNewValue) {
    return;
  }

  await prisma.ticketActivity.create({
    data: {
      ticketId,
      updatedBy,
      timestamp,
      activityType: ActivityType.METADATA,
      value: {
        field: 'customField',
        fieldName,
        oldValue: normalizedOldValue,
        newValue: normalizedNewValue,
      },
    },
  });
}
