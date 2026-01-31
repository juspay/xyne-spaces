import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Global test configuration
const globalSetup = (): void => {
  // Set global timeout for integration tests
  jest.setTimeout(30000); // 30 seconds

  // Ensure required environment variables for integration tests
  const requiredEnvVars = [
    'VERTEX_PROJECT_ID'
  ];

  // Optional environment variables (for documentation)
  // const optionalEnvVars = ['VERTEX_KEY_FILE', 'VERTEX_USE_ADC', 'VERTEX_REGION'];

  const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missingVars.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '⚠️  Missing environment variables for integration tests:',
      missingVars.join(', ')
    );
    // eslint-disable-next-line no-console
    console.warn('Integration tests will be skipped.');
    // eslint-disable-next-line no-console
    console.warn('To run integration tests, create a .env.test file with the required variables.');
  } else {
    // eslint-disable-next-line no-console
    console.log('✅ All required environment variables found for integration tests');
  }
};

// Export setup function
export default globalSetup;

// Run setup immediately
globalSetup();