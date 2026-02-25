#!/usr/bin/env node

import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import { TestDetail } from '../types'
const execAsync = promisify(exec)
import {logger} from '@/utils/logger';
import {runTestScripts} from '../utils'

// Types for the remote client (simplified versions)
interface ConformanceResult {
  success: boolean
  output: string
}

class RemoteFidoClient {
  private executionId: string
  private workingDirectory: string | null = null
  private serverProcessPids: number[] = []

  constructor(executionId: string) {
    this.executionId = executionId
  }

  async log(message: string) {
    const timestamp = new Date().toISOString()
    logger.error(`[${timestamp}] [${this.executionId}] ${message}`)
  }

  async executeRemoteTesting(
    repoURL: string,
    repoBranch: string,
    testDetails: TestDetail | null,
  ): Promise<ConformanceResult> {
    try {
      await this.log('🚀 Starting remote FIDO execution')
      
      // Phase 1: Setup and clone
      await this.setupAndClone(repoURL, repoBranch)

      const buildResult = await runTestScripts(
        {
          filename: 'fido-build.cjs',
          command: 'node',
          parameters: []
        }
      , this.workingDirectory!)

      if (!buildResult.success) {
        await this.log(` Build failed, aborting tests`)
        return {
          success: false,
          output: `Build failed: ${buildResult.output}`
        }
      }

      await this.log(` Build succeeded, proceeding to tests`)
      const serverResult = await runTestScripts(
        {
          filename: 'fido-run-server.cjs',
          command: 'node',
          parameters: []
        }
      , this.workingDirectory!)

      if (!serverResult.success) {
        await this.log(` Server startup failed, aborting tests`)
        return {
          success: false,
          output: `Server startup failed: ${serverResult.output}`
        }
      }

      await this.log(` Server started successfully`) 
      // Phase 3: Run FIDO tests - this is what we return
      // Skip test execution if testDetails is not provided
      await new Promise(resolve => setTimeout(resolve, 5000));

      if (testDetails) {
        const testResult = await runTestScripts(testDetails, this.workingDirectory!)
        await this.log(` Execution completed. Test Success: ${testResult.success}`)
        return testResult
      } else {
        await this.log(` No testDetails provided, skipping test execution`)
        return {
          success: true,
          output: 'No test execution requested (testDetails not provided)'
        }
      }

    } catch (error: any) {
      await this.log(` Fatal error: ${error.message}`)
      throw error
    } finally {
      await this.cleanup()
    }
  }





  private async setupAndClone(repoURL: string, repoBranch: string) {
    const baseDir = '/tmp/fido-remote-execution'
    const timestamp = Date.now()
    this.workingDirectory = path.join(baseDir, `fido-server-${timestamp}`)
    
    await this.log(` Setting up workspace: ${this.workingDirectory}`)
    
    // Clean up any existing directory
    if (fs.existsSync(this.workingDirectory)) {
      fs.rmSync(this.workingDirectory, { recursive: true, force: true })
    }

    // Clone repository
    await this.log(` Cloning repo: ${repoURL}`)
    await execAsync(`git clone ${repoURL} ${this.workingDirectory}`)

    // Checkout branch
    if (repoBranch) {
      await this.log(` Attempting to checkout branch: ${repoBranch}`)
      try {
        await execAsync(`git checkout ${repoBranch}`, { cwd: this.workingDirectory })
        await this.log(` Successfully checked out branch: ${repoBranch}`)
      } catch (checkoutError) {
        await this.log(` Branch ${repoBranch} not found locally, trying remote...`)
        try {
          await execAsync(`git checkout -b ${repoBranch} origin/${repoBranch}`, { cwd: this.workingDirectory })
          await this.log(` Successfully checked out remote branch: ${repoBranch}`)
        } catch (remoteError) {
          await this.log(` Remote branch not found, creating new branch: ${repoBranch}`)
          try {
            await execAsync(`git checkout -b ${repoBranch}`, { cwd: this.workingDirectory })
            await this.log(` Successfully created and checked out new branch: ${repoBranch}`)
          } catch (createError) {
            await this.log(` Failed to create branch ${repoBranch}, staying on default branch`)
          }
        }
      }
    }
  }

  private async cleanup() {
    await this.log('🧹 Starting cleanup...')

    // Stop any tracked server processes
    if (this.serverProcessPids.length > 0) {
      await this.log(`🛑 Stopping ${this.serverProcessPids.length} background server process(es)...`)
      for (const pid of this.serverProcessPids) {
        try {
          // Try process group kill first
          try {
            process.kill(-pid, 'SIGTERM')
          } catch {
            // Fallback to single process kill
            process.kill(pid, 'SIGTERM')
          }
        } catch (error) {
          await this.log(` Failed to kill process ${pid}: ${(error as Error).message}`)
        }
      }
      
      // Wait for processes to terminate
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Force kill any remaining processes
      for (const pid of this.serverProcessPids) {
        try {
          process.kill(pid, 0) // Check if process exists
          process.kill(pid, 'SIGKILL')
        } catch {
          // Process already dead
        }
      }
      
      this.serverProcessPids = []
    }

    // Clean up working directory
    if (this.workingDirectory && fs.existsSync(this.workingDirectory)) {
      try {
        fs.rmSync(this.workingDirectory, { recursive: true, force: true })
        await this.log(` Working directory cleaned up`)
      } catch (cleanupError) {
        await this.log(` Cleanup failed: ${cleanupError}`)
      }
    }
  }
}
export async function executeRemoteTesting(
  repoURL: string,
  repoBranch: string,
  testDetails: TestDetail | null,
): Promise<ConformanceResult> {
  const executionId = `exec-${Date.now()}`
  const client = new RemoteFidoClient(executionId)
  return client.executeRemoteTesting(repoURL, repoBranch, testDetails)
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 2) {
    logger.error('Usage: node entry-point.ts <repoUrl> <branch> [executionId] [fidoToolPath] [resultFile]')
    process.exit(1)
  }

  const [repoUrl, branch, executionId, resultFile, testDetailsJson] = args
  const finalExecutionId = executionId || `exec-${Date.now()}`
  const finalResultFile = resultFile || path.join('/tmp', `fido-results-${finalExecutionId}.json`)

  const client = new RemoteFidoClient(finalExecutionId)

  
  try {
    const parsedTestDetails = testDetailsJson && testDetailsJson.trim() ? JSON.parse(testDetailsJson) : null
    const conformanceResult = await client.executeRemoteTesting(repoUrl, branch, parsedTestDetails);
    
    // Write results to file instead of stdout
    await client.log(` Writing results to file: ${finalResultFile}`)
    fs.writeFileSync(finalResultFile, JSON.stringify(conformanceResult, null, 2), 'utf8')
    await client.log(` Results written to file successfully`)
    
    // Output a simple success message to stdout
    console.log(`Results written to: ${finalResultFile}`)
    // process.exit(conformanceResult.success ? 0 : 1)
    
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`)
    
    // For build/server errors, return a simple error conformance result
    const errorResult: ConformanceResult = {
      success: false,
      output: `Execution failed: ${error.message}`,
    }
    
    // Write error result to file
    try {
      fs.writeFileSync(finalResultFile, JSON.stringify(errorResult, null, 2), 'utf8')
      logger.info(`Error result written to: ${finalResultFile}`)
    } catch (writeError) {
      logger.error(`Failed to write error result to file: ${writeError}`)
    }
    
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { RemoteFidoClient }
