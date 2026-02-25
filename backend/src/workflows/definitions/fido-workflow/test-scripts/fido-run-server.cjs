#!/usr/bin/env node

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);

// Get working directory from command line argument
const workingDirectory = process.argv[2];
const testOutputFile = process.argv[3]; // Optional output file path

if (!workingDirectory) {
  const result = {
    success: false,
    stage: 'initialization',
    logs: 'Working directory argument is required',
    errorMessage: 'Working directory argument is required',
    serverStarted: false,
    serverReady: false,
    port: 8080,
    startupTime: 0,
    output: '',
    error: '',
    executedAt: new Date().toISOString()
  };
  console.log(JSON.stringify(result));
  // Write to file if provided
  if (testOutputFile) {
    try {
      fs.writeFileSync(testOutputFile, JSON.stringify(result, null, 2));
    } catch (writeErr) {
      console.error(`Failed to write to file: ${writeErr.message}`);
    }
  }
  process.exit(1);
}

// Logging helper that accumulates logs
function log(message, accumulator) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message}`;
  console.error(logMsg);
  if (accumulator) {
    accumulator.push(logMsg);
  }
  return logMsg;
}

console.error(` Starting FIDO server in ${workingDirectory}...`);

let serverProcess = null;
let compilationFinished = false;
let hasFailed = false;
let stdout = '';
let stderr = '';
let serverReady = false;
const startTime = Date.now();

// Clear port 8080
async function clearPort() {
  const logs = [];
  log(' Clearing port 8080...', logs);
  
  try {
    const { stdout: lsofOutput } = await execAsync('lsof -ti:8080');
    if (lsofOutput.trim()) {
      await execAsync('lsof -ti:8080 | xargs kill -9');
      log(' Port 8080 cleared', logs);
    }
  } catch (err) {
    if (err.message?.includes('No such process') || err.code === 1) {
      log(' Port 8080 already clear', logs);
    } else {
      const errorMsg = `Failed to clear port 8080: ${err.message || err}`;
      log(` ${errorMsg}`, logs);
      return {
        success: false,
        logs: logs.join('\n'),
        errorMessage: errorMsg
      };
    }
  }
  
  return {
    success: true,
    logs: logs.join('\n')
  };
}

async function setupDatabase() {
  const logs = [];
  log(' Setting up database...', logs);
  
  const env = { ...process.env, DATABASE_URL: 'postgres://localhost/fido_server' };
  
  // Drop database if exists
  log(' Dropping fido_server database if exists...', logs);
  try {
    await execAsync('dropdb fido_server', { env });
    log(' Database dropped successfully', logs);
  } catch (err) {
    log(' Database does not exist or could not be dropped (continuing)', logs);
  }
  
  // Check if database exists, if not create it
  try {
    await execAsync('psql -d postgres -c "SELECT 1 FROM pg_database WHERE datname=\'fido_server\'" | grep -q 1', { env });
    log(' fido_server database already exists', logs);
  } catch (err) {
    log(' Creating fido_server database (does not exist)...', logs);
    try {
      await execAsync('createdb fido_server', { env });
      log(' fido_server database created successfully', logs);
    } catch (createErr) {
      const errorMsg = `Failed to create fido_server database: ${createErr.message}`;
      log(` ${errorMsg}`, logs);
      return {
        success: false,
        logs: logs.join('\n'),
        errorMessage: errorMsg
      };
    }
  }
  
  // Run migrations
  log(' Running diesel migration run...', logs);
  try {
    const { stderr: migrationStderr } = await execAsync('diesel migration run', { cwd: workingDirectory, env });
    log(' Diesel migration run completed successfully', logs);
    if (migrationStderr) {
      log(`Migration warnings: ${migrationStderr.trim()}`, logs);
    }
  } catch (migrationErr) {
    const errorMsg = `Failed to run diesel migration: ${migrationErr.message}`;
    log(` ${errorMsg}`, logs);
    return {
      success: false,
      logs: logs.join('\n'),
      errorMessage: errorMsg
    };
  }
  
  return {
    success: true,
    logs: logs.join('\n')
  };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const logs = [];
    const env = { ...process.env, PORT: '8080', BIND_ADDRESS: '127.0.0.1:8080', RUSTFLAGS: '-A warnings' };
    
    log(' Starting cargo run...', logs);
    
    serverProcess = spawn('cargo', ['run'], { 
      cwd: workingDirectory,
      env,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    serverProcess.stdout?.on('data', (data) => {
      stdout += data;
      process.stdout.write(data);
      log(`[STDOUT] ${data.toString().trim()}`, logs);
      
      if (data.includes('Finished') || data.includes('Running `target/')) {
        compilationFinished = true;
        log('[COMPILATION]  Compilation finished', logs);
      }
      
      if (compilationFinished || data.toString().includes('starting service:')) {
        const serverStartPatterns = [
          'Server running at http://127.0.0.1:8080',
          'Server running at http://localhost:8080',
          'listening on: 127.0.0.1:8080',
          'listening on: localhost:8080',
          'starting service:',
          'actix_server::server] starting service',
          'Actix runtime found; starting in Actix runtime'
        ];
        
        const serverDetected = serverStartPatterns.some(pattern => 
          data.toString().toLowerCase().includes(pattern.toLowerCase())
        );
        
        if (serverDetected && !serverReady) {
          serverReady = true;
          const startupTime = Date.now() - startTime;
          log(`[SERVER]  FIDO Server startup detected! (${startupTime}ms)`, logs);
          resolve({
            success: true,
            logs: logs.join('\n')
          });
        }
      }
    });
    
    serverProcess.stderr?.on('data', (data) => {
      stderr += data;
      process.stderr.write(data);
      log(`[STDERR] ${data.toString().trim()}`, logs);
      
      if (data.includes('Finished') || data.includes('Running `target/')) {
        compilationFinished = true;
        log('[COMPILATION]  Compilation finished (detected in stderr)', logs);
      }
      
      if (data.toString().includes('starting service:') || data.toString().includes('listening on:') || data.toString().includes('actix_server::server]')) {
        if (!serverReady) {
          compilationFinished = true;
          serverReady = true;
          const startupTime = Date.now() - startTime;
          log(`[SERVER]  FIDO Server startup detected in stderr! (${startupTime}ms)`, logs);
          resolve({
            success: true,
            logs: logs.join('\n')
          });
        }
      }
    });
    
    serverProcess.on('error', (err) => {
      if (hasFailed) return;
      hasFailed = true;
      
      const errorMsg = `Cargo run failed: ${err.message}`;
      log(` ${errorMsg}`, logs);
      
      if (compilationFinished && !serverReady) {
        resolve({
          success: true,
          logs: logs.join('\n')
        });
      } else if (!compilationFinished) {
        resolve({
          success: false,
          logs: logs.join('\n'),
          errorMessage: errorMsg
        });
      }
    });
    
    serverProcess.on('exit', (code) => {
      if (hasFailed) return;
      
      if (code !== 0 && !compilationFinished) {
        hasFailed = true;
        const errorMsg = `Cargo exited with code ${code}`;
        log(` ${errorMsg}`, logs);
        resolve({
          success: false,
          logs: logs.join('\n'),
          errorMessage: errorMsg
        });
      } else if (!serverReady && compilationFinished) {
        resolve({
          success: true,
          logs: logs.join('\n')
        });
      }
    });
    
    // Timeout after 30 seconds if compilation finishes
    setTimeout(() => {
      if (hasFailed) return;
      
      if (compilationFinished) {
        log('[TIMEOUT]  Compilation finished successfully - server should be running', logs);
        if (!serverReady) {
          serverReady = true;
        }
        resolve({
          success: true,
          logs: logs.join('\n')
        });
      } else {
        hasFailed = true;
        log('[TIMEOUT]  Compilation never finished', logs);
        resolve({
          success: false,
          logs: logs.join('\n'),
          errorMessage: 'Server startup timeout - compilation never finished'
        });
      }
    }, 30000);
  });
}

