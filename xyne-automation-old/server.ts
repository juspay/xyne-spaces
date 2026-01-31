import express from 'express';
import { exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Test Automation Server is running',
    endpoints: {
      'GET /': 'Health check',
      'POST /run-tests': 'Trigger staggered tests',
      'GET /status': 'Server status'
    }
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'healthy',
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Endpoint to trigger the staggered tests
app.post('/run-tests', (req, res) => {
  const scriptPath = path.join(process.cwd(), 'run-staggered-tests-server.sh');
  const logFile = path.join(process.cwd(), 'server-test-logs.log');
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] Received request to run tests`);
  
  // Immediately respond that tests have started
  res.json({
    success: true,
    message: 'Tests have started, you can  check reports in #xyne-automation channel on Slack',
    status: 'running',
    timestamp: timestamp,
    logFile: 'server-test-logs.log'
  });
  
  // Log the start of test execution
  const startLog = `\n=== Test Execution Started ===\nTimestamp: ${timestamp}\nTriggered via: POST /run-tests\n`;
  fs.appendFileSync(logFile, startLog);
  console.log('📝 Tests started - logging to server-test-logs.log');
  
  // Execute the shell script in background with real-time output streaming
  const testProcess = spawn('bash', [scriptPath], { 
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Stream stdout to log file in real-time
  testProcess.stdout.on('data', (data) => {
    const output = data.toString();
    fs.appendFileSync(logFile, output);
    console.log('📝 Test output:', output.trim());
  });

  // Stream stderr to log file in real-time
  testProcess.stderr.on('data', (data) => {
    const output = data.toString();
    fs.appendFileSync(logFile, output);
    console.warn('⚠️  Test stderr:', output.trim());
  });

  // Handle process completion
  testProcess.on('close', (code) => {
    const endTimestamp = new Date().toISOString();
    
    if (code === 0) {
      const successLog = `\n[${endTimestamp}]  Test execution completed successfully (exit code: ${code})\n=== Test Execution Completed ===\n`;
      fs.appendFileSync(logFile, successLog);
      console.log(`[${endTimestamp}]  Test execution completed successfully`);
    } else {
      const errorLog = `\n[${endTimestamp}] ❌ Test execution failed (exit code: ${code})\n=== Test Execution Failed ===\n`;
      fs.appendFileSync(logFile, errorLog);
      console.error(`[${endTimestamp}] ❌ Test execution failed with exit code:`, code);
    }
  });

  // Handle process errors
  testProcess.on('error', (error) => {
    const endTimestamp = new Date().toISOString();
    const errorLog = `\n[${endTimestamp}] ERROR: ${error.message}\n${error.stack}\n=== Test Execution Failed ===\n`;
    fs.appendFileSync(logFile, errorLog);
    console.error(`[${endTimestamp}] ❌ Test process error:`, error.message);
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Test Automation Server is running on http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /         - Health check`);
  console.log(`   GET  /status   - Server status`);
  console.log(`   POST /run-tests - Trigger staggered tests`);
  console.log(`\n💡 To trigger tests, send a POST request to: http://localhost:${PORT}/run-tests`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
