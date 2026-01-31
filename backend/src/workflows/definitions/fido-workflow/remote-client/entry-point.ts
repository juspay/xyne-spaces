#!/usr/bin/env node

import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import {logger} from '@/utils/logger';

const execAsync = promisify(exec)

// Types for the remote client (simplified versions)
interface BuildResult {
  success: boolean
  output: string
  error: string
  executedAt: string
}

interface ConformanceResult {
  success: boolean
  output: string
  executedAt: string
  outputLength?: number
  testResults?: {
    passed: number
    failed: number
    total: number
  }
}

interface ServerRunResult {
  success: boolean
  serverStarted: boolean
  serverReady: boolean
  port: number
  startupTime: number
  output: string
  error: string
  crashDetails?: string
  healthCheckPassed: boolean
  executedAt: string
}

class RemoteFidoClient {
  private executionId: string
  private workingDirectory: string | null = null
  private serverProcess: any = null

  constructor(executionId: string) {
    this.executionId = executionId
  }

  async log(message: string) {
    const timestamp = new Date().toISOString()
    logger.error(`[${timestamp}] [${this.executionId}] ${message}`)
  }

  async executeRemoteFIDOWorkflow(
    repoURL: string,
    repoBranch: string,
    fidoToolPath: string,
    testType:string
  ): Promise<ConformanceResult> {
    try {
      await this.log('🚀 Starting remote FIDO execution')

      // Phase 1: Setup and clone
      await this.setupAndClone(repoURL, repoBranch)
      
      // Phase 2: Build (throw error if fails - to be handled by LLM)
      const buildResult = await this.buildCode()
      if (!buildResult.success) {
        throw new Error(`Build failed: ${buildResult.error}`)
      }

      // Phase 3: Start server (throw error if fails - to be handled by LLM)
      const serverResult = await this.startServer()
      if (!serverResult.success) {
        throw new Error(`Server startup failed: ${serverResult.error}`)
      }

      // Phase 4: Run FIDO tests - this is what we return
      const conformanceResult = await this.runFidoTests(fidoToolPath,testType)
      
      await this.log(`✅ Execution completed. Test Success: ${conformanceResult.success}`)
      // logger.info('✅ Execution complete - returning conformance results', conformanceResult)
      return conformanceResult

    } catch (error: any) {
      await this.log(`❌ Fatal error: ${error.message}`)
      throw error
    } finally {
      await this.cleanup()
    }
  }

  private async setupAndClone(repoURL: string, repoBranch: string) {
    const baseDir = '/tmp/fido-remote-execution'
    const timestamp = Date.now()
    this.workingDirectory = path.join(baseDir, `fido-server-${timestamp}`)
    
    await this.log(`📁 Setting up workspace: ${this.workingDirectory}`)
    
    // Clean up any existing directory
    if (fs.existsSync(this.workingDirectory)) {
      fs.rmSync(this.workingDirectory, { recursive: true, force: true })
    }

    // Clone repository
    await this.log(`📥 Cloning repo: ${repoURL}`)
    await execAsync(`git clone ${repoURL} ${this.workingDirectory}`)

    // Checkout branch
    if (repoBranch) {
      await this.log(`🌿 Attempting to checkout branch: ${repoBranch}`)
      try {
        await execAsync(`git checkout ${repoBranch}`, { cwd: this.workingDirectory })
        await this.log(`✅ Successfully checked out branch: ${repoBranch}`)
      } catch (checkoutError) {
        await this.log(`⚠️ Branch ${repoBranch} not found locally, trying remote...`)
        try {
          await execAsync(`git checkout -b ${repoBranch} origin/${repoBranch}`, { cwd: this.workingDirectory })
          await this.log(`✅ Successfully checked out remote branch: ${repoBranch}`)
        } catch (remoteError) {
          await this.log(`⚠️ Remote branch not found, creating new branch: ${repoBranch}`)
          try {
            await execAsync(`git checkout -b ${repoBranch}`, { cwd: this.workingDirectory })
            await this.log(`✅ Successfully created and checked out new branch: ${repoBranch}`)
          } catch (createError) {
            await this.log(`⚠️ Failed to create branch ${repoBranch}, staying on default branch`)
          }
        }
      }
    }
  }

