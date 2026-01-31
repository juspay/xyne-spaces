/**
 * Database Service for Test Runs Table
 * Handles initialization and updates for the xyne_test_runs and xyne_test_module tables
 * Following the 2-table schema defined in TEST_RUN_HISTORY_SCHEMA.md
 */

export interface TestRunData {
  cronRunId: string;
  repoVersion: string | null;
  isVersionActive: boolean;
  previousVersion: string | null;
  previousRunId: string | null;
  runEnv: string;
  runBy: string;
  status: 'in_progress' | 'completed' | 'failed';
  metadata?: any;
}

export interface TestModuleData {
  cronRunId: string;
  moduleName: string;
  runData: any;
  startedAt?: string;
  completedAt?: string;
  slackReportLink?: string;
  metadata?: any;
}

export interface PreviousRunInfo {
  cronRunId: string;
  repoVersion: string;
}

export class TestRunDbService {
  private static instance: TestRunDbService;
  private authToken: string | null = null;
  private tokenExpiry: number = 0;

  private constructor() {}

  public static getInstance(): TestRunDbService {
    if (!TestRunDbService.instance) {
      TestRunDbService.instance = new TestRunDbService();
    }
    return TestRunDbService.instance;
  }

  /**
   * Authenticate with Juspay APIs
   */
  public async authenticate(): Promise<string> {
    try {
      if (this.authToken && Date.now() < this.tokenExpiry) {
        return this.authToken;
      }

      const loginUrl = process.env.LOGIN_API_ENDPOINT || 'https://euler-x.internal.staging.mum.juspay.net/api/ec/v1/admin/login';
      const loginUsername = process.env.JUSPAY_USERNAME;
      const loginPassword = process.env.JUSPAY_PASSWORD;

      if (!loginUsername || !loginPassword) {
        throw new Error('Missing JUSPAY_USERNAME or JUSPAY_PASSWORD environment variables');
      }

      console.log(` Authenticating for database operations...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: loginUsername,
            password: loginPassword
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Authentication failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.token) {
          throw new Error('Token not found in response');
        }

        this.authToken = data.token;
        this.tokenExpiry = Date.now() + 3600000;
        console.log(' Authentication successful');
        return data.token;

      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      console.error(' Authentication failed:', error);
      throw error;
    }
  }

  /**
   * Execute a database query
   */
  public async executeQuery(query: string): Promise<any> {
    const axios = require('axios');
    const token = await this.authenticate();
    const dbEndpoint = process.env.DB_API_ENDPOINT ||
      'https://sandbox.portal.juspay.in/dashboard-test-automation/dbQuery';

    console.log(' Executing query:', query);

    // Use axios which supports GET with JSON body (like Python's requests library)
    const response = await axios.get(dbEndpoint, {
      headers: {
        'x-web-logintoken': token,
        'Content-Type': 'application/json'
      },
      data: { query }
    });

    return response.data;
  }

  /**
   * Escape string values for SQL
   */
  private escapeString(str: string | null): string {
    if (str === null || str === undefined || str === '') return 'NULL';
    return `'${str.replace(/'/g, "''")}'`;
  }

  /**
   * Determine run environment from base URL
   */
  private determineRunEnvironment(): string {
    const baseUrl = process.env.XYNE_BASE_URL;
    if (baseUrl === 'https://sbx.xyne.juspay.net') return 'sbx';
    if (baseUrl === 'https://xyne.juspay.net') return 'prod';
    return 'local';
  }

  /**
   * Fetch the last run of the current active version
   */
  async getPreviousRunInfo(runEnv: string): Promise<PreviousRunInfo | null> {
    try {
      console.log(` Fetching previous run info for environment: ${runEnv}`);

      const query = `
        SELECT cron_run_id, repo_version
        FROM xyne_test_runs
        WHERE run_env = ${this.escapeString(runEnv)}
          AND is_version_active = TRUE
          AND status = 'completed'
        ORDER BY run_date_time DESC
        LIMIT 1
      `;

      const result = await this.executeQuery(query);

      console.log(' Query result:', JSON.stringify(result, null, 2));

      // Handle response format: result.response can be an array or a string message
      if (result && result.response && Array.isArray(result.response) && result.response.length > 0) {
        const row = result.response[0];
        console.log(` Found previous active run: ${row.cron_run_id} (version: ${row.repo_version})`);
        return {
          cronRunId: row.cron_run_id,
          repoVersion: row.repo_version
        };
      }

      console.log('️  No previous active completed run found (query returned no rows)');
      return null;
    } catch (error) {
      console.warn('️  Failed to fetch previous run info:', error);
      return null;
    }
  }

