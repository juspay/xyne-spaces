import { hasUncommittedChanges, commitAllChanges, pushCommits, CommandExecutor } from '@framework';
import { logger } from '@/utils/logger';
import { GitInfo } from '../workflow-types';
import * as fs from 'fs/promises';
import * as path from 'path';

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
 */
export async function runTestCases(repoPath: string): Promise<TestExecutionResult> {
  logger.info('Running test cases to validate functionality...');

  const testResult = await executeCommand(
    'OUTPUT_MODE=plain npm run test',
    `${repoPath}`
  );

  const passed = testResult.exitCode === 0;
  const output = `${testResult.stdout}\n${testResult.stderr}`;

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