  private async buildCode(): Promise<BuildResult> {
    const buildResult: BuildResult = {
      success: false,
      output: '',
      error: '',
      executedAt: new Date().toISOString()
    }

    if (!this.workingDirectory) {
      buildResult.error = 'Working directory not set'
      return buildResult
    }

    try {
      await this.log('🔨 Running cargo build...')
      
      const buildPromise = new Promise<BuildResult>((resolve) => {
        const buildProcess = exec('cargo build --all-features', { cwd: this.workingDirectory! })
        
        let buildStdout = ''
        let buildStderr = ''
        
        buildProcess.stdout?.on('data', (data: string) => {
          buildStdout += data
          process.stderr.write(`[BUILD] ${data}`)
        })
        
        buildProcess.stderr?.on('data', (data: string) => {
          buildStderr += data
          process.stderr.write(`[BUILD-ERR] ${data}`)
        })
        
        buildProcess.on('close', (code: number) => {
          if (code === 0) {
            buildResult.success = true
            buildResult.output = buildStdout
            buildResult.error = buildStderr
            this.log('[BUILD] ✅ Cargo build completed successfully')
          } else {
            buildResult.success = false
            buildResult.output = buildStdout
            buildResult.error = `Cargo build failed with exit code ${code}. Stderr: ${buildStderr}`
            this.log(`❌ Build failed: ${buildResult.error}`)
          }
          resolve(buildResult)
        })
        
        buildProcess.on('error', (err: Error) => {
          buildResult.success = false
          buildResult.error = `Cargo build process error: ${err.message}`
          this.log(`❌ Build process error: ${err.message}`)
          resolve(buildResult)
        })
      })
      
      return await buildPromise

    } catch (error: any) {
      buildResult.error = error.message
      await this.log(`❌ Build setup failed: ${error.message}`)
      return buildResult
    }
  }

