// =============================================================================
// CHECKPOINT HANDLERS
// =============================================================================

import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import * as net from 'net'
import * as path from 'path'
import * as fs from 'fs'
import { BuildResult, RunResult, TestResult, ConformanceResult, HealthCheckResult } from './types'
import { runHealthChecks } from './health-check'
import {logger} from '@/utils/logger';

const execAsync = promisify(exec)

/**
 * Execute cargo build and return results
 */
export const executeCargoBuild = async (
  baseDir: string, // parent folder like /Users/.../fido-workflow-test
  repoURL: string,
  repoBranch?: string
): Promise<BuildResult> => {
  logger.info(`🦀 Starting build process in ${baseDir}`);

  // Create a unique subfolder under fido-workflow-test
  const workingDirectory = path.join(baseDir, `build-${Date.now()}`);

  try {
    // 1. Clone repo
    logger.info(`📥 Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // 2. Checkout branch if provided
    if (repoBranch) {
      logger.info(`🌿 Attempting to checkout branch: ${repoBranch}`);
      try {
        // First try to checkout the branch directly
        await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
        logger.info(`✅ Successfully checked out branch: ${repoBranch}`);
      } catch (checkoutError) {
        logger.info(`⚠️ Branch ${repoBranch} not found locally, trying remote...`);
        try {
          // Try to checkout from remote
          await execAsync(`git checkout -b ${repoBranch} origin/${repoBranch}`, { cwd: workingDirectory });
          logger.info(`✅ Successfully checked out remote branch: ${repoBranch}`);
        } catch (remoteError) {
          logger.info(`⚠️ Remote branch not found, creating new branch: ${repoBranch}`);
          try {
            // Create new branch
            await execAsync(`git checkout -b ${repoBranch}`, { cwd: workingDirectory });
            logger.info(`✅ Successfully created and checked out new branch: ${repoBranch}`);
          } catch (createError) {
            logger.warn(`⚠️ Failed to create branch ${repoBranch}, staying on default branch`);
            logger.warn(`Checkout error details: ${checkoutError}`);
          }
        }
      }
    }

    // 3. Run cargo build
    logger.info(`⚙️ Running cargo build...`);
    const { stdout, stderr } = await execAsync("cargo build", {
      cwd: workingDirectory,
    });

    logger.info(`✅ Cargo build completed successfully`);

    return {
      success: true,
      output: stdout.trim(),
      error: stderr.trim(),
      executedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    logger.error(`❌ Cargo build process failed`);

    const errorMsg = [
      err.stdout ? err.stdout.trim() : "",
      err.stderr ? err.stderr.trim() : "",
      err.message ? err.message.trim() : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: false,
      output: err.stdout?.trim() || "",
      error: errorMsg,
      executedAt: new Date().toISOString(),
    };
  } finally {
    // Always cleanup the working directory
    try {
      logger.info(`🧹 Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.warn(`⚠️ Cleanup failed: ${cleanupErr}`);
    }
  }
};


