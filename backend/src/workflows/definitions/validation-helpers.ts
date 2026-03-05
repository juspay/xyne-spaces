import { hasUncommittedChanges, commitAllChanges, pushCommits, CommandExecutor } from '@framework';
import { logger } from '@/utils/logger';
import { GitInfo } from '../workflow-types';

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