  private async startServer(): Promise<ServerRunResult> {
    const serverResult: ServerRunResult = {
      success: false,
      serverStarted: false,
      serverReady: false,
      port: 8080,
      startupTime: 0,
      output: '',
      error: '',
      healthCheckPassed: false,
      executedAt: new Date().toISOString()
    }

    const startTime = Date.now()

    if (!this.workingDirectory) {
      serverResult.error = 'Working directory not set'
      return serverResult
    }

     // Clear port 8080
      await this.log('🛑 Clearing port 8080...')
      try {
        const { stdout } = await execAsync('lsof -ti:8080')
        if (stdout.trim()) {
          await execAsync('lsof -ti:8080 | xargs kill -9')
          await this.log('✅ Port 8080 cleared')
        }
      } catch (err: any) {
        if (err.message?.includes('No such process') || err.code === 1) {
          await this.log('✅ Port 8080 already clear')
        } else {
          throw new Error(`Failed to clear port 8080: ${err.message || err}`)
        }
      }

    try {
      // Database setup: drop, create, then migrate
      await this.log('🗄️ Setting up database...')
      try {
        const env = { ...process.env, DATABASE_URL: 'postgres://localhost/fido_server' }
        
        // Drop database if exists
        await this.log('🗑️ Dropping fido_server database if exists...')
        try {
          await execAsync('dropdb fido_server', { env })
          await this.log('✅ Database dropped successfully')
        } catch (dropErr: any) {
          await this.log('ℹ️ Database does not exist or could not be dropped (continuing)')
        }
        
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
    }
        
        // Run migrations
        await this.log('🗄️ Running diesel migration run...')
        const { stderr } = await execAsync('diesel migration run', { 
          cwd: this.workingDirectory!,
          env
        })
        await this.log('✅ Diesel migration run completed successfully')
        if (stderr) {
          await this.log(`Migration warnings: ${stderr.trim()}`)
        }
      } catch (migrationErr: any) {
        const migrationError = [
          migrationErr.stdout ? migrationErr.stdout.trim() : "",
          migrationErr.stderr ? migrationErr.stderr.trim() : "",
          migrationErr.message ? migrationErr.message.trim() : "",
        ]
          .filter(Boolean)
          .join("\n");
        
        throw new Error(`Database setup failed: ${migrationError}`)
      }


      // Start server
      await this.log('🚀 Starting cargo run...')
      
      const cargoPromise = new Promise<void>((resolve, reject) => {
        const env = { ...process.env, PORT: '8080', BIND_ADDRESS: '127.0.0.1:8080' }
        this.serverProcess = exec('cargo run --all-features', { cwd: this.workingDirectory!, env })
        
        serverResult.serverStarted = true
        
        let stdout = ''
        let stderr = ''
        let compilationFinished = false
        
        this.serverProcess.stdout?.on('data', (data: string) => {
          stdout += data
          serverResult.output = stdout
          process.stderr.write(`[CARGO] ${data}`)
          
          if (data.includes('Finished') || data.includes('Running `target/')) {
            compilationFinished = true
            this.log('[COMPILATION] ✅ Compilation finished')
          }
          
          if (compilationFinished || data.includes('starting service:')) {
            const serverStartPatterns = [
              'Server running at http://127.0.0.1:8080',
              'Server running at http://localhost:8080', 
              'listening on: 127.0.0.1:8080',
              'listening on: localhost:8080',
              'starting service:',
              'actix_server::server] starting service',
              'Actix runtime found; starting in Actix runtime'
            ]
            
            const serverDetected = serverStartPatterns.some(pattern => 
              data.toLowerCase().includes(pattern.toLowerCase())
            )
            
            if (serverDetected) {
              serverResult.serverReady = true
              serverResult.startupTime = Date.now() - startTime
              this.log(`[SERVER] 🚀 FIDO Server startup detected!`)
              resolve()
            }
          }
        })
        
        this.serverProcess.stderr?.on('data', (data: string) => {
          stderr += data
          // Capture all stderr in error field for complete logs
          serverResult.error = `Complete error logs:\n${stderr}`
          process.stderr.write(`[CARGO-ERR] ${data}`)

          // Check for compilation finished in stderr too
          if (data.includes('Finished') || data.includes('Running `target/')) {
            compilationFinished = true
            this.log('[COMPILATION] ✅ Compilation finished (detected in stderr)')
          }

          // Check for server startup in stderr
          if (data.includes('starting service:') || data.includes('listening on:') || data.includes('actix_server::server]')) {
            compilationFinished = true // Server starting = compilation must have finished
            serverResult.serverReady = true
            serverResult.startupTime = Date.now() - startTime
            this.log(`[SERVER] 🚀 FIDO Server startup detected in stderr!`)
            resolve()
          }

          if (data.includes('panicked') || data.includes('error:') || data.includes('failed to')) {
            serverResult.crashDetails = data
            this.log(`⚠️ Detected error/crash in stderr: ${data}`)
          }
        })
        
        this.serverProcess.on('error', (err: Error) => {
          serverResult.crashDetails = err.message
          // Capture all accumulated logs in error field
          serverResult.error = `Process error: ${err.message}\n\nComplete error logs:\n${stderr}\n\nComplete output logs:\n${stdout}`
          this.log(`⚠️ Process error: ${err.message}, but continuing to next step`)
          if (compilationFinished) {
            // If compilation finished but process had error, still treat as success
            serverResult.serverReady = true
            serverResult.startupTime = Date.now() - startTime
            resolve()
          } else {
            reject(new Error(`Cargo run failed: ${err.message}`))
          }
        })
        
        this.serverProcess.on('close', (code: number) => {
          if (code !== 0) {
            serverResult.crashDetails = `Process exited with code ${code}`
            // Capture all accumulated logs in error field
            serverResult.error = `Process exited with code ${code}\n\nComplete error logs:\n${stderr}\n\nComplete output logs:\n${stdout}`
            this.log(`⚠️ Process exited with code ${code}, but continuing if compilation finished`)
            if (compilationFinished) {
              // If compilation finished but process exited, still treat as success
              serverResult.serverReady = true
              serverResult.startupTime = Date.now() - startTime
              resolve()
            } else {
              reject(new Error(`Cargo exited with code ${code}`))
            }
          }
        })
        
        setTimeout(() => {
          if (compilationFinished) {
            this.log('[TIMEOUT] ✅ Compilation finished successfully - proceeding to FIDO tests')
            serverResult.serverReady = true
            serverResult.startupTime = Date.now() - startTime
            resolve() 
          } else {
            this.log('[TIMEOUT] ❌ Compilation never finished - this is a real failure')
            reject(new Error('Server startup timeout - compilation never finished'))
          }
        }, 30000) // Reduced from 120s to 30s
      })
      
      await cargoPromise

      // Always mark as successful if we reach here (compilation finished)
      serverResult.success = true
      serverResult.serverReady = true

      // Health check (optional - for additional verification)
      await this.log('✅ Server started, waiting 2s before health check...')
      await new Promise(resolve => setTimeout(resolve, 2000))

      await this.log('🔍 Checking server health (optional verification)...')
      let serverReady = false
      for (let i = 0; i < 5; i++) {
        try {
          await execAsync('curl -f http://localhost:8080/health || curl -f http://localhost:8080/', { timeout: 2000 })
          serverReady = true
          break
        } catch (err) {
          await this.log(`⏳ Health check attempt ${i+1}/5 (not critical)`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      serverResult.healthCheckPassed = serverReady

      if (serverReady) {
        await this.log('✅ Server health check passed - confirmed running')
      } else {
        await this.log('⚠️ Server health check failed, but server likely running (compilation was successful)')
      }

      return serverResult

    } catch (error: any) {
      serverResult.crashDetails = error.message
      await this.log(`❌ Server startup failed: ${error.message}`)
      return serverResult
    }
  }

  private async runFidoTests(fidoToolPath: string,testType:string): Promise<ConformanceResult> {
    await this.log('🤖 Running FIDO automation script...')

    // Validate FIDO tool path first
    await this.log(`🔍 Checking FIDO tool path: ${fidoToolPath}`)
    
    if (!fs.existsSync(fidoToolPath)) {
      await this.log(`❌ FIDO tool not found at: ${fidoToolPath}`)
      
      // Try to find alternative paths
      const alternativePaths = [
        '/Applications/FIDO Alliance - Certification Conformance Testing Tools.app/Contents/MacOS/FIDO Alliance - Certification Conformance Testing Tools',
        '/Applications/FIDOAlliance.app/Contents/MacOS/FIDOAlliance',
        '/Applications/FIDO.app/Contents/MacOS/FIDO'
      ]
      
      for (const altPath of alternativePaths) {
        if (fs.existsSync(altPath)) {
          await this.log(`✅ Found FIDO tool at alternative path: ${altPath}`)
          fidoToolPath = altPath
          break
        }
      }
      
      if (!fs.existsSync(fidoToolPath)) {
        await this.log(`❌ FIDO tool not found in any known locations. Please install the FIDO Alliance Conformance Testing Tool.`)
        return {
          success: false,
          output: `FIDO Alliance tool not found at ${fidoToolPath}. Please verify the installation path.`,
          testResults: { passed: 0, failed: 0, total: 0 },
          executedAt: new Date().toISOString()
        }
      }
    } else {
      await this.log(`✅ FIDO tool found at: ${fidoToolPath}`)
    }

    try {
      // Use the run-fido-fixed.cjs script in the same directory
      const scriptPath = path.join(__dirname, 'run-fido-fixed.cjs')
      const tempResultsFile = path.join(this.workingDirectory!, `fido-results-${Date.now()}.json`)
      const command = `node "${scriptPath}" "${fidoToolPath}" "${tempResultsFile}" "${testType}"`
      
      const result = await new Promise<{success: boolean, tempFile: string}>((resolve) => {
        const child = exec(command, {
          cwd: path.dirname(scriptPath),
          timeout: 300000 // 5 minutes timeout
        })
        
        child.stdout?.on('data', (data: string) => {
          process.stderr.write(`[FIDO] ${data}`)
        })
        
        child.stderr?.on('data', (data: string) => {
          process.stderr.write(`[FIDO-ERR] ${data}`)
        })
        
        child.on('close', (code: number) => {
          this.log(`[FIDO] Automation script completed with exit code: ${code}`)
          resolve({ success: code === 0, tempFile: tempResultsFile })
        })
        
        child.on('error', (error: Error) => {
          this.log(`[FIDO] Script process error: ${error.message}`)
          resolve({ success: false, tempFile: tempResultsFile })
        })
      })

      // Parse results
      let parsedResults: ConformanceResult = {
        success: false,
        output: '',
        testResults: { passed: 0, failed: 0, total: 0 },
        executedAt: new Date().toISOString()
      }

      try {
        if (fs.existsSync(result.tempFile)) {
          const fileContent = fs.readFileSync(result.tempFile, 'utf8')
          const fileResults = JSON.parse(fileContent)
          parsedResults = {
            success: fileResults.success || false,
            output: fileResults.output || '',
            testResults: fileResults.testResults || { passed: 0, failed: 0, total: 0 },
            executedAt: new Date().toISOString()
          }
          
          // Clean up temporary file
          fs.unlinkSync(result.tempFile)
          await this.log('📁 FIDO results processed and temp file cleaned up')
        } else {
          parsedResults.output = 'FIDO results file not found'
        }
      } catch (parseError: any) {
        parsedResults.output = `Failed to parse FIDO results: ${parseError.message}`
      }

      // Add output length tracking
      const outputLength = parsedResults.output ? parsedResults.output.length : 0
      await this.log(`📊 FIDO Results: ${parsedResults.testResults?.passed}/${parsedResults.testResults?.total} tests passed`)
      await this.log(`📏 Output length: ${outputLength} characters`)
      
      // Add output length to results
      parsedResults.outputLength = outputLength
      return parsedResults

    } catch (error: any) {
      await this.log(`❌ FIDO testing failed: ${error.message}`)
      return {
        success: false,
        output: `FIDO testing error: ${error.message}`,
        testResults: { passed: 0, failed: 0, total: 0 },
        executedAt: new Date().toISOString()
      }
    }
  }

  private async cleanup() {
    await this.log('🧹 Starting cleanup...')

    // Stop server
    if (this.serverProcess) {
      await this.log('🛑 Stopping FIDO server...')
      try {
        if (this.serverProcess.pid) {
          try {
            process.kill(-this.serverProcess.pid, 'SIGTERM')
          } catch (pgError) {
            this.serverProcess.kill('SIGTERM')
          }
        } else {
          this.serverProcess.kill('SIGTERM')
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000))
        
        if (this.serverProcess.pid && !this.serverProcess.killed) {
          try {
            process.kill(this.serverProcess.pid, 0)
            try {
              process.kill(-this.serverProcess.pid, 'SIGKILL')
            } catch (pgError) {
              this.serverProcess.kill('SIGKILL')
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
          } catch (checkError) {
            // Process is dead
          }
        }
      } catch (killError) {
        await this.log(`⚠️ Error during server shutdown: ${killError}`)
      }
    }

    // Clean up working directory
    if (this.workingDirectory && fs.existsSync(this.workingDirectory)) {
      try {
        fs.rmSync(this.workingDirectory, { recursive: true, force: true })
        await this.log(`✅ Working directory cleaned up`)
      } catch (cleanupError) {
        await this.log(`⚠️ Cleanup failed: ${cleanupError}`)
      }
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 2) {
    logger.error('Usage: node entry-point.ts <repoUrl> <branch> [executionId] [fidoToolPath] [resultFile]')
    process.exit(1)
  }

  const [repoUrl, branch, executionId, fidoToolPath, resultFile,testType] = args
  const finalExecutionId = executionId || `exec-${Date.now()}`
  const finalFidoToolPath = fidoToolPath || '/Applications/FIDO Alliance - Certification Conformance Testing Tools.app/Contents/MacOS/FIDO Alliance - Certification Conformance Testing Tools'
  const finalResultFile = resultFile || path.join('/tmp', `fido-results-${finalExecutionId}.json`)

  const client = new RemoteFidoClient(finalExecutionId)
  
  try {
    const conformanceResult = await client.executeRemoteFIDOWorkflow(repoUrl, branch, finalFidoToolPath,testType)
    
    // Write results to file instead of stdout
    await client.log(`📁 Writing results to file: ${finalResultFile}`)
    fs.writeFileSync(finalResultFile, JSON.stringify(conformanceResult, null, 2), 'utf8')
    await client.log(`✅ Results written to file successfully`)
    
    // Output a simple success message to stdout
    logger.info(`Results written to: ${finalResultFile}`)
    process.exit(conformanceResult.success ? 0 : 1)
    
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`)
    
    // For build/server errors, return a simple error conformance result
    const errorResult: ConformanceResult = {
      success: false,
      output: `Execution failed: ${error.message}`,
      testResults: { passed: 0, failed: 0, total: 0 },
      outputLength: error.message.length,
      executedAt: new Date().toISOString()
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

if (require.main === module) {
  main()
}

export { RemoteFidoClient }
