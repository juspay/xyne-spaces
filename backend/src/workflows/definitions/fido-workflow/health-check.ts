import { exec } from 'child_process';
import { promisify } from 'util';
import { HealthCheckResult } from './types';
import { DatabaseClient } from '@/database/client';
import {logger} from '@/utils/logger';

const execAsync = promisify(exec);
const prisma = DatabaseClient.getInstance();

async function checkConnection(host: string, port: number): Promise<HealthCheckResult> {
  logger.info(`Checking connection to ${host}:${port}...`);
  const checkName = `Connection to ${host}:${port}`;
  try {
    // -z: scan for listening daemons, without sending any data to them.
    // -w 5: wait no more than 5 seconds for a connection to occur.
    await execAsync(`nc -z -w 5 ${host} ${port}`);
    return {
      check: checkName,
      success: true,
      details: `Successfully connected to ${host}:${port}.`,
    };
  } catch (error: any) {
    return {
      check: checkName,
      success: false,
      details: `Failed to connect to ${host}:${port}. Error: ${error.message}`,
      remediation: `Ensure the service on ${host}:${port} is running and accessible. Check for firewalls or network configuration issues.`,
    };
  }
}

async function checkHttp(url: string): Promise<HealthCheckResult> {
  logger.info(`Performing HTTP health check on ${url}...`);
  const checkName = `HTTP Health Check for ${url}`;
  try {
    const { stdout } = await execAsync(`curl -s -w "%{http_code}" ${url}`);
    const statusCode = parseInt(stdout.slice(-3), 10);
    const responseBody = stdout.slice(0, -3);
    const success = statusCode >= 200 && statusCode < 300;
    return {
      check: checkName,
      success,
      details: success ? `Received successful status code ${statusCode}. Response: ${responseBody}` : `Received failure status code ${statusCode}. Response: ${responseBody}`,
      remediation: success ? undefined : `The endpoint at ${url} returned a non-success status code (${statusCode}).`,
    };
  } catch (error: any) {
    return {
      check: checkName,
      success: false,
      details: `HTTP check failed. Error: ${error.message}`,
      remediation: `Could not reach the endpoint at ${url}. Ensure the application is running and the URL is correct.`,
    };
  }
}

async function checkPostgres(connectionString: string): Promise<HealthCheckResult> {
  logger.info('Checking Postgres connection...');
  const checkName = 'Postgres Connection';
  try {
    // pg_isready is a utility to check the connection status of a PostgreSQL database server.
    await execAsync(`pg_isready -d "${connectionString}"`);
    return {
      check: checkName,
      success: true,
      details: 'Postgres is ready to accept connections.',
    };
  } catch (error: any) {
    return {
      check: checkName,
      success: false,
      details: `Postgres connection check failed. Error: ${error.message}`,
      remediation: 'Verify the Postgres server is running and the DATABASE_URL environment variable is correct (e.g., postgresql://user:password@host:port/database). Check database server logs.',
    };
  }
}

async function checkRedis(host: string, port: number): Promise<HealthCheckResult> {
  logger.info('Checking Redis connection...');
  const checkName = 'Redis Connection';
  try {
    const { stdout } = await execAsync(`redis-cli -h ${host} -p ${port} PING`);
    const success = stdout.trim().toUpperCase() === 'PONG';
    if (success) {
      return {
        check: checkName,
        success: true,
        details: 'Redis responded with PONG.',
      };
    } else {
      return {
        check: checkName,
        success: false,
        details: `Redis responded unexpectedly: ${stdout.trim()}`,
        remediation: `Ensure the Redis server at ${host}:${port} is configured correctly.`,
      };
    }
  } catch (error: any) {
    return {
      check: checkName,
      success: false,
      details: `Redis connection failed. Error: ${error.message}`,
      remediation: `Ensure the Redis server is running at ${host}:${port} and is accessible. Check the REDIS_HOST and REDIS_PORT environment variables.`,
    };
  }
}

async function checkDbEntry(): Promise<HealthCheckResult> {
  logger.info('Checking database write/read capability...');
  const checkName = 'DB Write/Read Check';
  const testEmail = `healthcheck-${Date.now()}@example.com`;
  let createdUserId: string | null = null;

  try {
    // 1. Write a dummy entry
    const createdUser = await prisma.user.create({
      data: {
        name: 'Health Check User',
        email: testEmail,
        providerUserId: testEmail, // Must be unique
      },
    });
    createdUserId = createdUser.id;

    // 2. Fetch the dummy entry
    const fetchedUser = await prisma.user.findUnique({
      where: { id: createdUserId },
    });

    if (!fetchedUser || fetchedUser.email !== testEmail) {
      throw new Error('Fetched user did not match the created user.');
    }

    return {
      check: checkName,
      success: true,
      details: 'Successfully created, fetched, and validated a dummy DB entry.',
    };
  } catch (error: any) {
    return {
      check: checkName,
      success: false,
      details: `Database write/read check failed: ${error.message}`,
      remediation: 'Check database connection, permissions, and ensure the `User` table schema is correct. The application needs read/write access.',
    };
  } finally {
    // 3. Clean up the dummy entry
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } }).catch(e => {
        logger.error(`Health check cleanup failed: Could not delete user ${createdUserId}.`, e);
      });
    }
    await prisma.$disconnect();
  }
}

export async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  logger.info('🚦 Starting Fido Server Health Checks...');
  // These values would typically come from environment variables or a config file
  const postgresConnectionString = 'postgres://localhost/fido_server';
  const redisHost = 'localhost';
  const redisPort = parseInt('6379', 10);
  const appPort = parseInt('8080', 10);
  const appHost = 'localhost';
  
  // 1. Connection Check
  results.push(await checkConnection(appHost, appPort));

  // 2. HTTP Health Check
  results.push(await checkHttp(`http://${appHost}:${appPort}/health`));

  // 3. Postgres Check
  results.push(await checkPostgres(postgresConnectionString));

  // 4. Redis Check
  results.push(await checkRedis(redisHost, redisPort));

  // 5. DB Entry Check (Write & Read)
  results.push(await checkDbEntry());
  logger.info('🚦 Fido Server Health Checks Completed.',results);
  return results;
}
