import { PushResult, simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import { rm, access, constants } from 'fs/promises';
import { logger } from './logger.js';

/**
 * Check if a directory exists
 * @param dirPath Path to the directory to check
 * @returns true if directory exists, false if it doesn't exist
 * @throws Error if directory exists but is inaccessible (permissions, I/O errors, etc.)
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, constants.F_OK);
    return true;
  } catch (error: any) {
    // Only return false if the error is specifically "file/directory not found"
    if (error?.code === 'ENOENT') {
      return false;
    }
    // For other errors (permissions, I/O, etc.), log and throw
    // This prevents us from trying to clone into a directory that exists but is inaccessible
    logger.error('Error checking directory existence', error, { dirPath });
    throw new Error(`Directory existence check failed for ${dirPath}: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Commit changes to a git repository
 * 
 * @param repoPath Path to the git repository
 * @param filePath Path to the file that was modified (relative to the repository root)
 * @param message Commit message
 * @param executionId Execution ID for logging
 * @returns Commit hash if successful, undefined otherwise
 */
export async function commitChanges(
  repoPath: string, 
  filePath: string, 
  message: string,
  executionId: string
): Promise<string | undefined> {
  try {
    // Initialize git with the repository path
    const git: SimpleGit = simpleGit(repoPath);

    // Get the relative file path
    const relativeFilePath = path.relative(repoPath, filePath);
    
    // Add the file
    await git.add(relativeFilePath);
    
    const commitOptions = { '--no-verify': null };
    const commitResult = await git.commit(message, undefined, commitOptions);
    
    // Get the commit hash
    const commitHash = commitResult.commit || '';
    
    if (commitHash) {
      logger.info('Git commit created successfully', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: relativeFilePath,
        commitHash,
        executionId
      });
      
      return commitHash;
    }
    
    return undefined;
  } catch (gitError) {
    logger.error('Git commit failed', gitError as Error, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      file_path: filePath,
      executionId
    });
    
    return undefined;
  }
}

/**
   * Clone a git repository and checkout/create a branch.
   * If the workspace already exists (from a previous agentic step), reuse it instead of cloning.
 * 
 * @param repoUrl URL of the repository to clone
 * @param executionId Execution ID used for temp directory naming
 * @param repoBranch Optional branch name to checkout or create
 * @param commitHash Optional commit hash to checkout (for continuation mode)
 * @returns Object containing the repository path and branch name
 */
