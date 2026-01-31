// Example Node.js agent demonstrating the Local Agent Authorization Protocol

const http = require('http');

const ELECTRON_PORT = 49231;
const BASE_URL = `http://127.0.0.1:${ELECTRON_PORT}`;

/**
 * Request authorization from the Electron app
 */
async function requestAuthorization(agentName, description, requestedScopes) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      agentName,
      agentType: 'nodejs-script',
      description,
      requestedScopes
    });

    const options = {
      hostname: '127.0.0.1',
      port: ELECTRON_PORT,
      path: '/auth/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: 60000 // Give user time to approve
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          
          if (response.status === 'approved') {
            console.log('✓ Authorization approved!');
            console.log(`  Token expires at: ${new Date(response.expiresAt).toISOString()}`);
            console.log(`  Granted scopes: ${response.scopes.join(', ')}`);
            resolve(response.accessToken);
          } else if (response.status === 'denied') {
            console.log(`✗ Authorization denied: ${response.reason}`);
            resolve(null);
          } else {
            console.log(`✗ Unexpected response:`, response);
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        console.log(`✗ Could not connect to Electron app at ${BASE_URL}`);
        console.log('  Make sure the Electron app is running');
        resolve(null);
      } else {
        reject(error);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      console.log('✗ Authorization request timed out');
      resolve(null);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Make an authenticated request
 */
async function makeAuthenticatedRequest(token, endpoint, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: ELECTRON_PORT,
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          
          if (res.statusCode === 401 || res.statusCode === 403) {
            console.log(`✗ Authorization failed: ${response.message}`);
            console.log('  Token may have expired or been revoked');
            resolve(null);
          } else {
            resolve(response);
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Release the authorization session
 */
async function releaseSession(token) {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: ELECTRON_PORT,
      path: '/auth/release',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✓ Session released successfully');
        } else {
          console.log(`⚠ Failed to release session: ${body}`);
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.log(`⚠ Failed to release session: ${error.message}`);
      resolve();
    });

    req.end();
  });
}

/**
 * Main example workflow
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Example Node.js Agent - Authorization Demo');
  console.log('='.repeat(60));
  console.log();

  try {
    // Step 1: Request authorization
    console.log('Step 1: Requesting authorization...');
    console.log('  (Check the Electron app for the consent dialog)');
    console.log();

    const token = await requestAuthorization(
      'Example Node.js Agent',
      'Demonstrates the Local Agent Authorization Protocol',
      ['read:data', 'example:scope']
    );

    if (!token) {
      console.log();
      console.log('Authorization failed. Exiting.');
      process.exit(1);
    }

    console.log();
    console.log('-'.repeat(60));
    console.log();

    // Step 2: Use the token
    console.log('Step 2: Making authenticated requests...');
    console.log();

    // Test health endpoint
    console.log('Testing health endpoint (no auth required):');
    const healthReq = http.get(`${BASE_URL}/health`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const health = JSON.parse(body);
        console.log(`  Status: ${health.status}`);
        console.log();

        // Continue with protected endpoint test
        continueDemo(token);
      });
    });

    healthReq.on('error', (error) => {
      console.log(`  Failed: ${error.message}`);
      console.log();
      continueDemo(token);
    });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

/**
 * Continue demo after health check
 */
async function continueDemo(token) {
  // Test protected endpoint
  console.log('Testing protected endpoint (requires auth):');
  console.log('  Note: This will fail unless you implement the endpoint');
  const result = await makeAuthenticatedRequest(token, '/api/protected');
  if (result) {
    console.log(`  Response:`, result);
  }

  console.log();
  console.log('-'.repeat(60));
  console.log();

  // Step 3: Release session
  console.log('Step 3: Releasing session...');
  await releaseSession(token);

  console.log();
  console.log('='.repeat(60));
  console.log('Demo complete!');
  console.log('='.repeat(60));
}

// Run the example
main();