  /**
   * Mark all runs of a version as inactive
   */
  async markVersionInactive(repoVersion: string, runEnv: string): Promise<void> {
    try {
      console.log(` Marking all runs of version ${repoVersion} as inactive...`);

      const query = `
        UPDATE xyne_test_runs
        SET is_version_active = FALSE
        WHERE repo_version = ${this.escapeString(repoVersion)}
          AND run_env = ${this.escapeString(runEnv)}
      `;

      await this.executeQuery(query);
      console.log(' Version marked as inactive');
    } catch (error) {
      console.error(' Failed to mark version inactive:', error);
      throw error;
    }
  }

  /**
   * Get the last completed run of a specific version
   */
  async getLastRunOfVersion(version: string | null, runEnv: string, excludeRunId: string | null): Promise<{ cronRunId: string } | null> {
    try {
      if (!version) {
        return null;
      }

      let query = `
        SELECT cron_run_id
        FROM xyne_test_runs
        WHERE repo_version = ${this.escapeString(version)}
          AND run_env = ${this.escapeString(runEnv)}
          AND status = 'completed'
      `;

      if (excludeRunId) {
        query += ` AND cron_run_id != ${this.escapeString(excludeRunId)}`;
      }

      query += `
        ORDER BY run_date_time DESC
        LIMIT 1
      `;

      const result = await this.executeQuery(query);

      if (result && result.response && result.response.length > 0) {
        const row = result.response[0];
        return { cronRunId: row.cron_run_id };
      }

      return null;
    } catch (error) {
      console.warn('️  Failed to fetch last run of version:', error);
      return null;
    }
  }

  /**
   * Get details of a specific run including previous version info
   */
  async getRunDetails(cronRunId: string): Promise<{ previousVersion: string | null; previousRunId: string | null } | null> {
    try {
      const query = `
        SELECT previous_version, previous_run_id
        FROM xyne_test_runs
        WHERE cron_run_id = ${this.escapeString(cronRunId)}
      `;

      const result = await this.executeQuery(query);

      if (result && result.response && result.response.length > 0) {
        const row = result.response[0];
        return {
          previousVersion: row.previous_version,
          previousRunId: row.previous_run_id
        };
      }

      return null;
    } catch (error) {
      console.warn('️  Failed to fetch run details:', error);
      return null;
    }
  }

  /**
   * Initialize a new test run entry in xyne_test_runs table
   */
  async initializeTestRun(data: TestRunData): Promise<void> {
    try {
      console.log('💾 Initializing test run in database...');
      console.log(' Test Run Data:', {
        cronRunId: data.cronRunId,
        repoVersion: data.repoVersion,
        runEnv: data.runEnv,
        previousVersion: data.previousVersion,
        previousRunId: data.previousRunId
      });

      const metadata = JSON.stringify(data.metadata || {});

      const query = `
        INSERT INTO xyne_test_runs (
          cron_run_id,
          repo_version,
          is_version_active,
          previous_version,
          previous_run_id,
          run_env,
          run_by,
          status,
          metadata,
          run_date_time
        ) VALUES (
          ${this.escapeString(data.cronRunId)},
          ${this.escapeString(data.repoVersion)},
          ${data.isVersionActive},
          ${this.escapeString(data.previousVersion)},
          ${this.escapeString(data.previousRunId)},
          ${this.escapeString(data.runEnv)},
          ${this.escapeString(data.runBy)},
          ${this.escapeString(data.status)},
          '${metadata.replace(/'/g, "''")}',
          CURRENT_TIMESTAMP
        )
      `;

      await this.executeQuery(query);
      console.log(` Test run initialized successfully (Batch ID: ${data.cronRunId})`);
    } catch (error) {
      console.error(' Failed to initialize test run:', error);
      throw error;
    }
  }

