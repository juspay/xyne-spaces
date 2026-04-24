import { mustGetQuery, mustGetMutator } from '@rocicorp/zero';
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
import { NAMESPACE } from '@/vespa/vespaConfig';
import { VespaOperationType } from './vespa-injection/core/mapper';
import { wrapTransactionWithACL } from './acl';
import { config } from '@/config/env';
import { checkRateLimit } from '@/services/zeroRateLimiter';

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
    }) as AuthData;

    const [user, orgMember] = await Promise.all([
      db.user.findUnique({
        where: { id: decoded.sub },
        select: { role: true },
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

export async function handleMutate(request: Request): Promise<unknown> {
  const startTime = Date.now();
  // Accumulators for post-processing
  let asyncTasks: (() => Promise<void>)[] = [];
  let vespaJobs: VespaJobsAccumulator = [];
  let sideEffectJobs: SideEffectJobsAccumulator = [];
  let capturedMutatorName: string | null = null;

  const authData = await extractAuthDataFromRequest(request);

  if (!authData) {
    throw new Error("Unauthorized")
  }

  const isAllowed = await checkRateLimit("mutate", authData.sub);
  if (!isAllowed) {
    throw new Error("Rate limit exceeded");
  }


  try {
    const result = await handleMutateRequest(
      dbProvider,
      transact =>
        transact((tx, mutatorName, args) => {
          capturedMutatorName = mutatorName;
          asyncTasks = [];
          const mutators = createMutators(authData, asyncTasks);
          vespaJobs = createVespaJobsAccumulator();
          sideEffectJobs = createSideEffectJobsAccumulator();

          const wrappedTx = wrapTransactionWithACL(tx, { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId}, vespaJobs, sideEffectJobs);
          const mutator = mustGetMutator(mutators, mutatorName);
          return mutator.fn({ tx: wrappedTx, args, ctx: { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId } });
        }),
      request
    );
    if (result && typeof result === 'object') {
      if ('mutations' in result && Array.isArray(result.mutations)) {
        for (const mutation of result.mutations) {
          if (mutation.result && typeof mutation.result === 'object' && 'error' in mutation.result) {
            const errorObj = mutation.result;
            const latency = Date.now() - startTime;
            const errorMsg = ('message' in errorObj && errorObj.message) || 
                            ('details' in errorObj && errorObj.details) || 
                            errorObj.error;
    
            logger.error('zero_mutation_error', {
              latency,
              mutation: capturedMutatorName,
              error: errorMsg,
            });
          }
        }
      }
    }

    const latency = Date.now() - startTime;
    getZeroMutationLatency().record(latency, { mutation: capturedMutatorName || 'unknown' });
    getZeroMutationOperations().add(1, { mutation: capturedMutatorName || 'unknown', stage: 'success' });

    logger.info('zero_mutation_success', {
      latency,
      mutation: capturedMutatorName,
    });

    Promise.allSettled(asyncTasks.map((task) => task()));

    Promise.allSettled(
      vespaJobs.map(async (job) => {
        try {
          await vespaQueue.addJob({
            schema: job.schema,
            jobType: job.jobType,
            docId: job.docId,
            userId: authData!.sub,
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
    processSideEffectJobs(sideEffectJobs, { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId });

    return result;
  } catch (error) {
    const latency = Date.now() - startTime;
    getZeroMutationLatency().record(latency, { mutation: capturedMutatorName || 'unknown' });
    getZeroMutationOperations().add(1, { mutation: capturedMutatorName || 'unknown', stage: 'error' });

    logger.error('zero_mutation_error', {
      latency,
      mutation: capturedMutatorName,
      error: error instanceof Error ? error.message : String(error),
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
      (queryName, args) => {
        capturedQueryName = queryName;
        const query = mustGetQuery(queries, queryName);
        const context: Context = { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId };
        return query.fn({ args, ctx: context });
      },
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
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
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
          const queryDef = mustGetQuery(queries, req.name);
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

    console.log(`ZQL-to-SQL executing ${queryRequests.length} queries`);

    const serverSchema = await fetchServerSchema();
    const prisma = DatabaseClient.getInstance();

    const results = await Promise.all(
      queryRequests.map(async (req) => {
        try {
          const queryDef = mustGetQuery(queries, req.name);
          const query = queryDef.fn({
            args: req.args || {},
            ctx: context,
          });

          // Extract AST and Format from ZQL query
          // @ts-ignore - asQueryInternals works with any Query type at runtime
          const { ast, format } = asQueryInternals(query);

          console.log(`Converting ZQL to SQL: ${req.name}`);

          // Use z2s to compile ZQL → SQL
          const compiledOutput = compile(serverSchema, schema, ast, format);
          const sqlQuery = formatPgInternalConvert(
            compiledOutput
          );

          console.log(`Executing SQL via Prisma:`, sqlQuery.text);

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

          console.log(`Converting ZQL to SQL: ${req.name}`);
          console.log('Full SQL query:', sqlQuery.text);
          console.log('SQL length:', sqlQuery.text.length);
          console.log('Values:', sqlQuery.values);

          return {
            name: req.name,
            data,
          };
        } catch (error) {
          console.error(`ZQL-to-SQL query ${req.name} failed:`, error);
          throw error;
        }
      })
    );

    return { results };
  } catch (error) {
    console.error('ZQL-to-SQL request failed:', error);
    throw error;
  }
}

export async function handleMutateFallback(request: Request): Promise<unknown> {
  const authData = await extractAuthDataFromRequest(request);
  if (!authData) {
    throw new Error("Unauthorized");
  }

  let asyncTasks: (() => Promise<void>)[] = [];
  let vespaJobs: VespaJobsAccumulator = createVespaJobsAccumulator();
  let sideEffectJobs: SideEffectJobsAccumulator = createSideEffectJobsAccumulator();

  try {
    const mutation = await request.json() as {
      name: string;
      args: any;
    };

    console.log(`Fallback executing mutation: ${mutation.name}`);

    await dbProvider.transaction(async (tx) => {
      const mutators = createMutators(authData, asyncTasks);
      const wrappedTx = wrapTransactionWithACL(
        tx,
        { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId },
        vespaJobs,
        sideEffectJobs
      );
      const mutator = mustGetMutator(mutators, mutation.name);
      await mutator.fn({
        tx: wrappedTx,
        args: mutation.args,
        ctx: { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId }
      });
    });
    Promise.allSettled(asyncTasks.map(task => task()));
    Promise.allSettled(
      vespaJobs.map(async (job) => {
        try {
          await vespaQueue.addJob({
            schema: job.schema,
            jobType: job.jobType,
            docId: job.docId,
            userId: authData.sub,
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
                createdAt: new Date(),
              },
            });
          } catch (dbError) {
            console.error(`Failed to log insertion error to database:
              ${dbError instanceof Error ? dbError.message : String(dbError)}`);
          }
        }
      })
    );
    processSideEffectJobs(sideEffectJobs, { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, orgRole: authData.orgRole, memberId: authData.memberId });
    return { success: true };
  } catch (error) {
    console.error('Fallback mutate request failed:', error);
    return {
      success: false,
      error: "app",
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
