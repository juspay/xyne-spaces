// =============================================================================
// CHECKPOINT HANDLERS
// =============================================================================

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { BuildResult, RunResult, TestResult, ConformanceResult, BoilerCodeResult } from './types';
import { TestDetail } from './types';
import { logger } from '@/utils/logger';
const execAsync = promisify(exec);

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Execute connector boilerplate code generation
 * Clones the repo, creates a branch, runs the add_connector.sh script,
 * and pushes the commit
 */
/**
 * Execute a command and stream output to console using line buffering and console.log
 * Supports shell-style commands with environment variables and quoted arguments
 */
async function execWithStreaming(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {}
): Promise<{ stdout: string; stderr: string }> {
  console.log(`[execWithStreaming] Spawning: ${command} ${args.join(' ')}`);

  return new Promise((resolve, reject) => {
    const useShell = options.shell !== false; // Default to true for compatibility
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
        // Use console.log for visibility in log collectors, trimming trailing newline to avoid double spacing
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) console.log(line);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        // Use console.error for visibility in log collectors
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) console.error(line);
        }
      });
    }

    child.on('close', (code) => {
      console.log(`[execWithStreaming] Process exited with code ${code}`);
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
      console.error(`[execWithStreaming] Spawn error:`, err);
      reject(err);
    });
  });
}

