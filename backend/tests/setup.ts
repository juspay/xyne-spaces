// Global test setup
beforeAll(() => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
});

afterAll(() => {
  // Cleanup after all tests
});

// Global error handler for tests
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection in tests:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception in tests:', error);
});