export async function cloneRepository(
  repoUrl: string,
  executionId: string,
  baseBranch?: string,
  repoBranch?: string,
  commitHash?: string,
  checkoutCommit?: string
): Promise<{ repoPath: string; branchName: string }> {
  // Create a temp directory for cloning the repo
  const tempDir = `/tmp/${executionId}`;

  logger.info('Checking workspace existence', {
    workspacePath: tempDir,
    executionId,
    repoUrl
  });

  // Check if workspace already exists (from previous agentic step in same workflow)
  const workspaceExists = await directoryExists(tempDir);

  logger.info('Workspace existence check result', {
    workspacePath: tempDir,
    exists: workspaceExists,
    executionId
  });

  let git: SimpleGit;
  const branchName: string = repoBranch || `fix/devqa-xyne-${executionId}`;

  if (workspaceExists) {
    // Reuse existing workspace - just initialize git on the existing directory
    logger.info('Reusing existing workspace - skipping git clone', {
      repoPath: tempDir,
      executionId,
      branchName,
      repoBranch,
      baseBranch
    });
    
    git = simpleGit(tempDir);
    
    // Fetch latest changes from remote
    await git.fetch();
    
    // If repoBranch is specified and different from current, checkout to it
    // Otherwise stay on current branch (which should be the workflow's branch)
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    if (repoBranch && currentBranch !== branchName) {
      try {
        // Try to checkout existing branch
        await git.checkout(branchName);
      } catch {
        // Branch doesn't exist locally, try to checkout from origin
        try {
          await git.checkout(['-b', branchName, `origin/${repoBranch}`]);
        } catch {
          // Branch doesn't exist on origin either, create new
          await git.checkout(['-b', branchName]);
        }
      }
    }
  } else {
    // Fresh clone - workspace doesn't exist yet
    logger.info('Performing fresh git clone - workspace does not exist', {
      repoUrl,
      targetPath: tempDir,
      executionId,
      branchName,
      baseBranch,
      repoBranch
    });

    git = simpleGit();

    // Clone the repository and store the path
    await git.clone(repoUrl, tempDir);
    git = simpleGit(tempDir);

    logger.info('Git clone completed successfully', {
      repoPath: tempDir,
      executionId
    });

    await git.fetch();

    if (baseBranch) {
      await git.checkout(baseBranch); // checkout to base branch 
    }

    if (checkoutCommit || repoBranch) {
      const source = checkoutCommit || `origin/${repoBranch}`;
      try {
        await git.checkout(['-b', branchName, source]);
      } catch {
        await git.checkout(['-b', branchName]);
      }
    } else {
      await git.checkout(['-b', branchName]);
    }
  }

  // If a specific commit hash is provided (continuation mode), ensure we're on the branch
  // and at the right commit, but DON'T checkout the commit directly (avoids detached HEAD)
  if (commitHash) {
    try {
      await git.pull('origin', branchName);
      logger.info('Pulled latest changes for continuation, staying on branch', {
        commitHash,
        branchName,
        executionId
      });
    } catch (error) {
      logger.warn('Failed to pull latest changes, continuing with current branch state', {
        commitHash,
        branchName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  logger.info(workspaceExists ? 'Workspace reused successfully' : 'Repository cloned successfully', {
    repoUrl,
    repoPath: tempDir,
    branchName,
    executionId,
    commitHash: commitHash || 'branch head',
    workspaceReused: workspaceExists
  });

  return { repoPath: tempDir, branchName };
}

/**
 * Push commits to remote repository
 * 
 * @param repoPath Path to the git repository
 * @param branchName Branch name to push
 * @param repoUrl Repository URL for logging
 * @returns Object containing repository URL and pull request URL
 */
export async function pushCommits(
  repoPath: string,
  branchName: string,
  repoUrl?: string
): Promise<{
  repoUrl: string | undefined;
  pullRequestUrl: string | undefined;
} | undefined> {
  try {
    const git = simpleGit(repoPath);
    const pushResult: PushResult = await git.push(['--set-upstream', 'origin', branchName]);
    
    const repositoryUrl = pushResult.repo || repoUrl;
    const pullRequestUrl = pushResult.remoteMessages?.pullRequestUrl;
    
    const result = {
      repoUrl: repositoryUrl,
      pullRequestUrl
    };
    
    logger.info('Successfully pushed commits to repository', {
      ...result,
      branchName,
      repoPath
    });
    
    return result;
  } catch (error) {
    logger.error('Failed to push commits to repository', error as Error, {
      repoUrl,
      branchName,
      repoPath
    });
    throw error;
  }
}

/**
 * Check if there are any uncommitted changes in the repository
 * @param repoPath - Path to the git repository
 * @returns true if there are uncommitted changes, false otherwise
 */
export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(repoPath);
    const status = await git.status();
    
    // Check if there are any changes (staged, unstaged, or untracked files)
    return status.files.length > 0;
  } catch (error) {
    logger.error('Failed to check git status', error as Error, {
      repoPath
    });
    return false;
  }
}

/**
 * Commit all changes in the repository (staged and unstaged)
 * @param repoPath - Path to the git repository
 * @param commitMessage - Commit message
 * @returns commit hash if successful, undefined if failed
 */
export async function commitAllChanges(repoPath: string, commitMessage: string): Promise<string | undefined> {
  try {
    const git: SimpleGit = simpleGit(repoPath);
    
    // Add all files (including untracked)
    await git.add('.');
    
    // Check if there are any changes to commit after adding
    const status = await git.status();
    if (status.files.length === 0) {
      logger.info('No changes to commit', { repoPath });
      return undefined;
    }
    
    const commitOptions = { '--no-verify': null };
    const commitResult = await git.commit(commitMessage, undefined, commitOptions);
    const commitHash = commitResult.commit || '';
    
    if (commitHash) {
      logger.info('All changes committed successfully', {
        commitHash,
        repoPath,
        message: commitMessage
      });
      return commitHash;
    }
    
    return undefined;
  } catch (error) {
    logger.error('Failed to commit all changes', error as Error, {
      repoPath,
      message: commitMessage
    });
    return undefined;
  }
}

/**
 * Clean up temporary repository directory
 * 
 * @param repoPath Path to the repository to clean up
 */
export async function cleanupRepository(repoPath: string): Promise<void> {
  try {
    await rm(repoPath, { recursive: true, force: true });
    logger.info('Successfully cleaned up temporary repository', {
      repoPath
    });
  } catch (error) {
    logger.error('Failed to clean up temporary repository', error as Error, {
      repoPath
    });
    // Don't throw - cleanup failure shouldn't break the workflow
  }
}