export const executeBoilerCode = async (
  repoURL: string,
  baseBranch: string | undefined, // Added baseBranch parameter
  connectorName: string,
  connectorBaseUrl: string
): Promise<BoilerCodeResult> => {
  const workingDirectory = `/tmp/boiler-${Date.now()}`;
  const branchName = `feature/xyne-${connectorName}-${Date.now()}`;

  try {
    // 1. Clone repo
    console.log(`📥 Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // Check out base branch if provided
    if (baseBranch) {
      console.log(`🌿 Checking out base branch: ${baseBranch}`);
      try {
        await execAsync(`git checkout ${baseBranch}`, { cwd: workingDirectory });
        console.log(`✅ Successfully checked out base branch: ${baseBranch}`);
      } catch (checkoutErr: any) {
        console.error(`❌ Failed to checkout base branch ${baseBranch}: ${checkoutErr.message}`);
        // Attempt to fetch and checkout remote branch
        try {
          console.log(`🔄 Attempting to fetch and checkout remote branch origin/${baseBranch}`);
          await execAsync(`git fetch origin ${baseBranch}`, { cwd: workingDirectory });
          await execAsync(`git checkout ${baseBranch}`, { cwd: workingDirectory });
          console.log(`✅ Successfully checked out remote base branch: ${baseBranch}`);
        } catch (remoteErr: any) {
          console.error(
            `❌ Failed to checkout remote base branch ${baseBranch}: ${remoteErr.message}`
          );
          throw new Error(`Failed to checkout base branch ${baseBranch}`);
        }
      }
    }

    // 2. Create and checkout new branch
    console.log(`🌿 Creating and checking out branch: ${branchName}`);
    await execAsync(`git checkout -b ${branchName}`, { cwd: workingDirectory });
    console.log(`✅ Successfully checked out branch: ${branchName}`);

    // 3. Locate the script dynamically
    console.log(`� Locating script: add_connector.sh`);
    const { stdout: findStdout } = await execAsync('find . -name "add_connector.sh" | head -n 1', {
      cwd: workingDirectory,
    });
    let relativeScriptPath = findStdout.trim();

    if (!relativeScriptPath) {
      // Fallback or extensive search
      console.log(`❌ Script not found with simple find, listing all files...`);
      await execAsync('find . -maxdepth 3 -not -path "*/.*"', { cwd: workingDirectory }).then(
        ({ stdout }) => console.log(stdout)
      );
      throw new Error(`Script add_connector.sh not found in the repository`);
    }

    // Ensure relative path starts with ./
    if (!relativeScriptPath.startsWith('./') && !relativeScriptPath.startsWith('/')) {
      relativeScriptPath = `./${relativeScriptPath}`;
    }

    console.log(`✅ Found script at: ${relativeScriptPath}`);

    // 4. Make the script executable
    const absoluteScriptPath = path.resolve(workingDirectory, relativeScriptPath);
    console.log(`🔐 Making script executable: ${absoluteScriptPath}`);
    await execAsync(`chmod +x "${absoluteScriptPath}"`);

    // 5. Run the connector generation script
    console.log(`🔨 Running connector generation script...`);
    console.log(`   Connector: ${connectorName}`);
    console.log(`   Base URL: ${connectorBaseUrl}`);

    // Use spawn for streaming output
    console.log(`   Script Path: ${absoluteScriptPath}`);

    const { stdout: scriptStdout, stderr: scriptStderr } = await execWithStreaming(
      absoluteScriptPath,
      [connectorName, connectorBaseUrl, '--force', '-y'],
      { cwd: workingDirectory }
    );

    const trimmedScriptStderr = scriptStderr.trim();
    const trimmedScriptStdout = scriptStdout.trim();

    // Check if script failed by looking for errors (simple check, exit code already handled by execWithStreaming)
    // keeping legacy check but it might be redundant if exit code was verified
    const scriptHasErrors =
      trimmedScriptStderr.toLowerCase().includes('failed') ||
      trimmedScriptStderr.toLowerCase().includes('fatal error');

    if (scriptHasErrors) {
      console.log(`❌ Script execution indicated potential errors even with exit code 0`);
      // check if it really failed or just printed failure words
      // Proceeding with caution
    }

    console.log(`✅ Script executed successfully`);
    // console.log(`📄 Script output:\n${trimmedScriptStdout}`); // Already streamed

    // 5. Commit the changes
    console.log(`💾 Committing changes...`);
    await execAsync('git add .', { cwd: workingDirectory });
    await execAsync(`git commit -m "Add connector ${connectorName}"`, { cwd: workingDirectory });
    console.log(`✅ Changes committed`);

    // 6. Push the branch
    console.log(`📤 Pushing branch to origin...`);
    await execAsync(`git push -u origin ${branchName}`, {
      cwd: workingDirectory,
    });
    console.log(`✅ Branch pushed successfully: ${branchName}`);

    return {
      success: true,
      output: trimmedScriptStdout,
      branchName,
      error: '',
      executedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error(`❌ Boilerplate code generation failed`, err);

    if (err.stdout) console.log('Checking stdout from error:', err.stdout);
    if (err.stderr) console.error('Checking stderr from error:', err.stderr);

    const errorMsg = [
      err.stdout ? err.stdout.trim() : '',
      err.stderr ? err.stderr.trim() : '',
      err.message ? err.message.trim() : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: false,
      output: err.stdout?.trim() || '',
      branchName,
      error: errorMsg,
      executedAt: new Date().toISOString(),
    };
  } finally {
    // Always cleanup the working directory
    try {
      console.log(`🧹 Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`⚠️  Cleanup failed: ${cleanupErr}`);
    }
  }
};
export const executeBuildCode = async (
  buildCommand: string,
  repoURL: string,
  repoBranch?: string
): Promise<BuildResult> => {

  // Create a unique subfolder under fido-workflow-test
  const workingDirectory = `/tmp/build-${Date.now()}`;

  try {
    // 1. Clone repo
    console.log(` Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // 2. Checkout branch if provided
    if (repoBranch) {
      console.log(` Attempting to checkout branch: ${repoBranch}`);
      try {
        // First try to checkout the branch directly
        await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
        console.log(` Successfully checked out branch: ${repoBranch}`);
      } catch (checkoutError) {
        console.log(` Branch ${repoBranch} not found locally, trying remote...`);
        try {
          // Try to checkout from remote
          await execAsync(`git checkout -b ${repoBranch} origin/${repoBranch}`, {
            cwd: workingDirectory,
          });
          console.log(` Successfully checked out remote branch: ${repoBranch}`);
        } catch (remoteError) {
          console.log(` Remote branch not found, creating new branch: ${repoBranch}`);
          try {
            // Create new branch
            await execAsync(`git checkout -b ${repoBranch}`, { cwd: workingDirectory });
            console.log(` Successfully created and checked out new branch: ${repoBranch}`);
          } catch (createError) {
            console.warn(` Failed to create branch ${repoBranch}, staying on default branch`);
            console.warn(`Checkout error details: ${checkoutError}`);
          }
        }
      }
    }

    // 3. Run  build with streaming
    console.log(` Running build...`);

    // Use shell execution for build commands to support env vars and quoted args
    const { stdout, stderr } = await execWithStreaming('/bin/sh', ['-c', buildCommand], {
      cwd: workingDirectory,
      shell: false, // Disable double shell wrapping since we're explicitly using /bin/sh
    });

    const trimmedStderr = stderr.trim();
    const trimmedStdout = stdout.trim();

    // Check if build failed by looking for errors in stderr
    // Common cargo/build error patterns include: "error:", "Compiling failed", etc.
    const buildHasErrors =
      trimmedStderr.toLowerCase().includes('error:') ||
      trimmedStderr.toLowerCase().includes('compiling failed') ||
      trimmedStderr.toLowerCase().includes('build failed');

    if (buildHasErrors) {
      console.log(` Build failed with errors`);
      return {
        success: false,
        output: trimmedStdout,
        workingDirectory: workingDirectory,
        error: trimmedStderr,
        executedAt: new Date().toISOString(),
      };
    }

    console.log(` Build completed successfully`);

    return {
      success: true,
      output: trimmedStdout,
      workingDirectory: workingDirectory,
      error: trimmedStderr,
      executedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error(` Cargo build process failed`);

    const errorMsg = [
      err.stdout ? err.stdout.trim() : '',
      err.stderr ? err.stderr.trim() : '',
      err.message ? err.message.trim() : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: false,
      output: err.stdout?.trim() || '',
      workingDirectory: workingDirectory,
      error: errorMsg,
      executedAt: new Date().toISOString(),
    };
  } finally {
    // Always cleanup the working directory
    // try {
    //   console.log(` Cleaning up ${workingDirectory}`);
    //   fs.rmSync(workingDirectory, { recursive: true, force: true });
    // } catch (cleanupErr) {
    //   console.warn(` Cleanup failed: ${cleanupErr}`);
    // }
  }
};

export const executeCargoRun = async (
  baseDir: string,
  repoURL: string,
  repoBranch?: string,
  timeoutMs: number = 10000 // default 10s timeout
): Promise<RunResult> => {
  console.log(` Starting cargo run process in ${baseDir}`);

  const workingDirectory = path.join(baseDir, `run-${Date.now()}`);

  try {
    // 1. Clone repo
    console.log(` Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // 2. Checkout branch if provided
    if (repoBranch) {
      console.log(` Checking out branch: ${repoBranch}`);
      await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
    }

    // 3. Run cargo run with timeout
    console.log(` Running cargo run...`);
    return await new Promise<RunResult>((resolve) => {
      const proc = exec('cargo run', { cwd: workingDirectory });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          resolve({
            success: false,
            output: stdout.trim(),
            error: `Timeout after ${timeoutMs}ms`,
            executedAt: new Date().toISOString(),
          });
        }
      }, timeoutMs);

      proc.stdout?.on('data', (data) => {
        stdout += data;
      });

      proc.stderr?.on('data', (data) => {
        stderr += data;
      });

      proc.on('close', (code) => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          resolve({
            success: code === 0,
            output: stdout.trim(),
            error: stderr.trim(),
            executedAt: new Date().toISOString(),
          });
        }
      });

      proc.on('error', (err) => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          resolve({
            success: false,
            output: stdout.trim(),
            error: err.message,
            executedAt: new Date().toISOString(),
          });
        }
      });
    });
  } catch (err: any) {
    console.error(` Cargo run process failed`);
    return {
      success: false,
      output: err.stdout?.trim() || '',
      error: err.message?.trim() || 'Unknown error',
      executedAt: new Date().toISOString(),
    };
  } finally {
    try {
      console.log(` Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(` Cleanup failed: ${cleanupErr}`);
    }
  }
};

/**
 * Execute cargo test and return results
 */

export const executeCargoTest = async (
  baseDir: string, // parent folder like /Users/.../fido-workflow-test
  repoURL: string,
  repoBranch?: string
): Promise<TestResult> => {
  logger.info(`🧪 Starting cargo test process in ${baseDir}`);

  // Create a unique working directory
  const workingDirectory = path.join(baseDir, `test-${Date.now()}`);

  try {
    // 1. Clone repo
    console.log(` Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // 2. Checkout branch if provided
    if (repoBranch) {
      console.log(` Checking out branch: ${repoBranch}`);
      await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
    }

    // 3. Run cargo test
    console.log(` Running cargo test...`);
    const { stdout, stderr } = await execAsync('cargo test -- --nocapture', {
      cwd: workingDirectory,
    });

    console.log(` Cargo tests executed successfully`);

    // Extract summary
    const summaryMatch = stdout.match(
      /test result: (\w+). (\d+) passed; (\d+) failed;.*?;.*?finished in/
    );
    let testsPassed = 0,
      testsFailed = 0,
      testsRun = 0;

    if (summaryMatch) {
      testsPassed = parseInt(summaryMatch[2], 10);
      testsFailed = parseInt(summaryMatch[3], 10);
      testsRun = testsPassed + testsFailed;
    }

    return {
      success: testsFailed === 0,
      output: stdout.trim(),
      error: stderr.trim(),
      testsRun,
      testsPassed,
      testsFailed,
      coverage: undefined, // could be integrated later with cargo-tarpaulin
      executedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error(` Cargo tests failed`);

    const errorMsg = [
      err.stdout ? err.stdout.trim() : '',
      err.stderr ? err.stderr.trim() : '',
      err.message ? err.message.trim() : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      success: false,
      output: err.stdout?.trim() || '',
      error: errorMsg,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      coverage: undefined,
      executedAt: new Date().toISOString(),
    };
  } finally {
    // Always cleanup
    try {
      console.log(` Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(` Cleanup failed: ${cleanupErr}`);
    }
  }
};

/**
 * Helper function to sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute remote FIDO conformance testing using async job pattern with polling
 */
export async function runTestScripts(
  testDetails: TestDetail,
  workingDirectory: string
): Promise<ConformanceResult> {
  const { filename, command, parameters } = testDetails;

  const scriptPath = path.resolve(__dirname, 'test-scripts', filename);

  // Ensure script exists
  try {
    await fs.promises.access(scriptPath, fs.constants.F_OK);
  } catch {
    return {
      success: false,
      output: `Test script not found: ${scriptPath}`,
    };
  }

  // Create temporary output file for test results (second arg for scripts that need it)
  const testOutputFile = path.join('/tmp', `fido-test-results-${Date.now()}.json`);

  // Generic command: command script.cjs [outputFile] param1 param2 ...
  // Insert outputFile as first parameter for scripts that expect it
  const scriptArgs = [workingDirectory, testOutputFile, ...parameters]
    .map((p) => {
      // If the parameter is an object (e.g. credentials), JSON-stringify it
      const str = typeof p === 'object' ? JSON.stringify(p) : String(p);
      return `"${str.replace(/"/g, '\\"')}"`;
    })
    .join(' ');
  const fullCommand = `${command} "${scriptPath}" ${scriptArgs}`;

  console.log(` Running test command`);
  console.log(` Output file: ${testOutputFile}`);
  console.log(` Parameters: ${parameters.join(', ')}`);
  console.log(` ${fullCommand}`);

  try {
    // Use shell execution for test commands to support env vars and quoted args
    const { stdout } = await execWithStreaming('/bin/sh', ['-c', fullCommand], {
      env: process.env,
      cwd: path.dirname(scriptPath),
      shell: false, // Disable double shell wrapping since we're explicitly using /bin/sh
    });

    // Try to read results from the output file if it exists
    let resultOutput = stdout;
    let resultStatus = false;
    try {
      if (fs.existsSync(testOutputFile)) {
        console.log(` Reading results from file: ${testOutputFile}`);
        const fileContent = fs.readFileSync(testOutputFile, 'utf8');
        const fileResults = JSON.parse(fileContent);
        resultOutput = fileResults.output || fileContent;
        resultStatus = fileResults.success || false;
        console.log(`the output form the file is :`, fileResults.output);
        console.log(`📊 Read result: ${resultOutput}`);
        // Clean up temp file
        fs.unlinkSync(testOutputFile);
      } else {
        console.log(` Results file not found, using stdout/stderr`);
      }
    } catch (readError) {
      // If we can't read the file, just use stdout/stderr
      console.log(` Could not read results file, using stdout: ${readError}`);
    }

    return {
      success: resultStatus,
      output: resultOutput,
    };
  } catch (error: any) {
    console.error(` Test execution failed: ${error.message}`);
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
    };
  }
}

