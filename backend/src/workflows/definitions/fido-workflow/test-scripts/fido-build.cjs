#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

// Get working directory from command line argument
const workingDirectory = process.argv[2];

// Optional output file parameter for writing results
const outputFile = process.argv[3];

if (!workingDirectory) {
  const result = {
    success: false,
    output: '',
    error: 'Working directory argument is required',
    workingDirectory: '',
    executedAt: new Date().toISOString()
  };
  console.error(JSON.stringify(result));
  process.exit(1);
}

console.error(`🔨 Running cargo build in ${workingDirectory}...`);

// Use spawn instead of exec to avoid shell command injection
// Environment variables are passed via env option instead of command string
const buildProcess = spawn('cargo', ['build'], {
  cwd: workingDirectory,
  env: {
    ...process.env,
    RUSTFLAGS: '-A warnings'
  }
});

let buildStdout = '';
let buildStderr = '';

buildProcess.stdout?.on('data', (data) => {
  buildStdout += data;
  process.stdout.write(data);
});

buildProcess.stderr?.on('data', (data) => {
  buildStderr += data;
  process.stderr.write(data);
});

buildProcess.on('close', (code) => {
  const result = {
    success: code === 0,
    output: buildStdout,
    error: code === 0 ? '' : `Cargo build failed with exit code ${code}. Stderr: ${buildStderr}`,
    workingDirectory: workingDirectory,
    executedAt: new Date().toISOString()
  };
  
  console.error(code === 0 ? '[BUILD] ✅ Cargo build completed successfully' : `❌ Build failed: ${result.error}`);
  
  // Write to output file if provided
  if (outputFile) {
    try {
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
      console.error(`✅ Results written to ${outputFile}`);
    } catch (writeError) {
      console.error(`❌ Failed to write results to ${outputFile}: ${writeError.message}`);
    }
  }
  
  // Always output to stdout for backward compatibility
  console.log(JSON.stringify(result));
  process.exit(code === 0 ? 0 : 1);
});

buildProcess.on('error', (err) => {
  const result = {
    success: false,
    output: '',
    error: `Cargo build process error: ${err.message}`,
    workingDirectory: workingDirectory,
    executedAt: new Date().toISOString()
  };
  
  console.error(`❌ Build process error: ${err.message}`);
  
  // Write to output file if provided
  if (outputFile) {
    try {
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
      console.error(`✅ Results written to ${outputFile}`);
    } catch (writeError) {
      console.error(`❌ Failed to write results to ${outputFile}: ${writeError.message}`);
    }
  }
  
  console.log(JSON.stringify(result));
  process.exit(1);
});