import { mustGetQuery, mustGetMutator, type AnyCustomQuery } from '@rocicorp/zero';
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server';
import { zeroNodePg } from '@rocicorp/zero/server/adapters/pg';
// Zero internal APIs for fallback system (mapped via #imports in package.json)
import { asQueryInternals } from '#zero-internal/query-internals';
import { executePostgresQuery } from '#zero-internal/pg-query-executor';
import { getServerSchema } from '#zero-internal/schema';
import { compile, extractZqlResult } from '#zero-internal/compiler';
import { formatPgInternalConvert } from '#zero-internal/sql';
import { Pool } from 'pg';
import { Context, schema } from '@xyne/shared';
import { AuthData, createMutators } from './mutators';
import { queries } from './queries';
import jwt from 'jsonwebtoken';
import { logger } from '@/utils/logger';
import { getZeroMutationLatency, getZeroMutationOperations, getZeroQueryLatency, getZeroQueryOperations } from '@/services/otel';
import {
  createVespaJobsAccumulator,
  VespaJobsAccumulator,
} from './vespa-injection';
import {
  createSideEffectJobsAccumulator,
  processSideEffectJobs,
  SideEffectJobsAccumulator,
} from './side-effects';
import { vespaQueue } from '@/queues/vespaQueue';
import { db } from '@/database/client';
import { DatabaseClient } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { VespaOperationType } from './vespa-injection/core/mapper';
import { wrapTransactionWithACL } from './acl';
import { config } from '@/config/env';
import { checkRateLimit } from '@/services/zeroRateLimiter';
import { superpositionClient } from '@/services/superpositionClient';

const mustGetBackendQuery = (name: string): AnyCustomQuery =>
  mustGetQuery(queries as never, name) as AnyCustomQuery;

const ZERO_DISABLED_QUERIES_KEY = 'zero_disabled_queries';

const parseDisabledQueries = (raw: string): Set<string> =>
  new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  );

const isQueryDisabled = async (name: string): Promise<boolean> => {
  try {
    const raw = await superpositionClient.getStringValue(ZERO_DISABLED_QUERIES_KEY, '', {});
    return parseDisabledQueries(raw).has(name);
  } catch (error) {
    logger.error('Failed to read disabled queries from superposition', { error });
    return false;
  }
};

// Create database connection pool
const isDev = process.env['NODE_ENV'] === 'development';
const pool = new Pool({
  connectionString: process.env['ZERO_UPSTREAM_DB'] as string,
  ...((!isDev && !config.isTestEnv) && { ssl: { rejectUnauthorized: false } }),
});

export const dbProvider = zeroNodePg(schema, pool);

const replicaPool = config.database.readReplicaPoolUrl
  ? new Pool({
      connectionString: config.database.readReplicaPoolUrl,
      ...((!isDev && !config.isTestEnv) && { ssl: { rejectUnauthorized: false } }),
    })
  : null;

export const replicaDbProvider = replicaPool
  ? zeroNodePg(schema, replicaPool) as typeof dbProvider
  : null;

if (replicaDbProvider) {
  logger.info('Initialized read replica pool for fallback queries');
}

let serverSchemaCache: any | null = null;

async function fetchServerSchema(): Promise<any> {
  if (!serverSchemaCache) {
    serverSchemaCache = await dbProvider.transaction(async (tx) => {
      return await getServerSchema(tx.dbTransaction, schema);
    });
  }
  return serverSchemaCache;
}

export async function extractAuthDataFromJWT(encodedJWT?: string): Promise<AuthData | undefined> {
  if (!encodedJWT) {
    return undefined;
  }

  try {
    const secret = process.env['JWT_SECRET'];
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    const decoded = jwt.verify(encodedJWT, secret, {
      issuer: 'xyne',
      audience: 'xyne-user',
    }) as AuthData & { iat?: number };

    const forceLogoutBefore = config.jwt.forceLogoutBefore;
    if (forceLogoutBefore && decoded.iat && decoded.iat < forceLogoutBefore) {
      logger.warn('JWT rejected: issued before force logout timestamp', {
        iat: decoded.iat,
        forceLogoutBefore,
      });
      return undefined;
    }

    const [user, orgMember] = await Promise.all([
      db.user.findUnique({
        where: { id: decoded.sub },
        select: { role: true, displayName: true },
      }),
      db.orgMember.findUnique({
        where: { memberId: decoded.memberId },
        select: { role: true },
      }),
    ]);
  
    // If JWT is valid but DB records missing, that's a data inconsistency - fail fast
    if (!user || !orgMember) {
      logger.error('Auth data inconsistency: JWT valid but DB records missing', {
        userId: decoded.sub,
        memberId: decoded.memberId,
        userExists: !!user,
        orgMemberExists: !!orgMember,
      });
      throw new Error('User authentication data inconsistent');
    }

    return {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      displayName: user.displayName,
      workspaceId: decoded.workspaceId,
      memberId: decoded.memberId,
      role: user.role,
      orgRole: orgMember.role,
    } as AuthData;
    
  } catch (error) {
    logger.error('JWT verification failed:', error);
    return undefined;
  }
}

