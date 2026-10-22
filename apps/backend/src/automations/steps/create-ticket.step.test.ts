jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@xyne/shared', () => ({
  BaseTicketType: { Fix: 'Fix', Release: 'Release', Hotfix: 'Hotfix' },
  TicketPriority: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' },
  TicketStatusV2: { TODO: 'TODO', STARTED: 'STARTED', COMPLETED: 'COMPLETED' },
}));
jest.mock('@/services/agents/title-generator', () => ({ generateTitle: jest.fn() }));
jest.mock('@/utils/contentUtils', () => ({ extractPlainTextFromHtml: (t: string) => t }));

const createTicketMock = jest.fn();
jest.mock('@/controllers/ticketController', () => ({
  TicketController: jest.fn().mockImplementation(() => ({ createTicket: createTicketMock })),
}));

import { buildDynamicFields, createTicketStep } from './create-ticket.step';

const context = {
  automation: { createdById: 'user-1', workspaceId: 'ws-1' },
} as never;

const baseConfig = {
  title: 'euler-credit-db PR #1',
  description: 'merged',
  channelId: 'ch-1',
  projectId: 'proj-1',
  boardId: 'board-1',
};

beforeEach(() => {
  createTicketMock.mockReset();
  createTicketMock.mockImplementation(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
    res.status(201).json({ id: 't-1', xyneId: 'X-1', boardId: 'board-1', conversationId: 'c-1' });
  });
});

describe('buildDynamicFields', () => {
  it('maps field names to trimmed string values', () => {
    expect(
      buildDynamicFields([
        { fieldName: 'branch', value: ' release-sandbox ' },
        { fieldName: 'newCommitId', value: 'abc123' },
      ])
    ).toEqual({ branch: 'release-sandbox', newCommitId: 'abc123' });
  });

  it('drops blank, null and undefined values and empty names', () => {
    expect(
      buildDynamicFields([
        { fieldName: 'branch', value: '' },
        { fieldName: 'deployedCommitId', value: null },
        { fieldName: 'newCommitId' },
        { fieldName: '  ', value: 'x' },
      ])
    ).toEqual({});
  });

  it('returns an empty map when no fields are given', () => {
    expect(buildDynamicFields(undefined)).toEqual({});
  });
});

describe('CreateTicketStep', () => {
  it('accepts ticketType and formFields in its config schema', () => {
    const parsed = createTicketStep.configSchema.safeParse({
      ...baseConfig,
      ticketType: 'Release',
      formFields: [{ fieldName: 'branch', value: '{{trigger.body.branch}}' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown ticket type', () => {
    const parsed = createTicketStep.configSchema.safeParse({ ...baseConfig, ticketType: 'Nope' });
    expect(parsed.success).toBe(false);
  });

  it('passes ticketType and dynamicFields to the ticket controller', async () => {
    await createTicketStep.execute(
      {
        ...baseConfig,
        ticketType: 'Release',
        formFields: [
          { fieldName: 'branch', value: 'release-sandbox' },
          { fieldName: 'deployedCommitId', value: 'aaa' },
          { fieldName: 'newCommitId', value: 'bbb' },
        ],
      } as never,
      context
    );
    const req = createTicketMock.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(req.body.ticketType).toBe('Release');
    expect(req.body.dynamicFields).toEqual({
      branch: 'release-sandbox',
      deployedCommitId: 'aaa',
      newCommitId: 'bbb',
    });
  });

  it('keeps the old request shape when the new fields are not set', async () => {
    await createTicketStep.execute(baseConfig as never, context);
    const req = createTicketMock.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(req.body).not.toHaveProperty('ticketType');
    expect(req.body).not.toHaveProperty('dynamicFields');
  });
});
