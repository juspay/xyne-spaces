#!/usr/bin/env node

const http = require('http');
const https = require('https');

// Get backend URL - use direct backend service for health check
const backendUrl = process.env.BACKEND_URL || 'http://xyne-backend:3001/api';
const healthEndpoint = '/health';

// Parse the URL
const url = new URL(backendUrl + healthEndpoint);
const isHttps = url.protocol === 'https:';
const client = isHttps ? https : http;

// Options for the request
const options = {
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 80),
  path: url.pathname,
  method: 'GET',
  timeout: 5000, // 5 seconds timeout
  headers: {
    'User-Agent': 'Dashboard-HealthCheck/1.0'
  }
};

console.log(`[${new Date().toISOString()}] Checking backend health: ${backendUrl}${healthEndpoint}`);

// Make the request
const req = client.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`✅ Backend healthy - Status: ${res.statusCode}`);
      try {
        const response = JSON.parse(data);
        console.log(`Backend response:`, response);
      } catch (e) {
        console.log(`Backend response: ${data}`);
      }
      process.exit(0); // Success
    } else {
      console.error(`❌ Backend unhealthy - Status: ${res.statusCode}`);
      console.error(`Response: ${data}`);
      process.exit(1); // Failure
    }
  });
});

req.on('error', (error) => {
  console.error(`❌ Backend unreachable - Error: ${error.message}`);
  process.exit(1); // Failure
});

req.on('timeout', () => {
  console.error(`❌ Backend timeout - No response within 5 seconds`);
  req.destroy();
  process.exit(1); // Failure
});

req.end();