export const executeCargoRun = async (
  baseDir: string,
  repoURL: string,
  repoBranch?: string,
  timeoutMs: number = 10000 // default 10s timeout
): Promise<RunResult> => {
  logger.info(`🦀 Starting cargo run process in ${baseDir}`);

  const workingDirectory = path.join(baseDir, `run-${Date.now()}`);

  try {
    // 1. Clone repo
    logger.info(`📥 Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // 2. Checkout branch if provided
    if (repoBranch) {
      logger.info(`🌿 Checking out branch: ${repoBranch}`);
      await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
    }

    // 3. Run cargo run with timeout
    logger.info(`🚀 Running cargo run...`);
    return await new Promise<RunResult>((resolve) => {
      const proc = exec("cargo run", { cwd: workingDirectory });
      let stdout = "";
      let stderr = "";
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

      proc.stdout?.on("data", (data) => {
        stdout += data;
      });

      proc.stderr?.on("data", (data) => {
        stderr += data;
      });

      proc.on("close", (code) => {
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

      proc.on("error", (err) => {
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
    logger.error(`❌ Cargo run process failed`);
    return {
      success: false,
      output: err.stdout?.trim() || "",
      error: err.message?.trim() || "Unknown error",
      executedAt: new Date().toISOString(),
    };
  } finally {
    try {
      logger.info(`🧹 Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.warn(`⚠️ Cleanup failed: ${cleanupErr}`);
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
    logger.info(`📥 Cloning repo: ${repoURL} into ${workingDirectory}`);
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);

    // 2. Checkout branch if provided
    if (repoBranch) {
      logger.info(`🌿 Checking out branch: ${repoBranch}`);
      await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
    }

    // 3. Run cargo test
    logger.info(`⚙️ Running cargo test...`);
    const { stdout, stderr } = await execAsync("cargo test -- --nocapture", {
      cwd: workingDirectory,
    });

    logger.info(`✅ Cargo tests executed successfully`);

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
    logger.error(`❌ Cargo tests failed`);

    const errorMsg = [
      err.stdout ? err.stdout.trim() : "",
      err.stderr ? err.stderr.trim() : "",
      err.message ? err.message.trim() : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: false,
      output: err.stdout?.trim() || "",
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
      logger.info(`🧹 Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.warn(`⚠️ Cleanup failed: ${cleanupErr}`);
    }
  }
};

/**
 * Execute FIDO automation script (run-fido-fixed.js) testing
 * Now includes full server lifecycle: clone repo, build code, start server, run tests, stop server
 */
/**
 * Execute remote FIDO conformance testing using HTTP (ngrok-based) approach
 */
export async function executeRemoteConformanceTesting(
  testType: string,
  repoURL: string,
  repoBranch: string,
  fidoToolPath: string
): Promise<ConformanceResult> {
  const executionId = `exec-${Date.now()}`
  logger.info(`🔗 Starting remote FIDO conformance testing using HTTP/ngrok`)
  logger.info(`   Repo: ${repoURL}@${repoBranch}`)
  logger.info(`   FIDO Tool Path: ${fidoToolPath}`)
  logger.info(`   Execution ID: ${executionId}`)

  // Get ngrok URL from environment variable or use default
  const ngrokUrl = process.env.FIDO_NGROK_URL || 'https://dreama-unturning-elizbeth.ngrok-free.dev'
  
  if (ngrokUrl === 'https://dreama-unturning-elizbeth.ngrok-free.dev') {
    logger.warn('⚠️ Using default ngrok URL. Please set FIDO_NGROK_URL environment variable.')
  }

  try {
    const requestPayload = {
      testType,
      repoURL,
      repoBranch,
      executionId,
      fidoToolPath
    }

    logger.info(`🚀 Sending HTTP request to: ${ngrokUrl}/run-fido`)
    logger.info(`📦 Payload: ${JSON.stringify(requestPayload, null, 2)}`)

    // Make HTTP request to Mac agent
    const response = await fetch(`${ngrokUrl}/run-fido`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Xyne-FIDO-Workflow/1.0'
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(600000) // 10 minutes timeout
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const conformanceResult = await response.json() as ConformanceResult

    logger.info(`✅ Remote conformance testing completed successfully`)
    logger.info(`📊 Remote conformance results:`)
    logger.info(`   Success: ${conformanceResult.success}`)
    logger.info(`   Tests: ${conformanceResult.testResults?.passed}/${conformanceResult.testResults?.total} passed`)
    logger.info(`   Executed At: ${conformanceResult.output}`)
    logger.info(`   Output Length: ${conformanceResult.outputLength || 'N/A'} characters`)

    return conformanceResult

  } catch (httpError: any) {
    logger.error(`❌ Remote conformance testing failed: ${httpError.message}`)
    
    // Handle different types of HTTP errors
    let errorDetails = httpError.message
    
    if (httpError.name === 'AbortError' || httpError.name === 'TimeoutError') {
      errorDetails = 'Remote execution timeout - operation took longer than 10 minutes'
    } else if (httpError.message.includes('fetch failed') || httpError.message.includes('ENOTFOUND')) {
      errorDetails = `Mac agent unreachable - check ngrok URL: ${ngrokUrl}`
    } else if (httpError.message.includes('ECONNREFUSED')) {
      errorDetails = 'Connection refused - Mac agent server may be down'
    } else if (httpError.message.includes('HTTP 404')) {
      errorDetails = 'Mac agent endpoint not found - check server is running'
    } else if (httpError.message.includes('HTTP 500')) {
      errorDetails = 'Mac agent internal error - check server logs'
    }

    // Check if it's a build or server error from the Mac agent response
    if (httpError.message.includes('Build failed:')) {
      throw new Error(httpError.message)
    } else if (httpError.message.includes('Server startup failed:')) {
      throw new Error(httpError.message)
    }

    return {
      success: false,
      output: `Remote HTTP execution failed: ${errorDetails}\nNgrok URL: ${ngrokUrl}\nOriginal error: ${httpError.message}`,
      executedAt: new Date().toISOString(),
      testResults: { passed: 0, failed: 1, total: 1 }
    }
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
    logger.info('🗄️ Checking and creating fido_server database...');
    try {
      const env = { ...process.env, DATABASE_URL: 'postgres://localhost/fido_server' };

      // Check if database exists, if not create it
      logger.info('🔍 Checking if fido_server database exists...');
      try {
        await execAsync('psql -d postgres -c "SELECT 1 FROM pg_database WHERE datname=\'fido_server\'" | grep -q 1', { env });
        logger.info('✅ fido_server database already exists');
      } catch (checkErr) {
        logger.info('📦 Creating fido_server database (does not exist)...');
        await execAsync('createdb fido_server', { env });
        logger.info('✅ fido_server database created successfully');
      }
    } catch (dbErr: any) {
      logger.error(`❌ Database setup failed: ${dbErr.message}`);
      return {
        success: false,
        error: `Database setup failed: ${dbErr.message}`
      };
    }

    logger.info('🔌 Checking and freeing port 8080...');
    try {
      // Find and kill processes using port 8080
      const { stdout } = await execAsync("lsof -ti:8080");
      if (stdout.trim()) {
        const pids = stdout.trim().split('\n');
        for (const pid of pids) {
          await execAsync(`kill -9 ${pid}`);
          logger.info(`🔪 Killed process ${pid} using port 8080`);
        }
        // Wait a moment for processes to fully terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (portErr) {
      // No process found on port 8080, which is fine
      logger.info('✅ Port 8080 is already free');
    }

    logger.info('🚀 Launching cargo run in the background...');
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
    await new Promise(resolve => setTimeout(resolve, 30000));

    logger.info(`✅ Server process started in background with PID: ${serverProcess.pid}`);
    return { success: true, process: serverProcess };
  } catch (err: any) {
    logger.error(`❌ Cargo background run process failed: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Checks if a service is running by attempting to connect to a host and port.
 */
const isServiceRunning = (port: number, host: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000); // 1 second timeout

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
};



/**
 * Orchestrates the entire framework health check process.
 */
export const runFrameworkHealthChecks = async (
  baseDir: string,
  repoURL: string,
  repoBranch?: string
): Promise<{ success: boolean; summary: string }> => {
  logger.info('🏁 Starting framework health check orchestration...');
  const workingDirectory = path.join(baseDir, `health-check-${Date.now()}`);
  let serverProcess: ChildProcess | undefined;

  try {
    // 1. Check if dependent services are already running
    const postgresRunning = await isServiceRunning(5432, 'localhost');
    const redisRunning = await isServiceRunning(6379, 'localhost');

    if (postgresRunning && redisRunning) {
      logger.info('✅ Dependent services (PostgreSQL, Redis) are already running.');
    } else {
      logger.info('🚀 Starting dependent services (PostgreSQL, Redis) via Homebrew...');
      try {
        const services = ['postgresql', 'redis'];
        let output = '';
        for (const service of services) {
          const { stdout, stderr } = await execAsync(`brew services start ${service}`);
          if (stderr) logger.warn(`Warning starting ${service}: ${stderr}`);
          output += stdout;
        }
        // Add a delay to allow services to initialize
        await new Promise(resolve => setTimeout(resolve, 5000));
        logger.info('✅ Services started successfully.');
      } catch (error: any) {
        logger.error(`❌ Failed to start services via Homebrew: ${error.message}`);
        return {
          success: false,
          summary: `Failed to start dependent services: ${error.message}`,
        };
      }
    }

    // 2. Clone and build the repo
    logger.info('Cloning and building the repository...');
    await execAsync(`git clone ${repoURL} ${workingDirectory}`);
    if (repoBranch) {
      await execAsync(`git checkout ${repoBranch}`, { cwd: workingDirectory });
    }
    await execAsync("cargo build", { cwd: workingDirectory });
    logger.info('✅ Repository built successfully.');

    // 3. Run the server in the background
    const runResult = await executeMigrateAndCargoRunInBackground(workingDirectory);
    if (!runResult.success || !runResult.process) {
      throw new Error(`Failed to run server in background: ${runResult.error}`);
    }
    serverProcess = runResult.process;

    // 4. Execute health checks
    const healthResult = await executeHealthChecks();
    return {
      success: healthResult.success,
      summary: healthResult.summary,
    };
  } catch (error: any) {
    return {
      success: false,
      summary: `An error occurred during health check orchestration: ${error.message}`,
    };
  } finally {
    // 5. Cleanup
    if (serverProcess && serverProcess.pid) {
      try {
        process.kill(-serverProcess.pid); // Kill the entire process group
        logger.info('✅ Server process terminated.');
      } catch (e) {
        logger.warn(`⚠️ Could not terminate server process: ${e}`);
      }
    }
    
    // Clean up the working directory
    try {
      logger.info(`🧹 Cleaning up ${workingDirectory}`);
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    } catch (cleanupErr) {
      logger.warn(`⚠️ Cleanup failed: ${cleanupErr}`);
    }

    // stopServices() is no longer needed as the script handles its own lifecycle.
    logger.info('🧹 Health check complete.');
  }
};


/**
 * Legacy SSH-based remote conformance testing (kept for fallback)
 */
export async function executeFIDOAutomationScript(
  appBinaryPath: string = "/Applications/FIDO Alliance - Certification Conformance Testing Tools.app/Contents/MacOS/FIDO Alliance - Certification Conformance Testing Tools",
  baseDir: string,
  repoURL: string,
  repoBranch?: string
): Promise<ConformanceResult> {
  // This function will be used for local execution when not using remote client
  // For distributed execution, use executeRemoteConformanceTesting instead
  
  logger.info(`🤖 Local FIDO automation execution not implemented yet`)
  logger.info(`Parameters: appBinaryPath=${appBinaryPath}, baseDir=${baseDir}, repoURL=${repoURL}, repoBranch=${repoBranch}`)
  
  return {
    success: false,
    output: 'Local FIDO automation not implemented - use distributed execution via executeRemoteConformanceTesting',
    executedAt: new Date().toISOString()
  }
}

/**
 * Execute a series of health checks for the FIDO server environment
 */
export const executeHealthChecks = async (): Promise<{
  success: boolean
  results: HealthCheckResult[]
  summary: string
}> => {
  logger.info('🩺 Running framework health checks...')
  const results = await runHealthChecks()
  const failedChecks = results.filter(r => !r.success)
  const success = failedChecks.length === 0

  let summary = `Health check summary: ${results.length - failedChecks.length}/${results.length} passed.\n`
  if (!success) {
    summary += 'Failed checks:\n'
    summary += failedChecks
      .map(
        check =>
          `- ${check.check}: ${check.details}\n  Remediation: ${check.remediation}`
      )
      .join('\n')
  }

  logger.info(summary)

  return {
    success,
    results,
    summary,
  }
}
