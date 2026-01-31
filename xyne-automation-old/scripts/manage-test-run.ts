#!/usr/bin/env node
/**
 * Consolidated Database Management Script for Test Runs
 *
 * Usage:
 *   npx tsx scripts/manage-test-run.ts init              # Initialize test run
 *   npx tsx scripts/manage-test-run.ts complete [code]   # Mark run as complete
 *   npx tsx scripts/manage-test-run.ts verify [id]       # Verify test data exists
 *
 * Environment Variables:
 *   CRON_RUN_ID - The test run identifier
 *   SCRIPT_RUN_BY - User running the script
 *   TEST_ENV - Environment (sbx/prod/local)
 *   DB_ALLOWED_USERS - Comma-separated list of users allowed to perform DB operations
 */

import { config } from 'dotenv';
import { testRunDbService } from '../src/framework/utils/test-run-db-service';

// Load environment variables from .env file
config();

/**
 * Initialize test run in database with version tracking
 */
async function initializeTestRun(): Promise<void> {
  console.log('');
  console.log('==========================================');
  console.log('📋 Initializing Test Run in Database');
  console.log('==========================================');

  const shouldPerform = await testRunDbService.shouldPerformDbOperations();
  if (!shouldPerform) {
    console.log('ℹ️  Database operations disabled for this user/environment');
    console.log('==========================================');
    console.log('');
    return;
  }

  await testRunDbService.initializeTestRunWithVersionTracking();

  console.log('==========================================');
  console.log(' Test Run Initialized Successfully');
  console.log('==========================================');
  console.log('');
}

/**
 * Complete test run - update status to completed
 */
async function completeTestRun(exitCode: string = '0'): Promise<void> {
  const cronRunId = process.env.CRON_RUN_ID;

  if (!cronRunId) {
    console.warn('⚠️  CRON_RUN_ID not set, skipping database update');
    return;
  }

  console.log('');
  console.log('==========================================');
  console.log('📋 Updating Test Run Status in Database');
  console.log('==========================================');

  const shouldPerform = await testRunDbService.shouldPerformDbOperations();
  if (!shouldPerform) {
    console.log('ℹ️  Database operations disabled for this user/environment');
    console.log('==========================================');
    console.log('');
    return;
  }

  // Mark as completed regardless of exit code
  // Individual test failures are tracked in xyne_test_module.run_data
  const status = 'completed';

  await testRunDbService.updateTestRunStatus(cronRunId, status);

  console.log('==========================================');
  console.log(` Test Run Status Updated: ${status.toUpperCase()}`);
  console.log('==========================================');
  console.log('');
}

/**
 * Verify test data exists in database
 */
async function verifyTestData(cronRunId?: string): Promise<boolean> {
  const runId = cronRunId || process.env.CRON_RUN_ID;

  if (!runId) {
    console.error(' Error: CRON_RUN_ID is required');
    console.log('Usage: npx tsx scripts/manage-test-run.ts verify <CRON_RUN_ID>');
    return false;
  }

  console.log(`\n Verifying test data for CRON_RUN_ID: ${runId}`);

  const shouldPerform = await testRunDbService.shouldPerformDbOperations();
  if (!shouldPerform) {
    console.log('⚠️  Database operations disabled for this user');
    return false;
  }

  console.log(' Authenticating for database operations...');
  await testRunDbService.authenticate();
  console.log(' Authentication successful');

  // Query to check if data exists in xyne_test_module
  const query = `
    SELECT
      module_name,
      run_data
    FROM xyne_test_module
    WHERE cron_run_id = '${runId}'
    ORDER BY module_name
  `;

  console.log(' Checking for module data...');
  const result = await testRunDbService.executeQuery(query);

  if (!result || !result.response || result.response.length === 0) {
    console.log('No data found in database');
    return false;
  }

  console.log(`\n Found ${result.response.length} module(s):\n`);

  // Parse response data (database API returns arrays)
  for (let i = 0; i < result.response.length; i++) {
    const row = result.response[i];

    // Database returns data as arrays, need to parse based on query column order
    // Query: module_name (0), run_data (1)
    const moduleName = Array.isArray(row) ? row[0] : (row.module_name || 'unknown');
    const runDataRaw = Array.isArray(row) ? row[1] : (row.run_data || {});

    // Parse JSONB if it's a string
    const runData = typeof runDataRaw === 'string' ? JSON.parse(runDataRaw) : runDataRaw;
    const tests = runData?.tests || [];

    console.log(`   📦 ${moduleName}: ${tests.length} tests`);
  }
  console.log('');

  return true;
}

/**
 * Main entry point
 */
async function main() {
  try {
    const command = process.argv[2];
    const arg = process.argv[3];

    switch (command) {
      case 'init':
      case 'initialize':
        await initializeTestRun();
        break;

      case 'complete':
      case 'finish':
        await completeTestRun(arg || '0');
        break;

      case 'verify':
      case 'check':
        const success = await verifyTestData(arg);
        process.exit(success ? 0 : 1);
        break;

      default:
        console.error('Unknown command:', command);
        console.log('');
        console.log('Usage:');
        console.log('  npx tsx scripts/manage-test-run.ts init              # Initialize test run');
        console.log('  npx tsx scripts/manage-test-run.ts complete [code]   # Mark run as complete');
        console.log('  npx tsx scripts/manage-test-run.ts verify [id]       # Verify test data exists');
        console.log('');
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('==========================================');
    console.error('Database Operation Failed');
    console.error('==========================================');
    console.error(error);
    console.error('');
    console.warn('⚠️  Continuing despite database operation failure');
    process.exit(0); // Don't fail the test run
  }
}

main();
