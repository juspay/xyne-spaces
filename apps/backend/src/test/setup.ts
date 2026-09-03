import { logger } from '@/utils/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  try {
    // Clean up database before tests
    await prisma.ticket.deleteMany();
  } catch (error) {
    logger.info('Database cleanup failed, continuing with tests...');
  }
});

afterAll(async () => {
  try {
    // Clean up database after tests
    await prisma.ticket.deleteMany();
    await prisma.$disconnect();
  } catch (error) {
    logger.info('Database cleanup failed on shutdown...');
  }
});

beforeEach(async () => {
  try {
    // Clean up before each test
    await prisma.ticket.deleteMany();
  } catch (error) {
    logger.info('Database cleanup failed before test...');
  }
});
