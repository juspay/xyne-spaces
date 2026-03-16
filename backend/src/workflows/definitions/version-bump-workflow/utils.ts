import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '@/utils/logger';
import { JiraTicketResult } from './types';
import { config } from '@/config/env';
import { bitbucketManager } from '../../../bitbucket/apis';

export const REPOSITORY_URL_MAP: Record<string, string> = {
  'euler-api-cards': 'ssh://git@github.com/example-org/euler-api-cards.git',
  'euler-api-txns': 'ssh://git@github.com/example-org/euler-api-txns.git',
  'euler-api-order': 'ssh://git@github.com/example-org/euler-api-order.git',
  'euler-api-gateway': 'ssh://git@github.com/example-org/euler-api-gateway.git',
  'euler-api-token': 'ssh://git@github.com/example-org/euler-api-token.git',
  'euler-api-pre-txn': 'ssh://git@github.com/example-org/euler-api-pre-txn.git',
  'euler-api-customer': 'ssh://git@github.com/example-org/euler-api-customer.git',
  'euler-api-dashboard': 'ssh://git@github.com/example-org/euler-api-dashboard.git',
};

const execAsync = promisify(exec);

/**
 * Execute a command and stream output to console using line buffering and console.log
 */
async function execWithStreaming(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {}
): Promise<{ stdout: string; stderr: string }> {
  logger.info(`[execWithStreaming] Spawning: ${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const useShell = options.shell !== false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) logger.info(line);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) logger.error(line);
        }
      });
    }

    child.on('close', (code) => {
      logger.info(`[execWithStreaming] Process exited with code ${code}`);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command failed with exit code ${code}`);
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      }
    });

    child.on('error', (err) => {
      logger.error(`[execWithStreaming] Spawn error:`, err);
      reject(err);
    });
  });
}

/**
 * Creates a JIRA ticket for the version bump.
 */