export async function extractAuthDataFromRequest(request: Request): Promise<AuthData | undefined> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.substring(7);
  return await extractAuthDataFromJWT(token);
}

function getMutationErrors(result: unknown): Record<string, unknown>[] {
  if (!result || typeof result !== 'object' || !('mutations' in result)) {
    return [];
  }

  const mutations = (result as { mutations?: unknown }).mutations;
  if (!Array.isArray(mutations)) {
    return [];
  }

  return mutations.flatMap((mutation) => {
    if (!mutation || typeof mutation !== 'object' || !('result' in mutation)) {
      return [];
    }

    const mutationResult = (mutation as { result?: unknown }).result;
    if (
      mutationResult &&
      typeof mutationResult === 'object' &&
      'error' in mutationResult
    ) {
      return [mutationResult as Record<string, unknown>];
    }

    return [];
  });
}

function getMutationErrorMessage(errorObj: Record<string, unknown>): unknown {
  return errorObj['message'] || errorObj['details'] || errorObj['error'];
}

export async function handleMutate(request: Request): Promise<unknown> {
  const startTime = Date.now();
  // Accumulators for post-processing
  const asyncTasks: (() => Promise<void>)[] = [];
  const awaitedPostCommitTasks: (() => Promise<void>)[] = [];
  let vespaJobs: VespaJobsAccumulator = [];
  let sideEffectJobs: SideEffectJobsAccumulator = [];
  let capturedMutatorName: string | null = null;

  const authData = await extractAuthDataFromRequest(request);

  if (!authData) {
    throw new Error("Unauthorized")
  }

  // Clone the request so the body can be read again by handleMutateRequest
  const clonedRequest = request.clone();
  let batchSize = 1;
  try {
    const body = await clonedRequest.json() as { mutations?: unknown[] };
    if (body.mutations && Array.isArray(body.mutations)) {
      batchSize = Math.max(1, body.mutations.length);
    }
  } catch {
    // If body parsing fails, fall back to counting as 1
  }

  const isAllowed = await checkRateLimit("mutate", authData.sub, batchSize);
  if (!isAllowed) {
    logger.warn('zero_mutation_rate_limited', {
      latency: Date.now() - startTime,
      userId: authData.sub,
      workspaceId: authData.workspaceId,
      batchSize,
    });
    throw new Error("Rate limit exceeded");
  }

  vespaJobs = createVespaJobsAccumulator();
  sideEffectJobs = createSideEffectJobsAccumulator();

  try {
    const context = {
      userID: authData.sub,
      workspaceId: authData.workspaceId,
      role: authData.role,
      orgRole: authData.orgRole,
      memberId: authData.memberId,
    };
    const result = await handleMutateRequest({
      dbProvider,
      userID: authData.sub,
      request,
      handler: transact => {
        const mutationAsyncTasks: (() => Promise<void>)[] = [];
        const mutationAwaitedPostCommitTasks: (() => Promise<void>)[] = [];
        const mutationVespaJobs = createVespaJobsAccumulator();
        const mutationSideEffectJobs = createSideEffectJobsAccumulator();

        return transact(async (tx, mutatorName, args) => {
          capturedMutatorName = mutatorName;
          const mutators = createMutators(
            authData,
            mutationAsyncTasks,
            mutationAwaitedPostCommitTasks,
          );
          const wrappedTx = wrapTransactionWithACL(
            tx,
            context,
            mutationVespaJobs,
            mutationSideEffectJobs,
            mutatorName,
          );
          const mutator = mustGetMutator(mutators, mutatorName);
          return mutator.fn({ tx: wrappedTx, args, ctx: context });
        }).then((mutatorResult) => {
          // Zero resolves application failures as mutation results after rolling
          // back the transaction. Do not dispatch work staged by that rollback.
          if (!('error' in mutatorResult.result)) {
            asyncTasks.push(...mutationAsyncTasks);
            awaitedPostCommitTasks.push(...mutationAwaitedPostCommitTasks);
            vespaJobs.push(...mutationVespaJobs);
            sideEffectJobs.push(...mutationSideEffectJobs);
          }

          return mutatorResult;
        });
      },
    });

    const latency = Date.now() - startTime;
    const mutationErrors = getMutationErrors(result);
    getZeroMutationLatency().record(latency, { mutation: capturedMutatorName || 'unknown' });

    if (mutationErrors.length > 0) {
      getZeroMutationOperations().add(1, { mutation: capturedMutatorName || 'unknown', stage: 'error' });

      for (const errorObj of mutationErrors) {
        logger.error('zero_mutation_error', {
          latency,
          mutation: capturedMutatorName,
          error: getMutationErrorMessage(errorObj),
        });
      }
    } else {
      getZeroMutationOperations().add(1, { mutation: capturedMutatorName || 'unknown', stage: 'success' });

      logger.info('zero_mutation_success', {
        latency,
        mutation: capturedMutatorName,
      });
    }

    await Promise.allSettled(awaitedPostCommitTasks.map(task => task()));
    Promise.allSettled(asyncTasks.map((task) => task()));

    Promise.allSettled(
      vespaJobs.map(async (job) => {
        try {
          await vespaQueue.addJob({
            schema: job.schema,
            jobType: job.jobType,
            docId: job.docId,
            userId: authData!.sub,
            workspaceId: authData!.workspaceId,
            ...(job.app ? { app: job.app } : {}),
            ...(job.jobType === "update" ? { data: job.data } : {})
          });
        } catch (err) {
          try {
            await db.vespaInsertionLogs.create({
              data: {
                status: "FAILED",
                type: VespaOperationType[job.jobType],
                entityId: job.docId,
                entityType: job.schema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue a job ${JSON.stringify(err)}`,
                errorDetails: JSON.stringify(err),
                userId: authData!.sub,
                workspaceId: authData!.workspaceId,
                createdAt: new Date(),
              },
            });
          } catch (dbError) {
            logger.error(`Failed to log insertion error to database:
              ${dbError instanceof Error ? dbError.message : String(dbError)}`);
          }
        }
      })
    )
    // Side-effect handlers run on the Zero server, which has NO tenantScopeMiddleware and writes via
    // Prisma db.* (not tx.mutate, so the Zero stamp misses them too). Open a Prisma tenant context
    // from authData.workspaceId so the stamp fills workspaceId on every side-effect create (message,
    // conversation, ticketActivity, …). Fire-and-forget is fine — AsyncLocalStorage propagates to the
    // async chain scheduled inside the callback.
    // Runs as the requesting user so handler ACLs stay in force; the workspace-wide fan-outs
    // inside elevate themselves via withWorkspaceScope.
    void runWithContext(
      {
        userId: authData.sub,
        workspaceId: authData.workspaceId,
        role: authData.role,
        orgRole: authData.orgRole,
        memberId: authData.memberId,
      },
      () => processSideEffectJobs(sideEffectJobs, context),
    );

    return result;
  } catch (error) {
    const latency = Date.now() - startTime;
    getZeroMutationLatency().record(latency, { mutation: capturedMutatorName || 'unknown' });
    getZeroMutationOperations().add(1, { mutation: capturedMutatorName || 'unknown', stage: 'error' });

    logger.error('zero_mutation_error', {
      latency,
      mutation: capturedMutatorName,
      error: error,
    });

    throw error;
  }
}

export async function handleQueries(request: Request): Promise<any> {
  const startTime = Date.now();
  let capturedQueryName: string | null = null;

  const authData = await extractAuthDataFromRequest(request);
  if (!authData) {
    throw new Error("Unauthorized")
  }

  const isAllowed = await checkRateLimit("query", authData.sub);
  if (!isAllowed) {
    throw new Error("Rate limit exceeded");
  }

  try {
    const result = await handleQueryRequest(
      // zero's QueryRequestHandler type is sync-only but the runtime awaits the
      // handler result, so returning a promise (typed as any) is safe.
      (queryName, args): any =>
        (async () => {
          capturedQueryName = queryName;
          if (await isQueryDisabled(queryName)) {
            getZeroQueryOperations().add(1, { query: queryName, stage: 'disabled' });
            logger.warn('zero_query_disabled', { query: queryName });
            throw new Error(`Query '${queryName}' is disabled`);
          }
          const query = mustGetBackendQuery(queryName);
          const context: Context = { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId };
          return query.fn({ args, ctx: context });
        })(),
      schema,
      request
    );

    const latency = Date.now() - startTime;
    getZeroQueryLatency().record(latency, { query: capturedQueryName || 'unknown' });
    getZeroQueryOperations().add(1, { query: capturedQueryName || 'unknown', stage: 'success' });

    logger.info('zero_query_success', {
      latency,
      query: capturedQueryName,
    });

    return result;
  } catch (error) {
    const latency = Date.now() - startTime;
    getZeroQueryLatency().record(latency, { query: capturedQueryName || 'unknown' });
    getZeroQueryOperations().add(1, { query: capturedQueryName || 'unknown', stage: 'error' });
    logger.error('zero_query_error', {
      latency,
      query: capturedQueryName,
      error: error,
    });

    throw error;
  }
}

type ZeroResultFormat = {
  singular?: boolean;
  relationships?: Record<string, ZeroResultFormat>;
};

function conformToZeroShape(node: unknown, format: ZeroResultFormat | undefined): void {
  if (!node || !format?.relationships) return;
  if (Array.isArray(node)) {
    for (const item of node) conformToZeroShape(item, format);
    return;
  }
  if (typeof node !== 'object') return;
  const row = node as Record<string, unknown>;
  for (const [alias, childFormat] of Object.entries(format.relationships)) {
    const value = row[alias];
    if (value === null || value === undefined) {
      if (childFormat.singular) delete row[alias];
      continue;
    }
    conformToZeroShape(value, childFormat);
  }
}

export async function handleQueriesFallback(request: Request): Promise<any> {
  const authData = await extractAuthDataFromRequest(request);
  if (!authData) {
    throw new Error("Unauthorized");
  }

  const context: Context = { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, memberId: authData.memberId, orgRole: authData.orgRole };

  try {
    const body = await request.json();
    const { queries: queryRequests } = body as {
      queries: Array<{ name: string; args?: any }>;
    };

    logger.info(`Fallback executing ${queryRequests.length} queries from read replica pool`);

    if (!replicaDbProvider) {
      throw new Error('Read replica pool not configured. Set DATABASE_READ_REPLICA_POOL_URL environment variable.');
    }

    const serverSchema = await fetchServerSchema();

    const results = await Promise.all(
      queryRequests.map(async (req) => {
        try {
          const queryDef = mustGetBackendQuery(req.name);
          const query = queryDef.fn({
            args: req.args || {},
            ctx: context,
          });

          // @ts-ignore - asQueryInternals works with any Query type at runtime
          const { ast, format } = asQueryInternals(query);

          logger.debug(`Executing fallback query: ${req.name}`);

          const data = await replicaDbProvider.transaction(async (tx) => {
            return await executePostgresQuery(
              tx.dbTransaction,
              ast,
              format,
              schema,
              serverSchema
            );
          });

          conformToZeroShape(data, format as ZeroResultFormat);

          return {
            name: req.name,
            data,
          };
        } catch (error) {
          logger.error(`Fallback query ${req.name} failed:`, error);
          throw error;
        }
      })
    );

    return { results };
  } catch (error) {
    logger.error('Fallback query request failed:', error);
    throw error;
  }
}

export async function handleQueriesZqlToSql(request: Request): Promise<any> {
  const authData = await extractAuthDataFromRequest(request);
  if (!authData) {
    throw new Error("Unauthorized");
  }

  const context: Context = { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, memberId: authData.memberId, orgRole: authData.orgRole };

  try {
    const body = await request.json();
    const { queries: queryRequests } = body as {
      queries: Array<{ name: string; args?: any }>;  
    };

    logger.info(`ZQL-to-SQL executing ${queryRequests.length} queries`);

    const serverSchema = await fetchServerSchema();
    const prisma = DatabaseClient.getInstance();

    const results = await Promise.all(
      queryRequests.map(async (req) => {
        try {
          const queryDef = mustGetBackendQuery(req.name);
          const query = queryDef.fn({
            args: req.args || {},
            ctx: context,
          });

          // Extract AST and Format from ZQL query
          // @ts-ignore - asQueryInternals works with any Query type at runtime
          const { ast, format } = asQueryInternals(query);

          logger.info(`Converting ZQL to SQL: ${req.name}`);

          // Use z2s to compile ZQL → SQL
          const compiledOutput = compile(serverSchema, schema, ast, format);
          const sqlQuery = formatPgInternalConvert(
            compiledOutput
          );

          logger.info(`Executing SQL via Prisma:`, sqlQuery.text);

          // Execute via Prisma
          const pgResult = await prisma.$queryRawUnsafe(
            sqlQuery.text,
            ...sqlQuery.values
          );

          // Handle empty results for singular queries
          const pgArrayResult = Array.isArray(pgResult) ? pgResult : [pgResult];
          if (pgArrayResult.length === 0 && format.singular) {
            return {
              name: req.name,
              data: undefined,
            };
          }

          // Extract ZQL result from JSON-wrapped response
          const data = extractZqlResult(pgArrayResult);

          logger.info(`Converting ZQL to SQL: ${req.name}`);
          logger.info('Full SQL query:', sqlQuery.text);
          logger.info('SQL length:', sqlQuery.text.length);
          logger.info('Values:', sqlQuery.values);

          return {
            name: req.name,
            data,
          };
        } catch (error) {
          logger.error(`ZQL-to-SQL query ${req.name} failed`, error);
          throw error;
        }
      })
    );

    return { results };
  } catch (error) {
    logger.error('ZQL-to-SQL request failed', error);
    throw error;
  }
}

export async function handleMutateFallback(request: Request): Promise<unknown> {
  const authData = await extractAuthDataFromRequest(request);
  if (!authData) {
    throw new Error("Unauthorized");
  }

  const asyncTasks: (() => Promise<void>)[] = [];
  const awaitedPostCommitTasks: (() => Promise<void>)[] = [];
  const vespaJobs: VespaJobsAccumulator = createVespaJobsAccumulator();
  const sideEffectJobs: SideEffectJobsAccumulator = createSideEffectJobsAccumulator();

  try {
    const mutation = await request.json() as {
      name: string;
      args: any;
    };

    logger.info(`Fallback executing mutation: ${mutation.name}`);

    await dbProvider.transaction(async (tx) => {
      const mutators = createMutators(authData, asyncTasks, awaitedPostCommitTasks);
      const wrappedTx = wrapTransactionWithACL(
        tx,
        { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId },
        vespaJobs,
        sideEffectJobs,
        mutation.name,
      );
      const mutator = mustGetMutator(mutators, mutation.name);
      await mutator.fn({
        tx: wrappedTx,
        args: mutation.args,
        ctx: { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId }
      });
    });
    await Promise.allSettled(awaitedPostCommitTasks.map(task => task()));
    Promise.allSettled(asyncTasks.map(task => task()));
    Promise.allSettled(
      vespaJobs.map(async (job) => {
        try {
          await vespaQueue.addJob({
            schema: job.schema,
            jobType: job.jobType,
            docId: job.docId,
            userId: authData.sub,
            workspaceId: authData.workspaceId,
            ...(job.jobType === "update" ? { data: job.data } : {})
          });
        } catch (err) {
          try {
            await db.vespaInsertionLogs.create({
              data: {
                status: "FAILED",
                type: VespaOperationType[job.jobType],
                entityId: job.docId,
                entityType: job.schema,
                namespace: NAMESPACE,
                errorMessage: `Failed to enqueue a job ${JSON.stringify(err)}`,
                errorDetails: JSON.stringify(err),
                userId: authData.sub,
                workspaceId: authData.workspaceId,
                createdAt: new Date(),
              },
            });
          } catch (dbError) {
            logger.error('Failed to log insertion error to database', dbError);
          }
        }
      })
    );
    // Side-effect handlers run on the Zero server, which has NO tenantScopeMiddleware and writes via
    // Prisma db.* (not tx.mutate, so the Zero stamp misses them too). Open a Prisma tenant context
    // from authData.workspaceId so the stamp fills workspaceId on every side-effect create (message,
    // conversation, ticketActivity, …). Fire-and-forget is fine — AsyncLocalStorage propagates to the
    // async chain scheduled inside the callback.
    void runWithContext(
      {
        userId: authData.sub,
        workspaceId: authData.workspaceId,
        role: authData.role,
        orgRole: authData.orgRole,
        memberId: authData.memberId,
      },
      () => processSideEffectJobs(sideEffectJobs, { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId }),
    );
    return { success: true };
  } catch (error) {
    logger.error('Fallback mutate request failed', error);
    return {
      success: false,
      error: "app",
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