/**
 * Execute local testing by triggering entry-point.ts directly (same as mac-agent-server.js)
 */
export async function executeLocalTesting(
  repoURL: string,
  repoBranch: string,
  testDetails: TestDetail,
  workingDirectory: string
): Promise<ConformanceResult> {
  const executionId = `exec-local-${Date.now()}`;
  console.log(` Starting local conformance testing`);
  console.log(`   Repo: ${repoURL}@${repoBranch}`);
  console.log(`   Execution ID: ${executionId}`);

  try {
    const result = await runTestScripts(testDetails, workingDirectory);
    return result;
  } catch (error: any) {
    console.error(` [${executionId}] Local execution failed: ${error.message}`);

    return {
      success: false,
      output: `Local execution failed: ${error.message}`,
    };
  }
}

export async function executeRemoteConformanceTesting(
  testDetails: TestDetail,
  repoURL: string,
  repoBranch: string
): Promise<ConformanceResult> {
  const executionId = `exec-${Date.now()}`;
  console.log(` Starting remote FIDO conformance testing using async job pattern`);
  console.log(`   Repo: ${repoURL}@${repoBranch}`);
  console.log(`   Execution ID: ${executionId}`);

  // Get ngrok URL from environment variable or use default
  const ngrokUrl = process.env.FIDO_NGROK_URL || 'http://localhost:3000';

  if (ngrokUrl === 'https://dreama-unturning-elizbeth.ngrok-free.dev') {
    console.warn(' Using default ngrok URL. Please set FIDO_NGROK_URL environment variable.');
  }

  const maxPollAttempts = 50; // Maximum poll attempts (approx 12.5 minutes with 15s interval)
  const pollInterval = 15000; // 15 seconds between polls

  try {
    // STEP 1: Start the job
    console.log(` [STEP 1] Starting job at: ${ngrokUrl}/run-fido`);

    const requestPayload = {
      testDetails,
      repoURL,
      repoBranch,
      executionId,
    };

    const startResponse = await fetch(`${ngrokUrl}/run-fido`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Xyne-FIDO-Workflow/1.0',
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(30000), // 30 second timeout for initial request
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      throw new Error(`Failed to start job: HTTP ${startResponse.status}: ${errorText}`);
    }

    const startData = (await startResponse.json()) as { jobId: string };
    const jobId = startData.jobId;

    if (!jobId) {
      throw new Error('No jobId returned from Mac agent');
    }

    console.log(` [STEP 1] Job started successfully with ID: ${jobId}`);

    // STEP 2: Poll for job completion
    console.log(
      ` [STEP 2] Polling job status (max ${maxPollAttempts} attempts, every ${pollInterval}ms)`
    );

    let attempts = 0;
    let jobStatus = 'queued';
    let lastProgress = '';

    while (attempts < maxPollAttempts) {
      attempts++;

      const statusResponse = await fetch(`${ngrokUrl}/run-fido/status/${jobId}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Xyne-FIDO-Workflow/1.0',
        },
        signal: AbortSignal.timeout(30000), // 30 second timeout for status check
      });

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        throw new Error(`Failed to get job status: HTTP ${statusResponse.status}: ${errorText}`);
      }

      const statusData = (await statusResponse.json()) as { status: string; progress?: string };
      jobStatus = statusData.status;

      // Log progress updates
      if (statusData.progress && statusData.progress !== lastProgress) {
        console.log(` [ATTEMPT ${attempts}/${maxPollAttempts}] ${statusData.progress}`);
        lastProgress = statusData.progress;
      }

      // Check if job is complete
      if (jobStatus === 'completed' || jobStatus === 'failed') {
        console.log(` [STEP 2] Job ${jobStatus} after ${attempts} attempts`);
        break;
      }

      // Wait before next poll
      await sleep(pollInterval);
    }

    if (attempts >= maxPollAttempts) {
      throw new Error(
        `Job timed out after ${maxPollAttempts * pollInterval}ms (max polling attempts exceeded)`
      );
    }

    // STEP 3: Fetch the result
    console.log(` [STEP 3] Fetching job result from: ${ngrokUrl}/run-fido/result/${jobId}`);

    const resultResponse = await fetch(`${ngrokUrl}/run-fido/result/${jobId}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Xyne-FIDO-Workflow/1.0',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout for result fetch
    });

    if (!resultResponse.ok) {
      const errorText = await resultResponse.text();
      throw new Error(`Failed to get job result: HTTP ${resultResponse.status}: ${errorText}`);
    }

    const resultData = (await resultResponse.json()) as {
      success: boolean;
      result?: ConformanceResult;
      error?: string;
      completedAt?: string;
    };

    if (!resultData.success) {
      console.error(` Remote job failed with error: ${resultData.error}`);
    }

    const conformanceResult = resultData.result || {
      success: false,
      output: resultData.error || 'Unknown error',
    };

    console.log(` Remote conformance testing completed successfully`);
    console.log(` Remote conformance results:`);
    console.log(`   Success: ${conformanceResult.success}`);
    console.log(`   Output: ${conformanceResult.output}`);
    console.log(`   Total Attempts: ${attempts}`);
    console.log(`   Completed At: ${resultData.completedAt}`);

    return conformanceResult;
  } catch (httpError: any) {
    console.error(` Remote conformance testing failed: ${httpError.message}`);

    // Handle different types of HTTP errors
    let errorDetails = httpError.message;

    if (httpError.name === 'AbortError' || httpError.name === 'TimeoutError') {
      errorDetails = 'Remote execution timeout - operation took longer than expected';
    } else if (
      httpError.message.includes('fetch failed') ||
      httpError.message.includes('ENOTFOUND')
    ) {
      errorDetails = `Mac agent unreachable - check ngrok URL: ${ngrokUrl}`;
    } else if (httpError.message.includes('ECONNREFUSED')) {
      errorDetails = 'Connection refused - Mac agent server may be down';
    } else if (httpError.message.includes('HTTP 404')) {
      errorDetails = 'Mac agent endpoint not found - check server is running';
    } else if (httpError.message.includes('HTTP 500')) {
      errorDetails = 'Mac agent internal error - check server logs';
    }

    // Check if it's a build or server error from the Mac agent response
    if (httpError.message.includes('Build failed:')) {
      throw new Error(httpError.message);
    } else if (httpError.message.includes('Server startup failed:')) {
      throw new Error(httpError.message);
    }

    return {
      success: false,
      output: `Remote HTTP execution failed: ${errorDetails}\nNgrok URL: ${ngrokUrl}\nOriginal error: ${httpError.message}`,
    };
  }
}

