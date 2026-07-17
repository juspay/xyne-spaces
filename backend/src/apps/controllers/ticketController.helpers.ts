import { FormFieldType, Prisma } from '@prisma/client';
import { parseFieldOptionValues } from '@xyne/shared';

type CustomFieldDefinition = {
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum: Prisma.JsonValue | null;
};

type TicketInfoRecord = {
  id: string;
  boardId: string;
};

type TicketInfoDependencies<TTicket extends TicketInfoRecord, TCustomFormData, THistory> = {
  getTicketByIdentifier: (identifier: string, workspaceId: string) => Promise<TTicket | null>;
  getTicketCustomFormData: (ticketId: string, boardId: string) => Promise<TCustomFormData>;
  getTicketHistory: (ticketId: string, limit: number) => Promise<THistory>;
};

export const normalizeCustomFieldValue = (
  field: CustomFieldDefinition,
  rawValue: unknown,
): { actualFieldValue: Prisma.InputJsonValue; fieldValue: string } => {
  switch (field.fieldType) {
    case FormFieldType.STRING: {
      if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
        throw new Error(`Field "${field.fieldName}" must be a non-empty string`);
      }

      const value = rawValue.trim();
      return { actualFieldValue: value, fieldValue: value };
    }

    case FormFieldType.USER: {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const normalizedValues = values
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean);

      if (normalizedValues.length === 0) {
        throw new Error(
          `Field "${field.fieldName}" must be a user ID string or array of user ID strings`,
        );
      }

      const dedupedValues = Array.from(new Set(normalizedValues));
      return { actualFieldValue: dedupedValues, fieldValue: dedupedValues.join(',') };
    }

    case FormFieldType.NUMBER: {
      const numericValue =
        typeof rawValue === 'number'
          ? rawValue
          : typeof rawValue === 'string' && rawValue.trim().length > 0
            ? Number(rawValue)
            : Number.NaN;

      if (!Number.isFinite(numericValue)) {
        throw new Error(`Field "${field.fieldName}" must be a valid number`);
      }

      return { actualFieldValue: numericValue, fieldValue: String(numericValue) };
    }

    case FormFieldType.BOOLEAN: {
      if (typeof rawValue === 'boolean') {
        return { actualFieldValue: rawValue, fieldValue: String(rawValue) };
      }

      if (typeof rawValue === 'string') {
        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'true' || normalized === 'false') {
          const boolValue = normalized === 'true';
          return { actualFieldValue: boolValue, fieldValue: String(boolValue) };
        }
      }

      throw new Error(`Field "${field.fieldName}" must be a boolean`);
    }

    case FormFieldType.DATE: {
      const dateValue =
        rawValue instanceof Date
          ? rawValue
          : typeof rawValue === 'string' || typeof rawValue === 'number'
            ? new Date(rawValue)
            : null;

      if (!dateValue || Number.isNaN(dateValue.getTime())) {
        throw new Error(`Field "${field.fieldName}" must be a valid date`);
      }

      const isoValue = dateValue.toISOString();
      return { actualFieldValue: isoValue, fieldValue: isoValue };
    }

    case FormFieldType.SINGLE_SELECT: {
      if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
        throw new Error(`Field "${field.fieldName}" must be a non-empty string`);
      }

      const value = rawValue.trim();
      const options = parseFieldOptionValues(field.fieldEnum);
      if (options.length > 0 && !options.includes(value)) {
        throw new Error(`Field "${field.fieldName}" must be one of: ${options.join(', ')}`);
      }

      return { actualFieldValue: value, fieldValue: value };
    }

    case FormFieldType.MULTI_SELECT: {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const normalizedValues = values
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean);

      if (normalizedValues.length === 0) {
        throw new Error(`Field "${field.fieldName}" must be a non-empty array of strings`);
      }

      const options = parseFieldOptionValues(field.fieldEnum);
      if (options.length > 0) {
        const invalidValues = normalizedValues.filter(value => !options.includes(value));
        if (invalidValues.length > 0) {
          throw new Error(
            `Field "${field.fieldName}" has invalid values: ${invalidValues.join(', ')}. Allowed values: ${options.join(', ')}`,
          );
        }
      }

      const dedupedValues = Array.from(new Set(normalizedValues));
      return { actualFieldValue: dedupedValues, fieldValue: dedupedValues.join(',') };
    }

    default:
      throw new Error(`Unsupported field type for "${field.fieldName}"`);
  }
};

export const normalizeHistoryLimit = (historyLimit: unknown): number => {
  const parsedHistoryLimit =
    typeof historyLimit === 'number'
      ? historyLimit
      : typeof historyLimit === 'string'
        ? Number(historyLimit)
        : Number.NaN;

  return Number.isFinite(parsedHistoryLimit) && parsedHistoryLimit > 0
    ? Math.min(Math.floor(parsedHistoryLimit), 200)
    : 100;
};

export const fetchTicketInfoByIdentifier = async <
  TTicket extends TicketInfoRecord,
  TCustomFormData,
  THistory,
>(
  params: {
    identifier: string;
    workspaceId: string;
    historyLimit: number;
  },
  deps: TicketInfoDependencies<TTicket, TCustomFormData, THistory>,
): Promise<{ ticket: TTicket; customFormData: TCustomFormData; history: THistory } | null> => {
  const ticket = await deps.getTicketByIdentifier(params.identifier, params.workspaceId);
  if (!ticket) {
    return null;
  }

  const [customFormData, history] = await Promise.all([
    deps.getTicketCustomFormData(ticket.id, ticket.boardId),
    deps.getTicketHistory(ticket.id, params.historyLimit),
  ]);

  return { ticket, customFormData, history };
};
