import { hasUncommittedChanges, commitAllChanges, pushCommits, CommandExecutor } from '@framework';
import { logger } from '@/utils/logger';
import { GitInfo } from '../workflow-types';
import { getStorageService } from '@/services/storage';
import { config } from '@/config/env';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';

const commandExecutor = new CommandExecutor();

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DeterministicValidationResult {
  passed?: boolean;
  validationOutput?: ExecutionResult;
  formatCommitHash?: string;
  errorLines?: string[];
  failureReason?: string;
  success?: boolean;
  validated?: boolean;
  error?: {
    step: string;
    message: string;
    details?: string;
  };
}

/**
 * Get changed files for local runs (working tree, no commits)
 */
export const getLocalChangedFiles = async (
  repoPath: string
): Promise<string[]> => {
  const result = await executeCommand(
    'git diff --name-only && git diff --cached --name-only && git ls-files --others --exclude-standard',
    repoPath
  );
  const files = result.stdout.split('\n').filter(f => f.trim());
  // Remove duplicates
  return [...new Set(files)];
};

/**
 * Get git diff for local runs (working tree, no commits)
 */
export const getLocalGitDiff = async (
  repoPath: string
): Promise<string> => {
  const unstagedResult = await executeCommand('git diff', repoPath);
  const stagedResult = await executeCommand('git diff --cached', repoPath);

  return `## Unstaged Changes\n${unstagedResult.stdout || 'No unstaged changes'}\n\n## Staged Changes\n${stagedResult.stdout || 'No staged changes'}`;
};

async function executeCommand(
  command: string,
  cwd: string
): Promise<ExecutionResult> {
  logger.info(`[cmd] Executing: ${command}`, { cwd });
  try {
    const result = await commandExecutor.executeCommand({ command }, undefined, cwd);

    if (result.stdout) {
      logger.info(`[cmd] stdout:`, { command, stdout: result.stdout });
    }
    if (result.stderr) {
      logger.info(`[cmd] stderr:`, { command, stderr: result.stderr });
    }
    logger.info(`[cmd] Exit code: ${result.exitCode}`, { command });

    return result;
  } catch (error) {
    logger.error(`Command failed: ${command}`, { error, cwd });
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1
    };
  }
}

function extractErrorLines(output: string): string[] {
  const fullOutput = output || '';
  return fullOutput.split('\n').filter(line => {
    const lowerLine = line.toLowerCase();
    return (
      line.includes('error TS') ||
      line.includes('error:') ||
      (lowerLine.includes('error') && (
        lowerLine.includes('found') ||
        lowerLine.includes('failed') ||
        lowerLine.includes('build') ||
        lowerLine.includes('compilation')
      )) ||
      // ESLint errors
      /^\s*\d+:\d+\s+error/.test(line) ||
      // Build failure indicators
      lowerLine.includes('build failed') ||
      lowerLine.includes('compilation failed')
    );
  });
}

/**
 * Get list of changed files between base commit and HEAD.
 * Uses baseCommitHash (when planning started), NOT baseBranch.
 */
export const getChangedFiles = async (
  repoPath: string,
  baseCommitHash: string
): Promise<string[]> => {
  const result = await executeCommand(
    `git diff --name-only ${baseCommitHash} HEAD`,
    repoPath
  );
  return result.stdout.split('\n').filter(f => f.trim());
};

/**
 * Get full git diff between base commit and HEAD.
 * Uses baseCommitHash (when planning started), NOT baseBranch.
 */
export const getGitDiff = async (
  repoPath: string,
  baseCommitHash: string
): Promise<string> => {
  const result = await executeCommand(
    `git diff ${baseCommitHash} HEAD`,
    repoPath
  );
  return result.stdout;
};