  /**
   * Insert or update module test results in xyne_test_module table
   */
  async saveModuleResults(data: TestModuleData): Promise<void> {
    try {
      console.log(`💾 Saving results for module: ${data.moduleName}`);

      // First, ensure the parent test run exists (defensive check for foreign key constraint)
      await this.ensureTestRunExists(data.cronRunId);

      const runData = JSON.stringify(data.runData);
      const metadata = data.metadata ? JSON.stringify(data.metadata) : 'NULL';
      const startedAt = data.startedAt ? this.escapeString(data.startedAt) : 'NULL';
      const completedAt = data.completedAt ? this.escapeString(data.completedAt) : 'NULL';
      const slackReportLink = data.slackReportLink ? this.escapeString(data.slackReportLink) : 'NULL';

      // Use INSERT ... ON CONFLICT for upsert behavior
      const query = `
        INSERT INTO xyne_test_module (
          cron_run_id,
          module_name,
          run_data,
          started_at,
          completed_at,
          slack_report_link,
          metadata
        ) VALUES (
          ${this.escapeString(data.cronRunId)},
          ${this.escapeString(data.moduleName)},
          '${runData.replace(/'/g, "''")}',
          ${startedAt},
          ${completedAt},
          ${slackReportLink},
          ${metadata === 'NULL' ? 'NULL' : `'${metadata.replace(/'/g, "''")}'`}
        )
        ON CONFLICT (cron_run_id, module_name)
        DO UPDATE SET
          run_data = EXCLUDED.run_data,
          completed_at = EXCLUDED.completed_at,
          slack_report_link = EXCLUDED.slack_report_link,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
      `;

      await this.executeQuery(query);
      console.log(` Module results saved: ${data.moduleName}`);
    } catch (error) {
      console.error(` Failed to save module results for ${data.moduleName}:`, error);
      throw error;
    }
  }

  /**
   * Ensure test run exists in xyne_test_runs (defensive check for foreign key)
   */
  private async ensureTestRunExists(cronRunId: string): Promise<void> {
    try {
      // Check if the test run exists
      const checkQuery = `
        SELECT cron_run_id
        FROM xyne_test_runs
        WHERE cron_run_id = ${this.escapeString(cronRunId)}
      `;

      const result = await this.executeQuery(checkQuery);

      // If it doesn't exist, create it
      if (!result || !result.response || result.response.length === 0) {
        console.log(`️  Test run ${cronRunId} not found, creating it now...`);

        const runEnv = process.env.TEST_ENV || 'local';
        const runBy = process.env.SCRIPT_RUN_BY || process.env.USER || process.env.USERNAME || 'Unknown';

        const insertQuery = `
          INSERT INTO xyne_test_runs (
            cron_run_id,
            repo_version,
            is_version_active,
            run_env,
            run_by,
            status,
            run_date_time
          ) VALUES (
            ${this.escapeString(cronRunId)},
            NULL,
            FALSE,
            ${this.escapeString(runEnv)},
            ${this.escapeString(runBy)},
            'in_progress',
            CURRENT_TIMESTAMP
          )
        `;

        await this.executeQuery(insertQuery);
        console.log(` Created missing test run entry for ${cronRunId}`);
      }
    } catch (error) {
      console.warn(`️  Could not verify/create test run ${cronRunId}:`, error);
      // Don't throw - let the module insert attempt to proceed and fail if needed
    }
  }

  /**
   * Update test run status (e.g., to 'completed' or 'failed')
   */
  async updateTestRunStatus(cronRunId: string, status: 'completed' | 'failed'): Promise<void> {
    try {
      console.log(` Updating test run status to: ${status}`);

      const query = `
        UPDATE xyne_test_runs
        SET status = ${this.escapeString(status)},
            updated_at = CURRENT_TIMESTAMP
        WHERE cron_run_id = ${this.escapeString(cronRunId)}
      `;

      await this.executeQuery(query);
      console.log(` Test run status updated to: ${status}`);
    } catch (error) {
      console.error(' Failed to update test run status:', error);
      throw error;
    }
  }

  /**
   * Complete workflow: Initialize test run with version tracking
   *
   * Flow:
   * Step 1: Get current repo version
   * Step 2: Get last active completed run
   * Step 3a: If version SAME -> Get previous version from that run, use its last completed data for comparison
   * Step 3b: If version DIFFERENT -> Mark all old version runs inactive, use that row for comparison
   */
  async initializeTestRunWithVersionTracking(): Promise<void> {
    try {
      const cronRunId = process.env.CRON_RUN_ID;
      const repoVersion = process.env.REPO_VERSION || null;
      const runBy = process.env.SCRIPT_RUN_BY || process.env.USER || process.env.USERNAME || 'Unknown';
      const runEnv = this.determineRunEnvironment();

      if (!cronRunId) {
        throw new Error('CRON_RUN_ID environment variable not set');
      }

      console.log(' Starting test run initialization with version tracking...');
      console.log(` Step 1: Current repo version: ${repoVersion}`);

      // Step 2: Get last active completed run
      console.log(` Step 2: Fetching last active completed run...`);
      const lastActiveRun = await this.getPreviousRunInfo(runEnv);

      let isVersionActive = true;
      let previousVersion: string | null = null;
      let previousRunId: string | null = null;

      if (lastActiveRun) {
        const lastActiveVersion = lastActiveRun.repoVersion;
        const lastActiveRunId = lastActiveRun.cronRunId;

        console.log(`    Found last active run: ${lastActiveRunId} (version: ${lastActiveVersion})`);

        // Step 3: Check if version is same or different
        if (repoVersion === lastActiveVersion) {
          // Step 3a: Version SAME
          console.log(` Step 3a: Version SAME (${repoVersion})`);
          console.log(`   → Getting previous version from last run...`);

          // Get the previous version info from the last active run
          const lastRunDetails = await this.getRunDetails(lastActiveRunId);

          if (lastRunDetails && lastRunDetails.previousVersion && lastRunDetails.previousRunId) {
            previousVersion = lastRunDetails.previousVersion;
            previousRunId = lastRunDetails.previousRunId;
            console.log(`    Using previous version: ${previousVersion} (Run: ${previousRunId})`);
          } else {
            console.log(`   ️  No previous version found in last run (might be first version)`);
          }

          isVersionActive = true;
        } else {
          // Step 3b: Version DIFFERENT
          console.log(` Step 3b: Version DIFFERENT (${lastActiveVersion} → ${repoVersion})`);
          console.log(`   → Marking all runs of version ${lastActiveVersion} as inactive...`);

          // Mark all runs of the old version as inactive
          await this.markVersionInactive(lastActiveVersion, runEnv);

          // Use the last active run for comparison
          previousVersion = lastActiveVersion;
          previousRunId = lastActiveRunId;

          console.log(`    Will compare with previous version: ${previousVersion} (Run: ${previousRunId})`);
          isVersionActive = true;
        }
      } else {
        console.log(' Step 2-3: First run detected (no previous run found)');
      }

      // Collect metadata
      const metadata = {
        stagger_delay_seconds: 50,
        parallel_workers: 5,
        browser: 'chromium',
        base_url: process.env.XYNE_BASE_URL || 'unknown',
        node_version: process.version,
        triggered_by: process.env.IS_CRON_RUN === 'true' ? 'cron' : 'manual'
      };

      // Initialize test run
      await this.initializeTestRun({
        cronRunId,
        repoVersion,
        isVersionActive,
        previousVersion,
        previousRunId,
        runEnv,
        runBy,
        status: 'in_progress',
        metadata
      });

      console.log(' Test run initialization completed');
    } catch (error) {
      console.error(' Test run initialization failed:', error);
      throw error;
    }
  }

  /**
   * Check if database operations should be performed
   */
  async shouldPerformDbOperations(): Promise<boolean> {
    try {
      const allowedUsersEnv = process.env.DB_ALLOWED_USERS;

      // If DB_ALLOWED_USERS is not set or empty, disable database operations
      if (!allowedUsersEnv) {
        console.log(' DB_ALLOWED_USERS not configured, skipping database operations');
        return false;
      }

      const allowedUsers = allowedUsersEnv.split(',').map(u => u.trim());
      const currentUser = process.env.SCRIPT_RUN_BY || process.env.USER || process.env.USERNAME;

      if (!currentUser) {
        console.log(' No user identified, skipping database operations');
        return false;
      }

      const shouldPerform = allowedUsers.includes(currentUser);

      if (!shouldPerform) {
        console.log(` Database operations: DISABLED for user "${currentUser}"`);
        console.log(`️  Allowed users: ${allowedUsers.join(', ')}`);
      } else {
        console.log(` Database operations: ENABLED for user "${currentUser}"`);
      }

      return shouldPerform;
    } catch (error) {
      console.warn('️ Error checking database eligibility:', error);
      return false;
    }
  }
}

// Export singleton instance
export const testRunDbService = TestRunDbService.getInstance();
