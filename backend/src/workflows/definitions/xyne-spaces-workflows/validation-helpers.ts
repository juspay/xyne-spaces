import { hasUncommittedChanges, commitAllChanges, CommandExecutor } from '@framework';
import { logger } from '@/utils/logger';
import { GitInfo } from '../../workflow-types';

const commandExecutor = new CommandExecutor();

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DeterministicValidationResult {
  passed: boolean;
  validationOutput: ExecutionResult;
  formatCommitHash?: string;
  errorLines: string[];
}

async function executeCommand(
  command: string,
  cwd: string
): Promise<ExecutionResult> {
  logger.info(`[cmd] Executing: ${command}`);
  try {
    return await commandExecutor.executeCommand({ command }, undefined, cwd);
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

export async function runDeterministicValidation(
  repoPath: string,
  gitInfo: GitInfo
): Promise<DeterministicValidationResult> {
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('Invalid repoPath: must be a non-empty string');
  }
  
  if (!gitInfo || typeof gitInfo !== 'object') {
    throw new Error('Invalid gitInfo: must be an object');
  }

  logger.info('Running deterministic validation steps...');

  // Step 1: Install dependencies in shared
  logger.info('Installing dependencies in shared...');
  await executeCommand('npm i', `${repoPath}/shared`);

  // Step 2: Install dependencies in dashboard
  logger.info('Installing dependencies in dashboard...');
  await executeCommand('npm i', `${repoPath}/dashboard`);

  // Step 3: Format code
  logger.info('Formatting code...');
  await executeCommand('npm run format', `${repoPath}/dashboard`);

  // Step 4: Stage and commit formatted files
  logger.info('Checking for formatting changes...');
  const hasChanges = await hasUncommittedChanges(repoPath);
  let formatCommitHash: string | undefined;
  
  if (hasChanges) {
    logger.info('Committing formatted files...');
    const commitHash = await commitAllChanges(
      repoPath,
      'chore: format code with prettier'
    );
    if (commitHash) {
      formatCommitHash = commitHash;
      Object.assign(gitInfo, { commitHash });
      logger.info('Formatted files committed', { commitHash });
    }
  } else {
    logger.info('No formatting changes to commit');
  }

  // Step 5: Run validation
  logger.info('Running validation...');
  const validationOutput = await executeCommand('npm run validate', `${repoPath}/dashboard`);
  
  // Check if validation passed (exit code 0 means success, no errors)
  const passed = validationOutput.exitCode === 0;

  // Extract only actual errors (not warnings) from the output
  const errorLines = extractErrorLines(validationOutput.stderr || validationOutput.stdout);

  return {
    passed,
    validationOutput,
    formatCommitHash,
    errorLines
  };
}
