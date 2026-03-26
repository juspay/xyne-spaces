import { PrismaClient } from '@prisma/client';
import { logger, loggerContext } from '@/utils/logger';

const SENSITIVE_FIELDS = ['refreshToken', 'accessToken', 'fcmToken', 'voipToken'] as const;
const WRITE_OPERATIONS = ['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany'] as const;

type LoggableData = Record<string, unknown> | Record<string, unknown>[] | null | undefined;

type LogIdentifiers = {
  email: string;
  userId: string;
  sessionId: string;
};

function maskToken(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.substring(0, 6) + '****';
}

function maskSensitiveFields(data: LoggableData): LoggableData {
  if (!data) return null;

  if (Array.isArray(data)) {
    return data.map((item) => maskSensitiveFields(item) as Record<string, unknown>);
  }

  const masked = { ...data };
  for (const field of SENSITIVE_FIELDS) {
    if (field in masked && masked[field] !== undefined) {
      masked[field] = maskToken(masked[field] as string | null | undefined);
    }
  }
  return masked;
}

/**
 * Setup logging middleware for UserSession model operations.
 * Logs CREATE, CREATE_MANY, UPDATE, DELETE operations with requestId, sessionId, userId, email, and masked token values.
 */
export function setupUserSessionLogging(prisma: PrismaClient, enabled: boolean = true): void {
  if (!enabled) return;

  prisma.$use(async (params, next) => {
    const isUserSession = params.model === 'UserSession';
    const isWriteOperation = WRITE_OPERATIONS.includes(params.action as typeof WRITE_OPERATIONS[number]);

    if (!isUserSession || !isWriteOperation) {
      return next(params);
    }

    const context = loggerContext.getStore();
    const requestId = context?.requestId || 'background';
    const operation = params.action.toUpperCase();
    const result = await next(params);
    const affectedRows = getAffectedRows(params.action, result);
    const identifiers = await resolveLogIdentifiers(prisma, params.args?.data, params.args?.where, result, context?.email);

    if (params.action === 'delete' || params.action === 'deleteMany') {
      logDeleteOperation(
        requestId,
        identifiers.email,
        operation,
        params.args?.where,
        affectedRows,
        identifiers.userId,
        identifiers.sessionId,
      );
    } else if (params.args?.data) {
      logDataOperation(
        requestId,
        identifiers.email,
        operation,
        params.args.data,
        params.args.where,
        affectedRows,
        identifiers.userId,
        identifiers.sessionId,
      );
    }

    return result;
  });
}

function getAffectedRows(action: string, result: unknown): number | 'unknown' {
  if (action === 'createMany' || action === 'updateMany' || action === 'deleteMany') {
    if (result && typeof result === 'object' && 'count' in result && typeof result.count === 'number') {
      return result.count;
    }
    return 'unknown';
  }

  if (action === 'create' || action === 'update' || action === 'delete') {
    return 1;
  }

  return 'unknown';
}

function getStringField(source: unknown, field: string): string | undefined {
  if (!source || typeof source !== 'object' || !(field in source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function getFirstDataRow(data: LoggableData): Record<string, unknown> | undefined {
  if (!data) return undefined;
  if (Array.isArray(data)) {
    return data[0];
  }
  return data;
}

async function resolveLogIdentifiers(
  prisma: PrismaClient,
  data: LoggableData,
  where: Record<string, unknown> | undefined,
  result: unknown,
  contextEmail?: string,
): Promise<LogIdentifiers> {
  const firstDataRow = getFirstDataRow(data);

  const sessionId =
    getStringField(where, 'id') ||
    getStringField(firstDataRow, 'id') ||
    getStringField(result, 'id') ||
    'multiple';

  const userId =
    getStringField(firstDataRow, 'userId') ||
    getStringField(where, 'userId') ||
    getStringField(result, 'userId') ||
    'unknown';

  let email = contextEmail || getStringField((result as { user?: unknown } | undefined)?.user, 'email') || 'unknown';

  if (email === 'unknown' && userId !== 'unknown') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    email = user?.email || 'unknown';
  }

  return { email, userId, sessionId };
}

function logDeleteOperation(
  requestId: string,
  email: string,
  operation: string,
  where: Record<string, unknown> = {},
  affectedRows: number | 'unknown' = 'unknown',
  userId: string = 'unknown',
  sessionId: string = 'multiple',
): void {
  logger.info('UserSession operation', {
    module: 'UserSessionLogging',
    timestamp: new Date().toISOString(),
    requestId,
    email,
    operation,
    model: 'UserSession',
    sessionId,
    userId,
    affectedRows,
    changes: { deleted: true, criteria: where },
  });
}

function logDataOperation(
  requestId: string,
  email: string,
  operation: string,
  data: LoggableData,
  where: Record<string, unknown> = {},
  affectedRows: number | 'unknown' = 'unknown',
  userId: string = 'unknown',
  sessionId: string = 'new',
): void {
  const maskedData = maskSensitiveFields(data);

  logger.info('UserSession operation', {
    module: 'UserSessionLogging',
    timestamp: new Date().toISOString(),
    requestId,
    email,
    operation,
    model: 'UserSession',
    sessionId,
    userId,
    affectedRows,
    changes: maskedData,
    criteria: where,
  });
}