export async function runDeterministicValidation(
  repoPath: string,
  gitInfo: GitInfo,
  coAuthor?: { name: string; email: string }
): Promise<DeterministicValidationResult> {
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('Invalid repoPath: must be a non-empty string');
  }

  if (!gitInfo || typeof gitInfo !== 'object') {
    throw new Error('Invalid gitInfo: must be an object');
  }

  logger.info('Running deterministic validation steps...');

  // Step 1: Install and build shared (dashboard depends on shared being built)
  logger.info('Installing dependencies in shared...');
  await executeCommand('NODE_ENV=development npm i', `${repoPath}/shared`);

  logger.info('Building shared...');
  await executeCommand('npm run build', `${repoPath}/shared`);

  // Step 2: Install and build framework (dashboard depends on framework)
  logger.info('Installing dependencies in framework...');
  await executeCommand('NODE_ENV=development npm i', `${repoPath}/framework`);

  logger.info('Building framework...');
  await executeCommand('npm run build', `${repoPath}/framework`);

  // Step 3: Install and build backend (backend types may be needed)
  logger.info('Installing dependencies in backend...');
  await executeCommand('NODE_ENV=development npm i', `${repoPath}/backend`);
  
  logger.info('Building backend...');
  await executeCommand('npm run build', `${repoPath}/backend`);

  // Step 4: Install dependencies in dashboard
  logger.info('Installing dependencies in dashboard...');
  await executeCommand('NODE_ENV=development npm i', `${repoPath}/dashboard`);

  // Step 5: Format code
  logger.info('Formatting code...');
  await executeCommand('npm run format', `${repoPath}/dashboard`);

  // Step 6: Stage and commit formatted files
  logger.info('Checking for formatting changes...');
  const hasChanges = await hasUncommittedChanges(repoPath);
  let formatCommitHash: string | undefined;

  if (hasChanges) {
    logger.info('Committing formatted files...');
    const commitHash = await commitAllChanges(
      repoPath,
      'chore: format code with prettier',
      coAuthor?.name,
      coAuthor?.email
    );
    if (commitHash) {
      formatCommitHash = commitHash;
      Object.assign(gitInfo, { commitHash });
      logger.info('Formatted files committed', { commitHash });
    }
  } else {
    logger.info('No formatting changes to commit');
  }

  // Step 7: Run validation
  logger.info('Running validation...');
  const validationOutput = await executeCommand('npm run validate', `${repoPath}/dashboard`);

  // Check if validation passed (exit code 0 means success, no errors)
  const passed = validationOutput.exitCode === 0;

  // Extract only actual errors (not warnings) from the output
  const errorLines = extractErrorLines(validationOutput.stderr || validationOutput.stdout);

  // Step 8: Push format commit AFTER validation (only if validation passed)
  if (formatCommitHash && gitInfo.branch && passed) {
    logger.info('Validation passed - pushing format commit to remote...', {
      branch: gitInfo.branch
    });
  try {
    // Try to pull and rebase before pushing to handle non-fast-forward scenarios
    try {
      logger.info(`Attempting to pull and rebase origin/${gitInfo.branch} before push`);
      await executeCommand(`git pull --rebase origin ${gitInfo.branch}`, repoPath);
      logger.info('Successfully pulled and rebased');
    } catch (pullError) {
      logger.warn('Pull rebase failed, attempting push anyway', { pullError });
      // Continue to push attempt even if pull fails
    }
    
    await pushCommits(repoPath, gitInfo.branch);
    logger.info('Format commit pushed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to push format commit', { error });
    
    // Return failure details instead of swallowing the error
    return {
      success: false,
      validated: false,
      failureReason: `Git push failed: ${errorMessage}`,
      error: {
        step: 'push_format_commit',
        message: errorMessage,
        details: error instanceof Error ? error.stack : undefined
      }
    };
  }
  } else if (formatCommitHash && !passed) {
    logger.info('Validation failed - format commit will be pushed by agent along with fixes');
  }

  return {
    passed,
    validationOutput,
    formatCommitHash,
    errorLines
  };
}

/**
 * Get the git diff between base commit and HEAD
 * Returns the full diff output and list of changed files
 */
