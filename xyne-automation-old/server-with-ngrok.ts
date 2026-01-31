import express from 'express';
import { exec } from 'child_process';
import path from 'path';
import ngrok from 'ngrok';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

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
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Endpoint to trigger the staggered tests
app.post('/run-tests', (req, res) => {
  const scriptPath = path.join(process.cwd(), 'run-staggered-tests-server.sh');
  
  console.log(`[${new Date().toISOString()}] Received request to run tests`);
  
  // Execute the shell script
  exec(`bash ${scriptPath}`, { cwd: process.cwd() }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[${new Date().toISOString()}] Error executing script:`, error);
      return res.status(500).json({
        success: false,
        message: 'Failed to execute test script',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[${new Date().toISOString()}] Script executed successfully`);
    console.log('STDOUT:', stdout);
    
    if (stderr) {
      console.warn('STDERR:', stderr);
    }

    return res.json({
      success: true,
      message: 'Test script executed successfully',
      output: stdout,
      stderr: stderr || null,
      timestamp: new Date().toISOString()
    });
  });
});

// Start the server and ngrok
async function startServer() {
  try {
    // Start the Express server
    const server = app.listen(PORT, () => {
      console.log(` Test Automation Server is running on http://localhost:${PORT}`);
    });

    // Start ngrok tunnel
    console.log(' Starting ngrok tunnel...');
    const url = await ngrok.connect(PORT);
    
    console.log('\n' + '='.repeat(60));
    console.log(' PUBLIC URL (accessible from anywhere):');
    console.log(`   ${url}`);
    console.log('='.repeat(60));
    console.log('\n Available endpoints:');
    console.log(`   GET  ${url}         - Health check`);
    console.log(`   GET  ${url}/status  - Server status`);
    console.log(`   POST ${url}/run-tests - Trigger staggered tests`);
    console.log('\n To trigger tests from anywhere, send a POST request to:');
    console.log(`   ${url}/run-tests`);
    console.log('\n Example using curl:');
    console.log(`   curl -X POST ${url}/run-tests`);
    console.log('\n' + '='.repeat(60));

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await ngrok.disconnect();
      await ngrok.kill();
      server.close(() => {
        console.log(' Server and ngrok tunnel closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error(' Failed to start server or ngrok:', error);
    process.exit(1);
  }
}

startServer();
