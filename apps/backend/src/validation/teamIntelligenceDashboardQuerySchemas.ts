import { z } from 'zod';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (value: string): boolean => {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isoDateQuery = (field: 'from' | 'to') =>
  z
    .string({ required_error: `"${field}" query parameter is required` })
    .refine(isValidIsoDate, `"${field}" must be a valid date in YYYY-MM-DD format`);

const positiveIntegerQuery = (field: string, defaultValue: number, maxValue: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined) return defaultValue;
      if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
      return value;
    },
    z
      .number({ invalid_type_error: `"${field}" must be a positive integer` })
      .int(`"${field}" must be a positive integer`)
      .min(1, `"${field}" must be at least 1`)
      .max(maxValue, `"${field}" must be at most ${maxValue}`)
  );

const dateRangeSchema = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      from: isoDateQuery('from'),
      to: isoDateQuery('to'),
      ...shape,
    })
    .refine(({ from, to }) => !from || !to || from <= to, {
      path: ['from'],
      message: '"from" must be before or equal to "to"',
    });

const teamIdQuery = z
  .string({ required_error: '"teamId" query parameter is required' })
  .trim()
  .min(1, '"teamId" query parameter is required');

const paginationShape = (defaultLimit: number, maxLimit: number) => ({
  page: positiveIntegerQuery('page', 1, Number.MAX_SAFE_INTEGER),
  limit: positiveIntegerQuery('limit', defaultLimit, maxLimit),
});

export const OrgDateRangeQuerySchema = dateRangeSchema({});
export const OrgLeadershipSectionQuerySchema = dateRangeSchema(paginationShape(12, 100));
export const OrgBulletsQuerySchema = dateRangeSchema(paginationShape(20, 200));
export const OrgChannelRecapsQuerySchema = dateRangeSchema(paginationShape(10, 200));

export const TeamDateRangeQuerySchema = dateRangeSchema({ teamId: teamIdQuery });
export const TeamLeadershipSectionQuerySchema = dateRangeSchema({
  teamId: teamIdQuery,
  ...paginationShape(12, 100),
});
export const TeamBulletsQuerySchema = dateRangeSchema({
  teamId: teamIdQuery,
  ...paginationShape(20, 200),
});
export const TeamChannelQuerySchema = dateRangeSchema({
  teamId: teamIdQuery,
  ...paginationShape(10, 200),
});
export const TeamPrQuerySchema = dateRangeSchema({
  prId: positiveIntegerQuery('prId', 1, Number.MAX_SAFE_INTEGER),
});

export const formatTeamIntelligenceQueryErrors = (error: z.ZodError) =>
  error.errors.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
