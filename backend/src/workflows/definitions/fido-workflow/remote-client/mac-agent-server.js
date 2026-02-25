#!/usr/bin/env node

const express = require('express')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')

const app = express()
app.use(express.json({ limit: '10mb' }))

// Store for tracking active executions
const activeExecutions = new Map()

// Job storage for async pattern
const jobStore = new Map()

// ============================================================================
// ASYNC JOB MANAGEMENT
// ============================================================================

function createJobId() {
  return `fido-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

function createJob(repoURL, repoBranch, testDetails, executionId, workflowType, isDefaultBuildAndRun) {
  const jobId = createJobId()
  const now = new Date().toISOString()
  const job = {
    id: jobId,
    status: 'queued',
    progress: 'Job created, waiting to start',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    repoURL,
    repoBranch,
    testDetails,
    executionId,
    workflowType,
    isDefaultBuildAndRun,
    result: null,
    error: null
  }
  jobStore.set(jobId, job)
  return job
}

function getJob(jobId) {
  return jobStore.get(jobId)
}

function updateJob(jobId, updates) {
  const job = jobStore.get(jobId)
  if (!job) return null
  const now = new Date().toISOString()
  
  // Track status transitions
  if (updates.status && updates.status !== job.status) {
    if (updates.status === 'processing' && !job.startedAt) {
      updates.startedAt = now
    } else if (updates.status === 'completed' || updates.status === 'failed') {
      updates.completedAt = now
    }
  }
  
  jobStore.set(jobId, { ...job, ...updates, updatedAt: now })
  return jobStore.get(jobId)
}

function startJobExecution(jobId) {
  return updateJob(jobId, { status: 'processing', progress: 'Starting FIDO conformance testing...' })
}

function completeJob(jobId, result) {
  return updateJob(jobId, {
    status: result.success ? 'completed' : 'failed',
    progress: 'Job completed',
    result,
    error: result.success ? null : result.output
  })
}

function failJob(jobId, error) {
  return updateJob(jobId, {
    status: 'failed',
    progress: 'Job failed',
    error
  })
}

function updateJobProgress(jobId, progress) {
  return updateJob(jobId, { progress })
}

// Helper function to clean up stale result files
function cleanupStaleResultFiles() {
  try {
    const tmpDir = '/tmp'
    const files = fs.readdirSync(tmpDir)
    const fidoFiles = files.filter(f => f.startsWith('fido-results-') && f.endsWith('.json'))
    
    for (const file of fidoFiles) {
      const filePath = path.join(tmpDir, file)
      try {
        const stats = fs.statSync(filePath)
        // Remove files older than 2 hours
        if (Date.now() - stats.mtime.getTime() > 2 * 60 * 60 * 1000) {
          fs.unlinkSync(filePath)
          console.log(`🧹 Cleaned up stale result file: ${file}`)
        }
      } catch (err) {
        // File might have been deleted already, ignore
      }
    }
  } catch (err) {
    console.warn('⚠️ Failed to cleanup stale result files:', err.message)
  }
}

// Helper function to parse and validate test results
function parseTestResults(rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return { passed: 0, failed: 0, total: 0 }
  }

  // Try to extract test statistics from the complex format shown in the user's example
  try {
    let passed = 0
    let failed = 0
    let total = 0

    // Look for patterns like "✅" (passed) and "❌" (failed) or similar indicators
    const passedMatches = rawOutput.match(/✅|passed|P-\d+/gi) || []
    const failedMatches = rawOutput.match(/❌|failed|F-\d+|Error:/gi) || []
    
    passed = passedMatches.length
    failed = failedMatches.length
    total = passed + failed

    // Alternative parsing - look for explicit test count patterns
    const totalMatch = rawOutput.match(/(\d+)\s*tests?\s*(passed|completed|total)/i)
    if (totalMatch) {
      total = Math.max(total, parseInt(totalMatch[1]) || 0)
    }

    const passedMatch = rawOutput.match(/(\d+)\s*passed/i)
    if (passedMatch) {
      passed = parseInt(passedMatch[1]) || passed
    }

    const failedMatch = rawOutput.match(/(\d+)\s*failed/i)
    if (failedMatch) {
      failed = parseInt(failedMatch[1]) || failed
    }

    // Ensure totals make sense
    if (total === 0 && (passed > 0 || failed > 0)) {
      total = passed + failed
    }

    return { passed, failed, total }
  } catch (err) {
    console.warn('⚠️ Failed to parse test results:', err.message)
    return { passed: 0, failed: 0, total: 0 }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeExecutions: activeExecutions.size,
    uptime: process.uptime()
  })
})

// ============================================================================
// ASYNC JOB ENDPOINTS
// ============================================================================

// POST /run-fido - Start a new async job (recommended)
app.post('/run-fido', async (req, res) => {
  const { repoURL, repoBranch, testDetails, executionId } = req.body
  
  console.log(`🔗 [ASYNC] Received FIDO job request`)
  console.log(`   Repo: ${repoURL}@${repoBranch}`)
  
  // Validate required parameters
  if (!repoURL || !repoBranch) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: repoURL and repoBranch are required'
    })
  }
  
  
  // Create job
  const job = createJob(repoURL, repoBranch, testDetails, executionId)
  
  console.log(`✅ Created job: ${job.id}`)
  
  // Start job in background
  executeJobInBackground(job).catch((error) => {
    console.error(`[JOB ${job.id}] Background execution failed:`, error)
  })
  
  // Return immediately with job ID
  res.status(202).json({
    success: true,
    jobId: job.id,
    status: 'started',
    message: 'Job started. Use the returned jobId to poll for status and results.'
  })
})

// GET /run-fido/status/:jobId - Get job status
app.get('/run-fido/status/:jobId', (req, res) => {
  const { jobId } = req.params
  const job = getJob(jobId)
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    })
  }
  
  const duration = job.startedAt 
    ? Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000)
    : 0
  
  res.json({
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    duration: duration > 0 ? `${duration}s` : undefined,
    repoURL: job.repoURL,
    repoBranch: job.repoBranch,
    workflowType: job.workflowType
  })
})

// GET /run-fido/result/:jobId - Get job result
app.get('/run-fido/result/:jobId', (req, res) => {
  const { jobId } = req.params
  const job = getJob(jobId)
  
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    })
  }
  
  if (job.status === 'queued' || job.status === 'processing') {
    return res.status(202).json({
      success: false,
      status: job.status,
      progress: job.progress,
      message: 'Job is still running. Check status endpoint for progress.'
    })
  }
  
  if (job.status === 'failed') {
    return res.json({
      success: false,
      result: job.result,
      error: job.error,
      completedAt: job.completedAt
    })
  }
  
  res.json({
    success: true,
    result: job.result,
    completedAt: job.completedAt
  })
})

// GET /run-fido/jobs - List all jobs
app.get('/run-fido/jobs', (req, res) => {
  const { status } = req.query
  let jobs = Array.from(jobStore.values())
  
  if (status) {
    jobs = jobs.filter(job => job.status === status)
  }
  
  // Sort by creation time, newest first
  jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  
  res.json({
    success: true,
    count: jobs.length,
    jobs
  })
})

// ============================================================================
// LEGACY SYNC ENDPOINT (kept for backward compatibility)
// ============================================================================

// POST /run-fido/sync - Synchronous execution (not recommended, may timeout)
app.post('/run-fido/sync', async (req, res) => {
  const { testDetails,repoURL, repoBranch, executionId, workflowType, isDefaultBuildAndRun } = req.body
  
  console.log(`🔗 [SYNC ${executionId}] Received FIDO execution request`)
  console.log(`   Repo: ${repoURL}@${repoBranch}`)
  console.log(`   Tool type: ${testDetails?.filename || 'N/A'}`)
  
  // Validate required parameters
  if (!repoURL || !repoBranch || !workflowType || isDefaultBuildAndRun === undefined) {
    return res.status(400).json({
      success: false,
      output: 'Missing required parameters: repoURL, repoBranch, workflowType, isDefaultBuildAndRun',
    })
  }
  
  const finalExecutionId = executionId || `exec-${Date.now()}`
  
  // Track execution
  activeExecutions.set(finalExecutionId, {
    startTime: new Date(),
    status: 'running',
    repoURL,
    repoBranch,
    testDetails
  })

  try {
    // Create a temporary file for results
    const resultFile = path.join('/tmp', `fido-results-${finalExecutionId}.json`)
    
    // Execute the entry-point.ts script with file-based communication
    const entryPointPath = path.join(__dirname, 'entry-point.ts')
    const testDetailsJson = testDetails ? JSON.stringify(testDetails) : ''
    // Escape the JSON string for shell - use double quotes and escape internal quotes
    const escapedTestDetails = testDetailsJson.replace(/"/g, '\\"')
    const command = `npx tsx "${entryPointPath}" "${repoURL}" "${repoBranch}" "${finalExecutionId}" "${resultFile}" "${escapedTestDetails}" "${workflowType}" ${isDefaultBuildAndRun}`

    console.log(`🚀 [SYNC ${finalExecutionId}] Executing: ${command}`)
    console.log(`📁 [SYNC ${finalExecutionId}] Results will be written to: ${resultFile}`)
    
    const result = await new Promise((resolve, reject) => {
      const child = exec(command, {
        cwd: __dirname,
        timeout: 600000, // 10 minutes timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for logs
      })
      
      let stdout = ''
      let stderr = ''
      
      child.stdout?.on('data', (data) => {
        stdout += data
        console.log(`[${finalExecutionId}] ${data}`)
      })
      
      child.stderr?.on('data', (data) => {
        stderr += data
        console.error(`[${finalExecutionId}] ${data}`)
      })
      
      child.on('close', (code) => {
        console.log(`✅ [SYNC ${finalExecutionId}] Process completed with exit code: ${code}`)
        
        // Read results from file instead of parsing stdout
        try {
          if (fs.existsSync(resultFile)) {
            const fileContent = fs.readFileSync(resultFile, 'utf8')
            const result = JSON.parse(fileContent)
            console.log(`📁 [SYNC ${finalExecutionId}] Successfully read results from file`)
            
            // Clean up the result file
            try {
              fs.unlinkSync(resultFile)
              console.log(`🧹 [SYNC ${finalExecutionId}] Cleaned up result file`)
            } catch (cleanupError) {
              console.warn(`⚠️ [SYNC ${finalExecutionId}] Failed to cleanup result file: ${cleanupError.message}`)
            }
            
            resolve(result)
          } else {
            console.error(`❌ [SYNC ${finalExecutionId}] Result file not found: ${resultFile}`)
            resolve({
              success: false,
              output: `Result file not found. Exit code: ${code}\nProcess output: ${stdout}\nProcess errors: ${stderr}`,
            })
          }
        } catch (readError) {
          console.error(`❌ [SYNC ${finalExecutionId}] Failed to read result file: ${readError.message}`)
          resolve({
            success: false,
            output: `Failed to read results: ${readError.message}\nExit code: ${code}`,
          })
        }
      })
      
      child.on('error', (error) => {
        console.error(`❌ [SYNC ${finalExecutionId}] Process error: ${error.message}`)
        
        // Try to read partial results from file
        try {
          if (fs.existsSync(resultFile)) {
            const fileContent = fs.readFileSync(resultFile, 'utf8')
            const result = JSON.parse(fileContent)
            console.log(`📁 [SYNC ${finalExecutionId}] Read partial results from file despite process error`)
            fs.unlinkSync(resultFile) // cleanup
            resolve(result)
            return
          }
        } catch (readError) {
          // Fall through to default error handling
        }
        
        resolve({
          success: false,
          output: `Process execution error: ${error.message}`,
        })
      })
    })

    console.log(`🔍 [SYNC ${finalExecutionId}] Results processed successfully`)
    
    // Update execution status
    activeExecutions.set(finalExecutionId, {
      ...activeExecutions.get(finalExecutionId),
      status: result.success ? 'completed' : 'failed',
      endTime: new Date(),
      result
    })
    
    console.log(`📊 [SYNC ${finalExecutionId}] Execution completed:`)
    console.log(`   Success: ${result.success}`)
    console.log(`   Tests: ${result.testResults?.passed}/${result.testResults?.total} passed`)
    
    // Send the result
    res.json(result)
    
    // Clean up execution tracking after 1 hour
    setTimeout(() => {
      activeExecutions.delete(finalExecutionId)
    }, 3600000)
    
  } catch (error) {
    console.error(`❌ [SYNC ${finalExecutionId}] Execution failed: ${error.message}`)
    
    // Update execution status
    activeExecutions.set(finalExecutionId, {
      ...activeExecutions.get(finalExecutionId),
      status: 'failed',
      endTime: new Date(),
      error: error.message
    })
    
    res.status(500).json({
      success: false,
      output: `Execution failed: ${error.message}`,
    })
  }
})

// ============================================================================
// BACKGROUND JOB EXECUTION
// ============================================================================

/**
 * Execute FIDO job in background without blocking the HTTP response
 */
async function executeJobInBackground(job) {
  console.log(`🚀 [JOB ${job.id}] Starting background job execution`)
  
  try {
    // Update job status to processing
    startJobExecution(job.id)
    
    // Clone repo
    updateJobProgress(job.id, 'Cloning repository...')
    console.log(`[JOB ${job.id}] Cloning ${job.repoURL}@${job.repoBranch}`)
    
    // Execute the actual conformance testing via entry-point.ts
    updateJobProgress(job.id, 'Executing conformance testing...')
    
    const executionId = job.executionId || job.id
    const resultFile = path.join('/tmp', `fido-results-${job.id}.json`)
    const entryPointPath = path.join(__dirname, 'entry-point.ts')
    const testDetailsJson = job.testDetails ? JSON.stringify(job.testDetails) : ''
    const escapedTestDetails = testDetailsJson.replace(/"/g, '\\"')
    
    const command = `npx tsx "${entryPointPath}" "${job.repoURL}" "${job.repoBranch}" "${executionId}" "${resultFile}" "${escapedTestDetails}"`
    
    console.log(`🚀 [JOB ${job.id}] Executing: ${command}`)
    console.log(`📁 [JOB ${job.id}] Results will be written to: ${resultFile}`)
    
    const result = await new Promise((resolve) => {
      const child = exec(command, {
        cwd: __dirname,
        timeout: 600000, // 10 minutes timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for logs
      })
      
      let stdout = ''
      let stderr = ''
      
      child.stdout?.on('data', (data) => {
        stdout += data
        console.log(`[JOB ${job.id}] ${data}`)
      })
      
      child.stderr?.on('data', (data) => {
        stderr += data
        console.error(`[JOB ${job.id}] ${data}`)
      })
      
      child.on('close', (code) => {
        console.log(`✅ [JOB ${job.id}] Process completed with exit code: ${code}`)
        
        // Read results from file
        try {
          if (fs.existsSync(resultFile)) {
            const fileContent = fs.readFileSync(resultFile, 'utf8')
            const result = JSON.parse(fileContent)
            console.log(`📁 [JOB ${job.id}] Successfully read results from file`)
            
            // Clean up the result file
            try {
              fs.unlinkSync(resultFile)
              console.log(`🧹 [JOB ${job.id}] Cleaned up result file`)
            } catch (cleanupError) {
              console.warn(`⚠️ [JOB ${job.id}] Failed to cleanup result file: ${cleanupError.message}`)
            }
            
            resolve(result)
          } else {
            console.error(`❌ [JOB ${job.id}] Result file not found: ${resultFile}`)
            resolve({
              success: false,
              output: `Result file not found. Exit code: ${code}\nProcess output: ${stdout}\nProcess errors: ${stderr}`,
            })
          }
        } catch (readError) {
          console.error(`❌ [JOB ${job.id}] Failed to read result file: ${readError.message}`)
          resolve({
            success: false,
            output: `Failed to read results: ${readError.message}\nExit code: ${code}`,
          })
        }
      })
      
      child.on('error', (error) => {
        console.error(`❌ [JOB ${job.id}] Process error: ${error.message}`)
        
        // Try to read partial results from file
        try {
          if (fs.existsSync(resultFile)) {
            const fileContent = fs.readFileSync(resultFile, 'utf8')
            const result = JSON.parse(fileContent)
            console.log(`📁 [JOB ${job.id}] Read partial results from file despite process error`)
            fs.unlinkSync(resultFile) // cleanup
            resolve(result)
            return
          }
        } catch (readError) {
          // Fall through to default error handling
        }
        
        resolve({
          success: false,
          output: `Process execution error: ${error.message}`,
        })
      })
    })

    console.log(`🔍 [JOB ${job.id}] Results processed successfully`)
    console.log(`📊 [JOB ${job.id}] Execution completed:`)
    console.log(`   Success: ${result.success}`)
    console.log(`   Tests: ${result.testResults?.passed}/${result.testResults?.total} passed`)
    
    // Update job with result
    completeJob(job.id, result)
    console.log(`✅ [JOB ${job.id}] Job completed successfully`)
    
  } catch (error) {
    console.error(`❌ [JOB ${job.id}] Background job execution failed:`, error)
    failJob(job.id, error.message || 'Unknown error during job execution')
  }
}

// ============================================================================
// LEGACY ENDPOINTS
// ============================================================================

// Get execution status endpoint
app.get('/status/:executionId', (req, res) => {
  const { executionId } = req.params
  const execution = activeExecutions.get(executionId)
  
  if (!execution) {
    return res.status(404).json({
      error: 'Execution not found',
      executionId
    })
  }
  
  res.json({
    executionId,
    status: execution.status,
    startTime: execution.startTime,
    endTime: execution.endTime,
    repoURL: execution.repoURL,
    repoBranch: execution.repoBranch,
    result: execution.result
  })
})

// List active executions
app.get('/executions', (req, res) => {
  const executions = Array.from(activeExecutions.entries()).map(([id, data]) => ({
    executionId: id,
    status: data.status,
    startTime: data.startTime,
    endTime: data.endTime,
    repoURL: data.repoURL,
    repoBranch: data.repoBranch
  }))
  
  res.json({
    totalExecutions: executions.length,
    executions
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Express error:', error)
  res.status(500).json({
    success: false,
    output: `Server error: ${error.message}`,
    executedAt: new Date().toISOString()
  })
})

// Start server
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || 'localhost'

app.listen(PORT, HOST, () => {
  console.log(`🟢 Mac FIDO Agent running on http://${HOST}:${PORT}`)
  console.log(`📱 Health check: http://${HOST}:${PORT}/health`)
  console.log(`🔗 FIDO async endpoint: http://${HOST}:${PORT}/run-fido`)
  console.log(`📊 Job status: http://${HOST}:${PORT}/run-fido/status/:jobId`)
  console.log(`📥 Job result: http://${HOST}:${PORT}/run-fido/result/:jobId`)
  console.log(`📋 Jobs list: http://${HOST}:${PORT}/run-fido/jobs`)
  console.log(`🔗 FIDO sync endpoint: http://${HOST}:${PORT}/run-fido/sync`)
  console.log(`📊 Status endpoint: http://${HOST}:${PORT}/status/:executionId`)
  console.log(`📋 Executions list: http://${HOST}:${PORT}/executions`)
  console.log(`⏰ Server started at: ${new Date().toISOString()}`)
  
  // Clean up any stale result files from previous runs
  cleanupStaleResultFiles()
  
  // Set up periodic cleanup every hour
  setInterval(cleanupStaleResultFiles, 60 * 60 * 1000)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...')
  process.exit(0)
})