async function healthCheck() {
  const logs = [];
  log('⏳ Server started, waiting 2s before port check...', logs);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  log('🔍 Checking if port 8080 is listening...', logs);
  for (let i = 0; i < 5; i++) {
    try {
      const { stdout } = await execAsync('lsof -ti:8080', { timeout: 2000 });
      if (stdout.trim()) {
        log('✅ Port 8080 is listening', logs);
        return { success: true, logs: logs.join('\n') };
      }
    } catch (err) {
      log(`⏳ Port check attempt ${i+1}/5 failed`, logs);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  log('❌ Port 8080 not listening after 5 attempts', logs);
  return { success: false, logs: logs.join('\n') };
}


// Keep the server running in background
(async () => {
  let stage = 'clearPort';
  let stageLogs = '';
  let errorMessage = '';
  
  try {
    // Stage 1: Clear port
    const clearPortResult = await clearPort();
    if (!clearPortResult.success) {
      stageLogs = clearPortResult.logs;
      errorMessage = clearPortResult.errorMessage;
      throw new Error('clearPort failed');
    }
    stageLogs = clearPortResult.logs;
    
    // Stage 2: Setup database
    stage = 'setupDatabase';
    const dbResult = await setupDatabase();
    if (!dbResult.success) {
      stageLogs += '\n\n=== Database Setup Logs ===\n' + dbResult.logs;
      errorMessage = dbResult.errorMessage;
      throw new Error('setupDatabase failed');
    }
    stageLogs += '\n\n=== Database Setup Logs ===\n' + dbResult.logs;
    
    // Stage 3: Start server
    stage = 'startServer';
    log(' Server will continue running in background...');
    const serverResult = await startServer();
    if (!serverResult.success) {
      stageLogs += '\n\n=== Server Startup Logs ===\n' + serverResult.logs;
      errorMessage = serverResult.errorMessage;
      throw new Error('startServer failed');
    }
    stageLogs += '\n\n=== Server Startup Logs ===\n' + serverResult.logs;
    
    // Stage 4: Health check
    stage = 'healthCheck';
    const healthResult = await healthCheck();
    stageLogs += '\n\n=== Health Check Logs ===\n' + healthResult.logs;
    
    const startupTime = Date.now() - startTime;
    
    // Output result but keep process running
    const result = {
      success: healthResult.success,
      stage: stage,
      logs: stageLogs,
      errorMessage: healthResult.success ? '' : 'Health check failed',
      serverStarted: true,
      serverReady: serverReady,
      port: 8080,
      startupTime: startupTime,
      output: stdout,
      error: stderr,
      healthCheckPassed: healthResult.success,
      executedAt: new Date().toISOString()
    };
    
    console.log(JSON.stringify(result));
    // Write to file if provided
    if (testOutputFile) {
      try {
        fs.writeFileSync(testOutputFile, JSON.stringify(result, null, 2));
      } catch (writeErr) {
        console.error(`Failed to write to file: ${writeErr.message}`);
      }
    }
    log(' Server is running. Exiting parent process (server continues in background).');
    
    // Exit cleanly - server continues running as child process
    process.exit(0);
  } catch (error) {
    const startupTime = Date.now() - startTime;
    
    const result = {
      success: false,
      stage: stage,
      logs: stageLogs,
      errorMessage: errorMessage || error.message,
      serverStarted: stage === 'startServer' || stage === 'healthCheck',
      serverReady: serverReady,
      port: 8080,
      startupTime: startupTime,
      output: stdout,
      error: stderr,
      executedAt: new Date().toISOString()
    };
    
    console.log(JSON.stringify(result));
    // Write to file if provided
    if (testOutputFile) {
      try {
        fs.writeFileSync(testOutputFile, JSON.stringify(result, null, 2));
      } catch (writeErr) {
        console.error(`Failed to write to file: ${writeErr.message}`);
      }
    }
    log(` Server startup failed at stage: ${stage}`);
    process.exit(1);
  }
})();
