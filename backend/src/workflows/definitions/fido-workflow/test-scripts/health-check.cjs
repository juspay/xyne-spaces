#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

// Simple health check result structure
async function checkConnection(host, port) {
  console.error(`Checking connection to ${host}:${port}...`);
  const checkName = `Connection to ${host}:${port}`;
  try {
    // Validate host and port before using in command
if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
  throw new Error('Invalid host format');
}
if (!/^\d+$/.test(port.toString()) || port < 1 || port > 65535) {
  throw new Error('Invalid port number');
}
await execAsync(`nc -z -w 5 ${host} ${port}`);
    return {
      check: checkName,
      success: true,
      details: `Successfully connected to ${host}:${port}.`,
    };
  } catch (error) {
    return {
      check: checkName,
      success: false,
      details: `Failed to connect to ${host}:${port}. Error: ${error.message}`,
      remediation: `Ensure the service on ${host}:${port} is running and accessible. Check for firewalls or network configuration issues.`,
    };
  }
}

async function checkHttp(url) {
  console.error(`Performing HTTP health check on ${url}...`);
  const checkName = `HTTP Health Check for ${url}`;
  try {
    // Validate URL format before using in command
try {
  const urlObj = new URL(url);
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    throw new Error('Invalid URL protocol');
  }
} catch (e) {
  throw new Error('Invalid URL format');
}
const { stdout } = await execAsync(`curl -s -w "%{http_code}" ${JSON.stringify(url)}`);
    const statusCode = parseInt(stdout.slice(-3), 10);
    const responseBody = stdout.slice(0, -3);
    const success = statusCode >= 200 && statusCode < 300;
    return {
      check: checkName,
      success,
      details: success 
        ? `Received successful status code ${statusCode}. Response: ${responseBody}` 
        : `Received failure status code ${statusCode}. Response: ${responseBody}`,
      remediation: success ? undefined : `The endpoint at ${url} returned a non-success status code (${statusCode}).`,
    };
  } catch (error) {
    return {
      check: checkName,
      success: false,
      details: `HTTP check failed. Error: ${error.message}`,
      remediation: `Could not reach the endpoint at ${url}. Ensure the application is running and the URL is correct.`,
    };
  }
}

async function checkPostgres(connectionString) {
  console.error('Checking Postgres connection...');
  const checkName = 'Postgres Connection';
  try {
    // Validate connection string format
if (typeof connectionString !== 'string' || connectionString.includes('"') || connectionString.includes('`') || connectionString.includes('$')) {
  throw new Error('Invalid connection string format');
}
await execAsync(`pg_isready -d "${connectionString}"`);
    return {
      check: checkName,
      success: true,
      details: 'Postgres is ready to accept connections.',
    };
  } catch (error) {
    return {
      check: checkName,
      success: false,
      details: `Postgres connection check failed. Error: ${error.message}`,
      remediation: 'Verify the Postgres server is running and the DATABASE_URL environment variable is correct. Check database server logs.',
    };
  }
}

async function checkRedis(host, port) {
  console.error('Checking Redis connection...');
  const checkName = 'Redis Connection';
  try {
    // Validate host and port before using in command
if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
  throw new Error('Invalid host format');
}
if (!/^\d+$/.test(port.toString()) || port < 1 || port > 65535) {
  throw new Error('Invalid port number');
}
const { stdout } = await execAsync(`redis-cli -h ${host} -p ${port} PING`);
    const success = stdout.trim().toUpperCase() === 'PONG';
    if (success) {
      return {
        check: checkName,
        success: true,
        details: 'Redis responded with PONG.',
      };
    } else {
      return {
        check: checkName,
        success: false,
        details: `Redis responded unexpectedly: ${stdout.trim()}`,
        remediation: `Ensure the Redis server at ${host}:${port} is configured correctly.`,
      };
    }
  } catch (error) {
    return {
      check: checkName,
      success: false,
      details: `Redis connection failed. Error: ${error.message}`,
      remediation: `Ensure the Redis server is running at ${host}:${port} and is accessible. Check the REDIS_HOST and REDIS_PORT environment variables.`,
    };
  }
}

async function runHealthChecks(config = {}) {
  const results = [];
  console.error('🚦 Starting Fido Server Health Checks...');

  // Config with defaults
  const postgresConnectionString = config.postgresUrl || 'postgres://localhost/fido_server';
  const redisHost = config.redisHost || 'localhost';
  const redisPort = config.redisPort || 6379;
  const appPort = config.appPort || 8080;
  const appHost = config.appHost || 'localhost';

  // 1. Connection Check
  results.push(await checkConnection(appHost, appPort));

  // 2. HTTP Health Check
  results.push(await checkHttp(`http://${appHost}:${appPort}/health`));

  // 3. Postgres Check
  results.push(await checkPostgres(postgresConnectionString));

  // 4. Redis Check
  results.push(await checkRedis(redisHost, redisPort));

  console.error('🚦 Fido Server Health Checks Completed.');
  return results;
}

// Main execution
(async () => {
  const outputFile = process.argv[2];
  
  if (!outputFile) {
    console.error('Error: Output file path is required');
    console.error('Usage: node health-check.cjs <output-file-path> [postgres-url] [redis-host] [redis-port] [app-host] [app-port]');
    process.exit(1);
  }

  console.error(` Output will be written to: ${outputFile}`);

  try {
    // Parse optional config from command line
    const config = {
      postgresUrl: process.argv[3] || 'postgres://localhost/fido_server',
      redisHost: process.argv[4] || 'localhost',
      redisPort: parseInt(process.argv[5] || '6379', 10),
      appHost: process.argv[6] || 'localhost',
      appPort: parseInt(process.argv[7] || '8080', 10),
    };

    console.error(` Config: ${JSON.stringify(config)}`);

    // Run health checks
    const results = await runHealthChecks(config);

    // Calculate summary
    const failedChecks = results.filter(r => !r.success);
    const success = failedChecks.length === 0;

    // Build output string with all logs
    let outputString = '🚦 Health Check Results\n\n';
    
    results.forEach((result, index) => {
      outputString += `[${index + 1}] ${result.check}\n`;
      outputString += `Status: ${result.success ? '✅ PASS' : '❌ FAIL'}\n`;
      outputString += `Details: ${result.details}\n`;
      if (!result.success && result.remediation) {
        outputString += `Remediation: ${result.remediation}\n`;
      }
      outputString += '\n';
    });

    let summary = `Health check summary: ${results.length - failedChecks.length}/${results.length} passed.\n`;
    if (!success) {
      summary += 'Failed checks:\n';
      summary += failedChecks
        .map(
          check =>
            `- ${check.check}: ${check.details}\n  Remediation: ${check.remediation}`
        )
        .join('\n');
    }

    outputString += summary;

    // Format output as expected by runTestScripts
    const output = {
      success,
      output: outputString,
    };

    // Write results to file
    // Validate and resolve output file path safely
const safeOutputFile = path.resolve(outputFile);
if (!safeOutputFile.startsWith(process.cwd())) {
  throw new Error('Output file must be within current working directory');
}
fs.writeFileSync(safeOutputFile, JSON.stringify(output, null, 2));
    console.error(`✅ Results written to ${outputFile}`);

    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error(`❌ Fatal error: ${error.message}`);

    // Write error result to file in the format expected by runTestScripts
    const errorOutput = {
      success: false,
      output: `Health check failed: ${error.message}`,
    };

    try {
      fs.writeFileSync(outputFile, JSON.stringify(errorOutput, null, 2));
    } catch (writeError) {
      console.error(`Failed to write error output: ${writeError.message}`);
    }

    process.exit(1);
  }
})();
