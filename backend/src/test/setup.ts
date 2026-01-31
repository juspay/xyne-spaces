import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/xyne_spaces';
process.env.PORT = '3001';
process.env.HOST = 'localhost';
process.env.CORS_ORIGIN = 'http://localhost:3000';

beforeAll(async () => {
  try {
    // Clean up database before tests
    await prisma.ticket.deleteMany();
  } catch (error) {
    console.log('Database cleanup failed, continuing with tests...');
  }
});

afterAll(async () => {
  try {
    // Clean up database after tests
    await prisma.ticket.deleteMany();
    await prisma.$disconnect();
  } catch (error) {
    console.log('Database cleanup failed on shutdown...');
  }
});

beforeEach(async () => {
  try {
    // Clean up before each test
    await prisma.ticket.deleteMany();
  } catch (error) {
    console.log('Database cleanup failed before test...');
  }
});