export const createJiraTicket = async (dependencyName: string, version: string, email: string, repositoryName: string): Promise<JiraTicketResult> => {
  logger.info(`Creating JIRA ticket for ${dependencyName} bump to ${version} on behalf of ${email} for ${repositoryName}`);
  
  try {
    const { baseUrl, eulerBotEmail, eulerBotAuthToken } = config.jira;
    
    if (!baseUrl || !eulerBotEmail || !eulerBotAuthToken) {
      throw new Error('JUSPAY_JIRA_BASEURL, JIRA_EULER_BOT_EMAIL, or JIRA_EULER_BOT_AUTH_TOKEN is not configured');
    }

    const authHeader = `Basic ${Buffer.from(`${eulerBotEmail}:${eulerBotAuthToken}`).toString('base64')}`;

    // 1. Fetch Account ID
    logger.info(`🔍 Fetching JIRA account ID for email: ${email}`);
    const searchRes = await fetch(`${baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader
      }
    });

    let accountId: string | undefined;
    
    if (!searchRes.ok) {
      const errorText = await searchRes.text();
      logger.error(`Failed to fetch user from JIRA (status ${searchRes.status}): ${errorText}`);
    } else {
      const userData = await searchRes.json();
      if (!Array.isArray(userData) || userData.length === 0) {
        logger.error(`No JIRA account found for email: ${email}`);
      } else {
        accountId = userData[0].accountId;
        logger.info(`✅ Found JIRA account ID: ${accountId}`);
      }
    }

    // 2. Create the actual Jira Ticket
    logger.info(`📝 Creating JIRA ticket...`);
    const issuePayload: any = {
      fields: {
        project: {
          id: "10011"
        },
        issuetype: {
          id: "10035"
        },
        summary: `Update version of ${dependencyName} to ${version} <> ${repositoryName}`,
        description: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `Auto-generated ticket for bumping ${dependencyName} to ${version}.`
                }
              ]
            }
          ]
        },
        customfield_10139: {
          id: "12058",
          value: "Enhancement in Existing Feature"
        },
        customfield_12117: [
          {
            id: "16037",
            value: "EULER"
          }
        ]
      }
    };

    if (accountId) {
      issuePayload.fields.assignee = {
        id: accountId
      };
    }

    const createRes = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(issuePayload)
    });

    if (!createRes.ok) {
      const createErrorText = await createRes.text();
      throw new Error(`Failed to create JIRA ticket (status ${createRes.status}): ${createErrorText}`);
    }

    const ticketData = await createRes.json() as any;
    logger.info(`Successfully created JIRA ticket: ${ticketData.key}`);
    
    return {
      success: true,
      ticketId: ticketData.key
    };
  } catch (error: any) {
    logger.error(`Failed to create JIRA ticket: ${error.message}`);
    return {
      success: false,
      ticketId: '',
      error: error.message
    };
  }
};

/**
 * Clone the repository and checkout the latest staging branch
 */
export const cloneAndCheckoutStaging = async (
  repoURL: string,
  workingDirectory: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    logger.info(`📥 Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    logger.info(`🌿 Fetching remote branches`);
    await execAsync(`git fetch origin`, { cwd: workingDirectory });

    // Try checking out staging, fallback to main/master if staging doesn't exist
    try {
      logger.info(`🌿 Checking out staging branch`);
      await execAsync(`git checkout staging`, { cwd: workingDirectory });
      logger.info(`✅ Successfully checked out staging branch`);
    } catch (checkoutErr: any) {
      logger.warn(`⚠️ Staging branch not found or checkout failed: ${checkoutErr.message}`);
      logger.info(`🔄 Falling back to main/master branch`);
      // It's already on the default branch after clone, just pull latest
      await execAsync(`git pull`, { cwd: workingDirectory });
    }

    return { success: true };
  } catch (error: any) {
    logger.error(`❌ Failed to clone and checkout: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Creates a new branch for the version bump
 */
export const createBranch = async (
  workingDirectory: string,
  jiraTicket: string,
  dependencyName: string,
  version: string
): Promise<{ success: boolean; branchName: string; error?: string }> => {
  const branchName = `${jiraTicket}-${dependencyName}-${version}-bump`.replace(/[^a-zA-Z0-9-]/g, '-');
  
  try {
    logger.info(`🌿 Creating and checking out new branch: ${branchName}`);
    await execAsync(`git checkout -b ${branchName}`, { cwd: workingDirectory });
    logger.info(`✅ Successfully checked out branch: ${branchName}`);
    
    return { success: true, branchName };
  } catch (error: any) {
    logger.error(`❌ Failed to create branch: ${error.message}`);
    return { success: false, branchName: '', error: error.message };
  }
};

/**
 * Updates the version of the dependency in flake.nix
 */
export const updateFlakeNix = async (
  workingDirectory: string,
  dependencyName: string,
  version: string
): Promise<{ success: boolean; error?: string }> => {
  const flakeNixPath = path.join(workingDirectory, 'flake.nix');
  
  try {
    if (!fs.existsSync(flakeNixPath)) {
      throw new Error(`flake.nix not found in ${workingDirectory}`);
    }

    logger.info(`📝 Updating ${dependencyName} version to ${version} in flake.nix`);
    let content = fs.readFileSync(flakeNixPath, 'utf8');

    // Handle different types of dependency declarations in flake.nix
    
    // 1. Case: Git ref update (e.g., ref = "refs/tags/10.5.32";)
    const refRegex = new RegExp(`(${dependencyName}\\s*=\\s*{[^}]*?ref\\s*=\\s*")(refs/tags/[^"]+|[^"]+)(";)`, 'gs');
    
    // 2. Case: URL ref update (e.g., euler-api-order = { url = "...?ref=staging" })
    const urlRefRegex = new RegExp(`(${dependencyName}(?:\\.url|\\s*=\\s*{[^}]*?url)\\s*=\\s*"[^"?]+\\?ref=)([^"]+)(".*?;)`, 'gs');
    
    // 3. Case: GitHub rev update (e.g., github:juspay/spider/fcb5...)
    const githubRevRegex = new RegExp(`(${dependencyName}\\s*=\\s*{\\s*url\\s*=\\s*"github:[^/]+/[^/]+/)([^"]+)(";)`, 'gs');

    let updated = false;

    if (refRegex.test(content)) {
      content = content.replace(refRegex, (_match: string, prefix: string, oldRef: string, suffix: string) => {
        updated = true;
        // If it starts with refs/tags/, preserve that prefix
        const newRef = oldRef.startsWith('refs/tags/') ? `refs/tags/${version}` : version;
        logger.info(`Replaced ref ${oldRef} with ${newRef}`);
        return `${prefix}${newRef}${suffix}`;
      });
    } 
    
    if (!updated && urlRefRegex.test(content)) {
      content = content.replace(urlRefRegex, (_match: string, prefix: string, oldRef: string, suffix: string) => {
        updated = true;
        logger.info(`Replaced url ref ${oldRef} with ${version}`);
        return `${prefix}${version}${suffix}`;
      });
    }
    
    if (!updated && githubRevRegex.test(content)) {
      content = content.replace(githubRevRegex, (_match: string, prefix: string, oldRev: string, suffix: string) => {
        updated = true;
        logger.info(`Replaced github rev ${oldRev} with ${version}`);
        return `${prefix}${version}${suffix}`;
      });
    }

    if (!updated) {
      // Fallback: Try a simpler sed-like replacement via a custom script if regexes fail
      logger.warn(`⚠️ Regex replacements didn't match anything. Dependency might have a different format or be missing.`);
      
      // Let's create and run a python script that does AST-based or safer structural replacement if needed
      // For this workflow, throwing an error is safer than silently failing
      throw new Error(`Could not find a recognized pattern for dependency ${dependencyName} in flake.nix`);
    }

    fs.writeFileSync(flakeNixPath, content);
    logger.info(`✅ Successfully updated flake.nix`);
    
    return { success: true };
  } catch (error: any) {
    logger.error(`❌ Failed to update flake.nix: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Run 'nix flake update' to generate the lockfile
 */
export const updateFlakeLock = async (
  workingDirectory: string,
  dependencyName: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    logger.info(`🔒 Updating flake.lock for ${dependencyName}`);
    
    // Using execWithStreaming to get real-time output and handle potential long-running commands
    await execWithStreaming('nix', ['flake', 'update', dependencyName], { 
      cwd: workingDirectory 
    });
    
    logger.info(`✅ Successfully updated flake.lock`);
    return { success: true };
  } catch (error: any) {
    logger.error(`❌ Failed to update flake.lock: ${error.message}`);
    
    // Try without specific input if it fails (sometimes dependency names in inputs don't match the attribute name)
    try {
      logger.info(`🔄 Falling back to generic flake lock update`);
      await execWithStreaming('nix', ['flake', 'lock'], { cwd: workingDirectory });
      logger.info(`✅ Successfully updated flake.lock (generic)`);
      return { success: true };
    } catch (fallbackError: any) {
      return { success: false, error: error.message || fallbackError.message };
    }
  }
};

/**
 * Commit changes and push to origin
 */
export const commitAndPush = async (
  workingDirectory: string,
  branchName: string,
  jiraTicket: string,
  dependencyName: string,
  version: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    logger.info(`💾 Committing and pushing changes...`);
    
    await execAsync('git add flake.nix flake.lock', { cwd: workingDirectory });
    
    const commitMessage = `${jiraTicket} | Updated dependency ${dependencyName} with version ${version}`;
    await execAsync(`git commit -m "${commitMessage}"`, { cwd: workingDirectory });
    logger.info(`✅ Changes committed with message: "${commitMessage}"`);

    logger.info(`📤 Pushing branch to origin...`);
    await execAsync(`git push -u origin ${branchName}`, { cwd: workingDirectory });
    logger.info(`✅ Branch pushed successfully: ${branchName}`);
    
    return { success: true };
  } catch (error: any) {
    logger.error(`❌ Committing or pushing failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Raise a Pull Request via Bitbucket API
 */
export const raisePullRequest = async (
  workflowExecutionId: string,
  repoUrl: string,
  branchName: string,
  jiraTicket: string,
  dependencyName: string,
  version: string,
  email: string
): Promise<{ success: boolean; prUrl?: string; error?: string }> => {
  try {
    logger.info(`🔄 Raising Pull Request for ${branchName}...`);

    // Extract project/repo from URL
    // Format options: 
    // - ssh://git@github.com/example-org/repo.git
    // - https://bitbucket.example.com/scm/PROJECT/repo.git
    let projectName = '';
    let repoName = '';

    const pathMatch = repoUrl.match(/([^/]+)\/([^/]+)(?:\.git)?$/);
    if (!pathMatch) {
      throw new Error(`Could not parse project and repo from URL: ${repoUrl}`);
    }
    projectName = pathMatch[1].toUpperCase();
    repoName = pathMatch[2].replace(/\.git$/, '');

    const ticketTitle = `Updated dependency ${dependencyName} to ${version}`;
    const ticketDescription = `## Description\nAuto-generated PR bumping \`${dependencyName}\` to version \`${version}\`.\n\nPR Raised on behalf of @"${email}"\n\nAssociated JIRA Ticket: ${jiraTicket}`;
    
    // The target branch is typically staging.
    // If staging wasn't the default in the clone fallback, it's safer to use 'staging'.
    const destinationBranch = 'staging';

    const prUrl = await bitbucketManager.raisePr(
      repoUrl,
      workflowExecutionId,
      destinationBranch,
      branchName,
      projectName,
      repoName,
      ticketTitle,
      ticketDescription,
      jiraTicket, // xyneId
      jiraTicket  // ticketId
    );

    if (!prUrl) {
      throw new Error('Bitbucket API returned an empty or undefined PR URL');
    }

    logger.info(`✅ Successfully raised Pull Request: ${prUrl}`);
    return { success: true, prUrl };
  } catch (error: any) {
    logger.error(`❌ Failed to raise pull request: ${error.message}`);
    return { success: false, error: error.message };
  }
};
