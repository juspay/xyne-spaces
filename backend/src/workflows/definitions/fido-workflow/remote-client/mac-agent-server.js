#!/usr/bin/env node

const express = require('express')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')

const app = express()
app.use(express.json({ limit: '10mb' }))

// Store for tracking active executions
const activeExecutions = new Map()

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

// Main FIDO execution endpoint
app.post('/run-fido', async (req, res) => {
  const { repoURL, repoBranch, executionId, fidoToolPath, testType } = req.body
  
  console.log(`🔗 [${executionId}] Received FIDO execution request`)
  console.log(`   Repo: ${repoURL}@${repoBranch}`)
  console.log(`   FIDO Tool: ${fidoToolPath}`)
  console.log(`   Tool type: ${testType || 'N/A'}`)
  
  // Validate required parameters
  if (!repoURL || !repoBranch || !testType) {
    return res.status(400).json({
      success: false,
      output: 'Missing required parameters: repoURL and repoBranch and testType are required',
      testResults: { passed: 0, failed: 1, total: 1 },
      executedAt: new Date().toISOString()
    })
  }
  
  const finalExecutionId = executionId || `exec-${Date.now()}`
  const finalFidoToolPath = fidoToolPath || '/Applications/FIDO Alliance - Certification Conformance Testing Tools.app/Contents/MacOS/FIDO Alliance - Certification Conformance Testing Tools'
  
  // Track execution
  activeExecutions.set(finalExecutionId, {
    startTime: new Date(),
    status: 'running',
    repoURL,
    repoBranch,
    testType
  })

  try {
    // Create a temporary file for results
    const resultFile = path.join('/tmp', `fido-results-${finalExecutionId}.json`)
    
    // Execute the entry-point.ts script with file-based communication
    const entryPointPath = path.join(__dirname, 'entry-point.ts')
    const command = `npx tsx "${entryPointPath}" "${repoURL}" "${repoBranch}" "${finalExecutionId}" "${finalFidoToolPath}" "${resultFile}" "${testType}"`
    
    console.log(`🚀 [${finalExecutionId}] Executing: ${command}`)
    console.log(`📁 [${finalExecutionId}] Results will be written to: ${resultFile}`)
    
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
        console.log(`✅ [${finalExecutionId}] Process completed with exit code: ${code}`)
        
        // Read results from file instead of parsing stdout
        try {
          if (fs.existsSync(resultFile)) {
            const fileContent = fs.readFileSync(resultFile, 'utf8')
            const result = JSON.parse(fileContent)
            console.log(`📁 [${finalExecutionId}] Successfully read results from file`)
            
            // Clean up the result file
            try {
              fs.unlinkSync(resultFile)
              console.log(`🧹 [${finalExecutionId}] Cleaned up result file`)
            } catch (cleanupError) {
              console.warn(`⚠️ [${finalExecutionId}] Failed to cleanup result file: ${cleanupError.message}`)
            }
            
            resolve(result)
          } else {
            console.error(`❌ [${finalExecutionId}] Result file not found: ${resultFile}`)
            resolve({
              success: false,
              output: `Result file not found. Exit code: ${code}\nProcess output: ${stdout}\nProcess errors: ${stderr}`,
              testResults: { passed: 0, failed: 1, total: 1 },
              executedAt: new Date().toISOString()
            })
          }
        } catch (readError) {
          console.error(`❌ [${finalExecutionId}] Failed to read result file: ${readError.message}`)
          resolve({
            success: false,
            output: `Failed to read results: ${readError.message}\nExit code: ${code}`,
            testResults: { passed: 0, failed: 1, total: 1 },
            executedAt: new Date().toISOString()
          })
        }
      })
      
      child.on('error', (error) => {
        console.error(`❌ [${finalExecutionId}] Process error: ${error.message}`)
        
        // Try to read partial results from file
        try {
          if (fs.existsSync(resultFile)) {
            const fileContent = fs.readFileSync(resultFile, 'utf8')
            const result = JSON.parse(fileContent)
            console.log(`📁 [${finalExecutionId}] Read partial results from file despite process error`)
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
          testResults: { passed: 0, failed: 1, total: 1 },
          executedAt: new Date().toISOString()
        })
      })
    })

    console.log(`🔍 [${finalExecutionId}] Results processed successfully`)
    
    // Update execution status
    activeExecutions.set(finalExecutionId, {
      ...activeExecutions.get(finalExecutionId),
      status: result.success ? 'completed' : 'failed',
      endTime: new Date(),
      result
    })
    
    console.log(`📊 [${finalExecutionId}] Execution completed:`)
    console.log(`   Success: ${result.success}`)
    console.log(`   Tests: ${result.testResults?.passed}/${result.testResults?.total} passed`)
    
    // Send the result
    res.json(result)
    
    // Clean up execution tracking after 1 hour
    setTimeout(() => {
      activeExecutions.delete(finalExecutionId)
    }, 3600000)
    
  } catch (error) {
    console.error(`❌ [${finalExecutionId}] Execution failed: ${error.message}`)
    
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
      testResults: { passed: 0, failed: 1, total: 1 },
      executedAt: new Date().toISOString()
    })
  }
})

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
  console.log(`🔗 FIDO endpoint: http://${HOST}:${PORT}/run-fido`)
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