export async function getGitDiffForReview(
  repoPath: string,
  baseRef: string
): Promise<{
  changedFiles: string[];
  diffOutput: string;
  success: boolean;
  error?: string;
}> {
  logger.info(`[GitDiff] Getting diff between base ref ${baseRef} and HEAD`, { repoPath });

  if (!baseRef) {
    logger.error('[GitDiff] No base reference provided');
    return {
      changedFiles: [],
      diffOutput: '',
      success: false,
      error: 'No base reference provided'
    };
  }

  try {
    // Resolve the base ref to an actual commit hash for consistency
    const resolveResult = await executeCommand(
      `git rev-parse ${baseRef}`,
      repoPath
    );

    if (resolveResult.exitCode !== 0) {
      logger.error(`[GitDiff] Failed to resolve base ref: ${baseRef}`, { stderr: resolveResult.stderr });
      return {
        changedFiles: [],
        diffOutput: '',
        success: false,
        error: `Cannot resolve base ref: ${baseRef}`
      };
    }

    const baseCommit = resolveResult.stdout.trim();
    logger.info(`[GitDiff] Resolved ${baseRef} to commit: ${baseCommit}`);

    // Get current HEAD commit for logging
    const headResult = await executeCommand(
      'git rev-parse HEAD',
      repoPath
    );
    const headCommit = headResult.exitCode === 0 ? headResult.stdout.trim() : 'unknown';
    logger.info(`[GitDiff] Current HEAD: ${headCommit}`);

    // Validate we have a proper commit range
    if (baseCommit === headCommit) {
      logger.warn('[GitDiff] Base commit and HEAD are the same - no changes to review');
      return {
        changedFiles: [],
        diffOutput: '',
        success: true
      };
    }

    // Get list of changed files from base commit to HEAD
    const filesResult = await executeCommand(
      `git diff --name-only ${baseCommit}..HEAD`,
      repoPath
    );

    if (filesResult.exitCode !== 0) {
      logger.error(`[GitDiff] Failed to get changed files`, { stderr: filesResult.stderr, baseCommit });
      return {
        changedFiles: [],
        diffOutput: '',
        success: false,
        error: filesResult.stderr
      };
    }

    const changedFiles = filesResult.stdout
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);

    logger.info(`[GitDiff] Found ${changedFiles.length} changed files from ${baseCommit} to ${headCommit}`, { changedFiles, baseCommit, headCommit });

    // Get full diff from base commit to HEAD
    const diffResult = await executeCommand(
      `git diff ${baseCommit}..HEAD`,
      repoPath
    );

    if (diffResult.exitCode !== 0) {
      logger.error(`[GitDiff] Failed to get diff`, { stderr: diffResult.stderr });
      return {
        changedFiles,
        diffOutput: '',
        success: false,
        error: diffResult.stderr
      };
    }

    logger.info(`[GitDiff] Successfully retrieved diff`, {
      diffLength: diffResult.stdout.length,
      lineCount: diffResult.stdout.split('\n').length
    });

    return {
      changedFiles,
      diffOutput: diffResult.stdout,
      success: true
    };
  } catch (error) {
    logger.error(`[GitDiff] Exception while getting diff`, { error });
    return {
      changedFiles: [],
      diffOutput: '',
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// =============================================================================
// TEST EXECUTION HELPERS
// =============================================================================

export interface TestExecutionResult {
  passed: boolean;
  testOutput: string;
  failureDetails: string;
}

export interface PostTestCommitResult {
  commitHash?: string;
}

/**
 * Extract test failure details from cucumber report files
 * Looks for the latest report directory and parses cucumber-report.json
 */
async function extractFailuresFromReport(repoPath: string): Promise<string[]> {
  try {
    const reportPath = path.join(repoPath, 'xyne-automation', 'report');

    // Check if report directory exists
    try {
      await fs.access(reportPath);
    } catch {
      logger.debug('[extractFailuresFromReport] Report directory does not exist', { reportPath });
      return [];
    }

    // Get all timestamp directories
    const entries = await fs.readdir(reportPath, { withFileTypes: true });
    const timestampDirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => /^\d{4}-\d{2}-\d{2}T/.test(name))
      .sort((a, b) => b.localeCompare(a));

    if (timestampDirs.length === 0) {
      logger.debug('[extractFailuresFromReport] No timestamp directories found in report path');
      return [];
    }

    // Get the latest report directory
    const latestDir = timestampDirs[0];
    const reportFilePath = path.join(reportPath, latestDir, 'cucumber-report.json');

    // Read and parse the cucumber report
    try {
      const reportContent = await fs.readFile(reportFilePath, 'utf-8');
      const report = JSON.parse(reportContent) as Array<{
        name?: string;
        elements?: Array<{
          name?: string;
          steps?: Array<{
            keyword?: string;
            name?: string;
            result?: {
              status?: string;
              error_message?: string;
            };
          }>;
        }>;
      }>;

      const failures: string[] = [];

      for (const feature of report) {
        if (!feature.elements) continue;
        for (const scenario of feature.elements) {
          if (!scenario.steps) continue;
          for (const step of scenario.steps) {
            if (step.result?.status === 'failed' && step.result.error_message) {
              const scenarioName = scenario.name || 'Unknown Scenario';
              const stepName = `${step.keyword || ''} ${step.name || ''}`.trim();
              failures.push(
                `Failed: ${scenarioName}\n  Step: ${stepName}\n  Error: ${step.result.error_message}`
              );
            }
          }
        }
      }

      logger.info(
        `[extractFailuresFromReport] Extracted ${failures.length} failures from report`,
        { reportDir: latestDir }
      );

      return failures;
    } catch (error) {
      logger.warn('[extractFailuresFromReport] Failed to read or parse report file', {
        reportFilePath,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  } catch (error) {
    logger.error('[extractFailuresFromReport] Unexpected error', { error });
    return [];
  }
}

/**
 * Run test cases validation.
 * This actually runs the tests to validate functionality.
 *
 * Ephemeral ports (port=0) are set for every service so the OS assigns a free
 * port automatically. This mirrors the Jenkinsfile "Functional Testing" stage
 * and prevents port conflicts when multiple workflow executions run in parallel.
 * A unique COMPOSE_PROJECT_NAME is derived from the repoPath (which is
 * /tmp/<executionId>) to keep each execution's Docker Compose resources fully
 * isolated from one another.
 */
export async function runTestCases(repoPath: string): Promise<TestExecutionResult> {
  logger.info('Running test cases to validate functionality...');

  // Derive a unique COMPOSE_PROJECT_NAME from repoPath so concurrent workflow
  // executions do not share Docker Compose networks, containers, or volumes.
  // repoPath = /tmp/<executionId>, so path.basename gives the unique id.
  const projectSuffix = path.basename(repoPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const composeProjectName = `xyne-workflow-${projectSuffix}`;

  logger.info(`[runTestCases] COMPOSE_PROJECT_NAME=${composeProjectName} (ephemeral ports enabled)`);

  const testResult = await executeCommand(
    [
      'POSTGRES_BIND_PORT=0',
      'REDIS_BIND_PORT=0',
      'LIVEKIT_HTTP_BIND_PORT=0',
      'LIVEKIT_HTTPS_BIND_PORT=0',
      'LIVEKIT_UDP_BIND_PORT=0',
      'FAKE_GCS_BIND_PORT=0',
      'ZERO_BIND_PORT_1=0',
      'ZERO_BIND_PORT_2=0',
      'TRANSCRIPTION_AGENT_BIND_PORT=0',
      'SUPERPOSITION_BIND_PORT=0',
      'BACKEND_BIND_PORT=0',
      'DASHBOARD_BIND_PORT=0',
      'YSWEET_BIND_PORT=0',
      `COMPOSE_PROJECT_NAME=${composeProjectName}`,
      `PROJECT_ROOT=${repoPath}`,
      'OUTPUT_MODE=plain',
      'npm run test',
    ].join(' '),
    `${repoPath}`
  );

  logger.debug(`Test command completed with exit code: ${testResult.exitCode}`);

  const passed = testResult.exitCode === 0;
  const output = `${testResult.stdout}\n${testResult.stderr}`;

  // Check report directory after tests
  const reportPath = path.join(repoPath, 'xyne-automation', 'report');
  logger.debug(`Checking report path after tests: ${reportPath}`);
  logger.debug(`Report dir exists after: ${existsSync(reportPath)}`);

  if (existsSync(reportPath)) {
    try {
      const entries = readdirSync(reportPath);
      logger.debug(`Report directory entries: ${entries.join(', ') || '(empty)'}`);

      for (const entry of entries) {
        const entryPath = path.join(reportPath, entry);
        const isDir = statSync(entryPath).isDirectory();
        logger.debug(`  ${entry}: ${isDir ? 'directory' : 'file'}`);

        if (isDir) {
          try {
            const subEntries = readdirSync(entryPath);
            logger.debug(`    Contents: ${subEntries.join(', ') || '(empty)'}`);
          } catch (e) {
            logger.debug(`    Error reading: ${e}`);
          }
        }
      }
    } catch (e) {
      logger.debug(`Error reading report dir: ${e}`);
    }
  } else {
    logger.debug(`Report directory does not exist: ${reportPath}`);
  }

  if (passed) {
    logger.info('✅ Test cases passed successfully');
  } else {
    logger.warn('❌ Test cases failed - issues detected');
  }

  return {
    passed,
    testOutput: output,
    failureDetails: passed ? '' : (await extractFailuresFromReport(repoPath)).join('\n')
  };
}

/**
 * Commit any uncommitted changes after test execution.
 * This ensures test fixes are committed and pushed to remote.
 */
export async function commitPostTestChanges(
  repoPath: string,
  gitInfo: GitInfo,
  coAuthor?: { name: string; email: string }
): Promise<PostTestCommitResult> {
  logger.info('Checking for uncommitted changes after test execution...');

  const hasChanges = await hasUncommittedChanges(repoPath);
  let commitHash: string | undefined;

  if (hasChanges) {
    logger.info('Committing test fixes...');
    commitHash = await commitAllChanges(
      repoPath,
      'fix: fix sanity tests',
      coAuthor?.name,
      coAuthor?.email
    );

    if (commitHash) {
      logger.info('Test fixes committed', { commitHash });

      if (gitInfo.branch) {
        logger.info('Pushing test fix commit to remote...', { branch: gitInfo.branch });
        try {
          await pushCommits(repoPath, gitInfo.branch, gitInfo.repoUrl);
          logger.info('Test fix commit pushed successfully');
        } catch (error) {
          logger.error('Failed to push test fix commit', { error });
        }
      }
    }
  } else {
    logger.info('No uncommitted changes after test execution');
  }

  return { commitHash };
}

// =============================================================================
// VISUAL REGRESSION HELPERS
// =============================================================================

const VR_BUCKET_NAME = config.gcs.workflowVRBucketName;

/**
 * Find the latest visual-regression-screenshots directory from the test report.
 * Screenshots are stored in: {repoPath}/xyne-automation/report/{timestamp}/visual-regression-screenshots/
 * where {timestamp} can be:
 * - 'latest' (when REPORT_TIMESTAMP is not set)
 * - ISO timestamp like '2024-01-15T10-30-00-000Z'
 * - Commit hash (when CUSTOM_REPORT_NAME is set)
 */
export function findScreenshotDirectory(repoPath: string): string | null {
  const reportPath = path.join(repoPath, 'xyne-automation', 'report');

  if (!existsSync(reportPath)) {
    logger.warn('[VR] Report directory does not exist', { reportPath });
    return null;
  }

  // Get all directories in report path
  const allDirs = readdirSync(reportPath)
    .filter(f => {
      try {
        return statSync(path.join(reportPath, f)).isDirectory();
      } catch {
        return false;
      }
    });

  logger.info(`[VR] Found directories in report path: ${allDirs.join(', ') || '(none)'}`);

  if (allDirs.length === 0) {
    logger.warn('[VR] No directories found in report path');
    return null;
  }

  // Sort by modification time (most recent first)
  const sortedDirs = allDirs.sort((a, b) => {
    const statA = statSync(path.join(reportPath, a));
    const statB = statSync(path.join(reportPath, b));
    return statB.mtime.getTime() - statA.mtime.getTime();
  });

  // Find the first directory that has visual-regression-screenshots
  for (const dir of sortedDirs) {
    const screenshotsDir = path.join(reportPath, dir, 'visual-regression-screenshots');
    if (existsSync(screenshotsDir)) {
      const pngFiles = readdirSync(screenshotsDir).filter(f => f.endsWith('.png'));
      logger.info(`[VR] Found ${pngFiles.length} screenshots in ${screenshotsDir}`);
      if (pngFiles.length > 0) {
        return screenshotsDir;
      }
    }
  }

  logger.warn('[VR] No screenshots found in any report directory');
  return null;
}

/**
 * Copy all .png files from source directory to a safe temp directory.
 * This preserves screenshots before the next test run nukes the report dir.
 */
export async function copyScreenshotsToTempDir(
  sourceDir: string,
  tempDir: string
): Promise<number> {
  await fs.mkdir(tempDir, { recursive: true });

  const files = readdirSync(sourceDir).filter(f => f.endsWith('.png'));

  for (const file of files) {
    await fs.copyFile(
      path.join(sourceDir, file),
      path.join(tempDir, file)
    );
  }

  logger.info(`[VR] Copied ${files.length} screenshots from ${sourceDir} to ${tempDir}`);
  return files.length;
}

/**
 * Upload all .png files from a local directory to GCS under the given prefix.
 * e.g., prefix = "visual-regression/{executionId}/curr/"
 */
export async function uploadScreenshotsToGCS(
  localDir: string,
  gcsPrefix: string,
  executionId: string
): Promise<number> {
  const storageService = getStorageService(VR_BUCKET_NAME);

  // Ensure bucket exists before uploading (important for fake-gcs-server)
  try {
    logger.info(`[VR] Ensuring bucket exists: ${VR_BUCKET_NAME}`);
    await storageService.ensureBucketExists();
  } catch (error) {
    logger.error(`[VR] Failed to ensure bucket exists: ${VR_BUCKET_NAME}`, error);
    throw new Error(`Failed to ensure GCS bucket exists: ${error}`);
  }

  if (!existsSync(localDir)) {
    logger.warn(`[VR] Upload dir does not exist: ${localDir}`);
    return 0;
  }

  const files = readdirSync(localDir).filter(f => f.endsWith('.png'));
  let uploaded = 0;

  for (const file of files) {
    const filePath = path.join(localDir, file);
    const buffer = readFileSync(filePath);
    const gcsPath = `${gcsPrefix}${file}`;

    await storageService.uploadFileV2(buffer, {
      path: gcsPath,
      contentType: 'image/png',
      metadata: { executionId, sourceFile: file },
    });

    uploaded++;
  }

  logger.info(`[VR] Uploaded ${uploaded} screenshots to GCS prefix: ${gcsPrefix}`);
  return uploaded;
}

/**
 * Upload test reports (JSON, HTML, logs) from report directory to GCS
 */
export async function uploadTestReportsToGCS(
  reportDir: string,
  executionId: string
): Promise<number> {
  const storageService = getStorageService(VR_BUCKET_NAME);

  // Ensure bucket exists before uploading
  try {
    logger.info(`[VR] Ensuring bucket exists for reports: ${VR_BUCKET_NAME}`);
    await storageService.ensureBucketExists();
  } catch (error) {
    logger.error(`[VR] Failed to ensure bucket exists: ${VR_BUCKET_NAME}`, error);
    throw new Error(`Failed to ensure GCS bucket exists: ${error}`);
  }

  if (!existsSync(reportDir)) {
    logger.warn(`[VR] Report dir does not exist: ${reportDir}`);
    return 0;
  }

  // Find the latest report directory
  const entries = readdirSync(reportDir, { withFileTypes: true });
  const reportDirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a)); // Most recent first

  if (reportDirs.length === 0) {
    logger.warn(`[VR] No report directories found in: ${reportDir}`);
    return 0;
  }

  const latestReportDir = path.join(reportDir, reportDirs[0]);
  if (!existsSync(latestReportDir)) {
    logger.warn(`[VR] Latest report dir does not exist: ${latestReportDir}`);
    return 0;
  }

  // Upload report files (JSON, HTML, logs)
  const reportFiles = readdirSync(latestReportDir).filter(f => 
    f.endsWith('.json') || f.endsWith('.html') || f.endsWith('.log')
  );
  
  let uploaded = 0;
  const gcsPrefix = `workflow-artifacts/${executionId}/reports/`;

  for (const file of reportFiles) {
    const filePath = path.join(latestReportDir, file);
    const buffer = readFileSync(filePath);
    const gcsPath = `${gcsPrefix}${file}`;

    // Determine content type
    let contentType = 'application/octet-stream';
    if (file.endsWith('.json')) contentType = 'application/json';
    else if (file.endsWith('.html')) contentType = 'text/html';
    else if (file.endsWith('.log')) contentType = 'text/plain';

    await storageService.uploadFileV2(buffer, {
      path: gcsPath,
      contentType,
      metadata: { executionId, sourceFile: file, reportTimestamp: reportDirs[0] },
    });

    uploaded++;
  }

  logger.info(`[VR] Uploaded ${uploaded} test reports to GCS prefix: ${gcsPrefix}`);
  return uploaded;
}