/**
 * Runs 'diesel migration run' and then 'cargo run' as a background process.
 * Returns the process handle to be killed later.
 */
export const executeMigrateAndCargoRunInBackground = async (
  workingDirectory: string
): Promise<{ success: boolean; process?: ChildProcess; error?: string }> => {
  try {
    console.log(' Checking and creating fido_server database...');
    try {
      const env = { ...process.env, DATABASE_URL: 'postgres://localhost/fido_server' };

      // Check if database exists, if not create it
      console.log(' Checking if fido_server database exists...');
      try {
        await execAsync(
          'psql -d postgres -c "SELECT 1 FROM pg_database WHERE datname=\'fido_server\'" | grep -q 1',
          { env }
        );
        console.log(' fido_server database already exists');
      } catch (checkErr) {
        logger.info('📦 Creating fido_server database (does not exist)...');
        await execAsync('createdb fido_server', { env });
        console.log(' fido_server database created successfully');
      }
    } catch (dbErr: any) {
      console.error(` Database setup failed: ${dbErr.message}`);
      return {
        success: false,
        error: `Database setup failed: ${dbErr.message}`,
      };
    }

    console.log(' Checking and freeing port 8080...');
    try {
      // Find and kill processes using port 8080
      const { stdout } = await execAsync('lsof -ti:8080');
      if (stdout.trim()) {
        const pids = stdout.trim().split('\n');
        for (const pid of pids) {
          await execAsync(`kill -9 ${pid}`);
          logger.info(`🔪 Killed process ${pid} using port 8080`);
        }
        // Wait a moment for processes to fully terminate
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (portErr) {
      // No process found on port 8080, which is fine
      console.log(' Port 8080 is already free');
    }

    console.log(' Launching cargo run in the background...');
    const serverProcess = spawn('cargo', ['run'], {
      cwd: workingDirectory,
      detached: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://localhost/fido_server',
      },
    });

    // A small delay to allow the server to start up.
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log(` Server process started in background with PID: ${serverProcess.pid}`);
    return { success: true, process: serverProcess };
  } catch (err: any) {
    console.error(` Cargo background run process failed: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Legacy SSH-based remote conformance testing (kept for fallback)
 */
export async function executeFIDOAutomationScript(
  appBinaryPath: string = '/Applications/FIDO Alliance - Certification Conformance Testing Tools.app/Contents/MacOS/FIDO Alliance - Certification Conformance Testing Tools',
  baseDir: string,
  repoURL: string,
  repoBranch?: string
): Promise<ConformanceResult> {
  // This function will be used for local execution when not using remote client
  // For distributed execution, use executeRemoteConformanceTesting instead

  logger.info(`🤖 Local FIDO automation execution not implemented yet`);
  logger.info(
    `Parameters: appBinaryPath=${appBinaryPath}, baseDir=${baseDir}, repoURL=${repoURL}, repoBranch=${repoBranch}`
  );

  return {
    success: false,
    output:
      'Local FIDO automation not implemented - use distributed execution via executeRemoteConformanceTesting',
  };
}
export async function executeFinalLocalTesting(gitrepoUrl: string, gitBranch: string, requirementAnalysis: string,testing_url: string): Promise<ConformanceResult> {
  logger.info(`🚀 Starting final local testing with repo: ${gitrepoUrl} and branch: ${gitBranch}`);
  const testURL = testing_url || 'http://localhost:3000';

  try {
    const response = await fetch(`${testURL}/run-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Xyne-FIDO-Workflow/1.0' },
      body: JSON.stringify({ gitrepoUrl, gitBranch, requirementAnalysis }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, output: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as { msg?: string; error?: string };

    if (data.msg === 'start') {
      return { success: true, output: 'Local testing started successfully' };
    } else {
      return { success: false, output: data.error || data.msg || 'Unexpected response from /run-local' };
    }
  } catch (err: any) {
    logger.error(`Final local testing failed: ${err.message}`);
    return { success: false, output: `Final local testing failed: ${err.message}` };
  }
}