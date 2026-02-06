import { mustGetQuery, mustGetMutator } from '@rocicorp/zero';
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server';
import { zeroNodePg } from '@rocicorp/zero/server/adapters/pg';
import { Pool } from 'pg';
import { Context, schema } from '@xyne/shared';
import { AuthData, createMutators } from './mutators';
import { queries } from './queries';
import jwt from 'jsonwebtoken';
import { logger } from '@/utils/logger';
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

export function extractAuthDataFromJWT(encodedJWT?: string): AuthData | undefined {
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

    return decoded;
  } catch (error) {
    logger.error('JWT verification failed:', error);
    return undefined;
  }
}

export function extractAuthDataFromRequest(request: Request): AuthData | undefined {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.substring(7);
  return extractAuthDataFromJWT(token);
}

export async function handleMutate(request: Request): Promise<unknown> {
  // Accumulators for post-processing
  let asyncTasks: (() => Promise<void>)[] = [];
  let vespaJobs: VespaJobsAccumulator = [];
  let sideEffectJobs: SideEffectJobsAccumulator = [];

  const authData = extractAuthDataFromRequest(request);

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
          asyncTasks = [];
          const mutators = createMutators(authData, asyncTasks);
          vespaJobs = createVespaJobsAccumulator();
          sideEffectJobs = createSideEffectJobsAccumulator();

          const wrappedTx = wrapTransactionWithACL(tx, { userID: authData.sub }, vespaJobs, sideEffectJobs);

          const mutator = mustGetMutator(mutators, mutatorName);

          return mutator.fn({ tx: wrappedTx, args, ctx: { userID: authData.sub } });
        }),
      request
    );

    Promise.allSettled(asyncTasks.map((task) => task()));

    Promise.allSettled(
      vespaJobs.map(async (job) => {
        try {
          await vespaQueue.addJob({
            schema: job.schema,
            jobType: job.jobType,
            docId: job.docId,
            userId: authData!.sub,
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
    processSideEffectJobs(sideEffectJobs, { userID: authData.sub });

    return result;
  } catch (error) {
    logger.error('Mutate request failed:', error);
    throw error;
  }
}

export async function handleQueries(request: Request): Promise<any> {

  const authData = extractAuthDataFromRequest(request);
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
        const query = mustGetQuery(queries, queryName);
        const context: Context = { userID: authData.sub };
        return query.fn({ args, ctx: context });
      },
      schema,
      request
    );
    return result;
  } catch (error) {
    logger.error('Query request failed:', error);
    throw error;
  }
}