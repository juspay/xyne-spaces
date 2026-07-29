import request from 'supertest';
import { PrismaClient, TicketCategory, TicketEnvironment, ReportedBy, TicketStatus } from '@prisma/client';
import { App } from '../app';

const prisma = new PrismaClient();

describe('Ticket API', () => {
  let appInstance: App;

  beforeAll(async () => {
    await prisma.ticket.deleteMany();
    appInstance = new App();
    await appInstance.initializeDatabase();
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany();
    await prisma.$disconnect();
    await appInstance.shutdown();
  });

  describe('POST /api/tickets', () => {
    it('should create a new ticket', async () => {
      const ticketData = {
        title: `Test Ticket ${Date.now()}`,
        workflowType: TicketCategory.QUERY,
        description: 'Test description',
        attachments: [],
        createdBy: 'test-user',
        environment: TicketEnvironment.DEVELOPMENT,
        reportedBy: ReportedBy.INTERNAL
      };

      const response = await request(appInstance.app)
        .post('/api/tickets')
        .send(ticketData)
        .expect(201);

      expect(response.body).toHaveProperty('ticketId');
      expect(response.body).toHaveProperty('status', 'created');
    });
  });

  describe('GET /api/tickets/:id', () => {
    let ticketId: string;

    beforeEach(async () => {
      const ticket = await prisma.ticket.create({
        data: {
          title: `Test Ticket ${Date.now()}`,
          workflowType: TicketCategory.QUERY,
          description: 'Test description',
          attachments: null,
          createdBy: 'test-user',
          environment: TicketEnvironment.DEVELOPMENT,
          reportedBy: ReportedBy.INTERNAL,
          status: TicketStatus.OPENED,
          humanReadableId: `TEST-${Date.now()}`
        }
      });
      ticketId = ticket.id;
    });

    it('should get ticket by ID', async () => {
      const response = await request(appInstance.app)
        .get(`/api/tickets/${ticketId}`)
        .expect(200);

      expect(response.body).toHaveProperty('ticketId', ticketId);
    });
  });

  describe('GET /api/tickets/hr/:humanReadableId', () => {
    let humanReadableId: string;

    beforeEach(async () => {
      const ticket = await prisma.ticket.create({
        data: {
          title: `Test Ticket ${Date.now()}`,
          workflowType: TicketCategory.QUERY,
          description: 'Test description',
          attachments: null,
          createdBy: 'test-user',
          environment: TicketEnvironment.PRODUCTION,
          reportedBy: ReportedBy.MERCHANT,
          status: TicketStatus.OPENED,
          humanReadableId: `TEST-${Date.now()}`
        }
      });
      humanReadableId = ticket.humanReadableId!;
    });

    it('should get ticket by human readable ID', async () => {
      const response = await request(appInstance.app)
        .get(`/api/tickets/hr/${humanReadableId}`)
        .expect(200);

      expect(response.body).toHaveProperty('humanReadableId', humanReadableId);
    });
  });

  describe('GET /api/tickets', () => {
    beforeEach(async () => {
      await prisma.ticket.create({
        data: {
          title: `Test Ticket ${Date.now()}`,
          workflowType: TicketCategory.QUERY,
          description: 'Test description',
          attachments: null,
          createdBy: 'test-user',
          environment: TicketEnvironment.DEVELOPMENT,
          reportedBy: ReportedBy.INTERNAL,
          status: TicketStatus.OPENED,
          humanReadableId: `TEST-${Date.now()}`
        }
      });
    });

    it('should get all tickets', async () => {
      const response = await request(appInstance.app)
        .get('/api/tickets')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });
});