jest.mock('@/config/env', () => ({
  config: {
    backendUrl: 'https://backend.example/',
    meetBot: { url: 'http://meet-bot:3010', apiKey: 'bot-key' },
  },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the imports used.
jest.mock('@xyne/shared', () => ({
  // The real link parser, from source (the package's dist is ESM).
  ...jest.requireActual('../../../../packages/shared/src/utils/meetingLinks'),
  CallOrigin: { MEET_LINK: 'MEET_LINK', CHANNEL: 'CHANNEL' },
  CallStatus: { SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', ENDED: 'ENDED' },
  CallType: { VIDEO: 'VIDEO', HEADLESS: 'HEADLESS' },
  InvitationResponse: { ACCEPTED: 'ACCEPTED' },
}));
jest.mock('@/database/client', () => ({
  db: { call: { create: jest.fn(), update: jest.fn() } },
}));
jest.mock('@/database/repositories', () => ({
  repositories: { calls: { createParticipant: jest.fn(), findByExternalId: jest.fn() } },
}));
jest.mock('@/bypassAcl/meetNotetakerServices', () => ({
  findMeetNotetakerCall: jest.fn(),
  updateMeetNotetakerCallAsCreator: jest.fn(),
  findInFlightMeetNotetakerCall: jest.fn(),
  findMeetNotetakerSenderName: jest.fn(),
  addMeetNotetakerParticipant: jest.fn(),
}));
jest.mock('@/services/liveKitService', () => ({
  LIVEKIT_ROOM_MAX_PARTICIPANTS: 500,
  livekitService: {
    getRoomInfo: jest.fn(),
    resolveAgentNameForUser: jest.fn(),
    createRoom: jest.fn(),
    dispatchTranscriptionAgentForCall: jest.fn(),
    generateAccessToken: jest.fn(),
    getServerUrl: jest.fn(() => 'wss://livekit.example'),
  },
}));
jest.mock('@/controllers/noteTakerWebhookController', () => ({
  noteTakerWebhookController: { finishCall: jest.fn() },
}));
const botClient = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => botClient), isAxiosError: (e: { isAxiosError?: boolean }) => !!e?.isAxiosError },
}));

import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import {
  addMeetNotetakerParticipant,
  findInFlightMeetNotetakerCall,
  findMeetNotetakerCall,
  findMeetNotetakerSenderName,
  updateMeetNotetakerCallAsCreator,
} from '@/bypassAcl/meetNotetakerServices';
import { livekitService } from '@/services/liveKitService';
import { noteTakerWebhookController } from '@/controllers/noteTakerWebhookController';
import { meetNotetakerService } from './meetNotetakerService';

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

const botCall = (overrides: Record<string, unknown> = {}) => ({
  id: 'call-id',
  externalId: 'room-1',
  workspaceId: 'ws-1',
  createdByUserId: 'user-1',
  callOrigin: 'MEET_LINK',
  status: 'SCHEDULED',
  startedAt: null,
  metadata: { meetBot: { status: 'joining', meetingCode: 'abc-defg-hij', updatedAt: 'x' } },
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('sendToMeeting', () => {
  const input = { userId: 'user-1', workspaceId: 'ws-1', meetingUrl: 'https://meet.google.com/ABC-defg-hij?authuser=0' };

  it('rejects anything that is not a Meet or Teams link', async () => {
    await expect(meetNotetakerService.sendToMeeting({ ...input, meetingUrl: 'https://zoom.us/j/1' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(db.call.create).not.toHaveBeenCalled();
  });

  it("adds a colleague to the bot already in the Meet and names who sent it", async () => {
    const existing = botCall({ createdByUserId: 'user-2' });
    mocked(findInFlightMeetNotetakerCall).mockResolvedValue(existing);
    mocked(findMeetNotetakerSenderName).mockResolvedValue('Mayank Bansal');
    botClient.get.mockResolvedValue({ data: { status: 'in_call' } });

    await expect(meetNotetakerService.sendToMeeting(input)).resolves.toEqual({
      call: existing,
      alreadySentBy: { userId: 'user-2', name: 'Mayank Bansal' },
    });
    expect(findInFlightMeetNotetakerCall).toHaveBeenCalledWith('ws-1', 'https://meet.google.com/abc-defg-hij');
    expect(addMeetNotetakerParticipant).toHaveBeenCalledWith(existing, 'user-1');
    expect(db.call.create).not.toHaveBeenCalled();
    expect(botClient.post).not.toHaveBeenCalled();
  });

  it("doesn't re-add the sender when they send the same Meet again", async () => {
    mocked(findInFlightMeetNotetakerCall).mockResolvedValue(botCall());
    botClient.get.mockResolvedValue({ data: { status: 'waiting_room' } });
    const result = await meetNotetakerService.sendToMeeting(input);
    expect(result.alreadySentBy?.userId).toBe('user-1');
    expect(addMeetNotetakerParticipant).not.toHaveBeenCalled();
    expect(botClient.post).not.toHaveBeenCalled();
  });

  it('closes a call the bot lost track of and sends a fresh bot', async () => {
    mocked(findInFlightMeetNotetakerCall).mockResolvedValue(botCall());
    botClient.get.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    mocked(db.call.create).mockImplementation(async ({ data }) => data);
    botClient.post.mockResolvedValue({ status: 202 });

    const { call, alreadySentBy } = await meetNotetakerService.sendToMeeting(input);

    const [stale, data] = mocked(updateMeetNotetakerCallAsCreator).mock.calls[0];
    expect(stale.id).toBe('call-id');
    expect(data.status).toBe('ENDED');
    expect(data.metadata.meetBot).toMatchObject({ status: 'failed', reason: 'bot_restarted' });
    expect(alreadySentBy).toBeNull();
    expect(call.externalId).not.toBe('room-1');
    expect(botClient.post).toHaveBeenCalledTimes(1);
  });

  it('creates a scheduled MEET_LINK call, adds the user and starts a bot session', async () => {
    mocked(findInFlightMeetNotetakerCall).mockResolvedValue(null);
    mocked(db.call.create).mockImplementation(async ({ data }) => data);
    botClient.post.mockResolvedValue({ status: 202 });

    const { call, alreadySentBy } = await meetNotetakerService.sendToMeeting(input);
    expect(alreadySentBy).toBeNull();

    expect(call).toMatchObject({
      callType: 'VIDEO',
      callOrigin: 'MEET_LINK',
      status: 'SCHEDULED',
      roomLink: 'https://meet.google.com/abc-defg-hij',
      createdByUserId: 'user-1',
    });
    expect(repositories.calls.createParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ callId: call.id, userId: 'user-1', response: 'ACCEPTED' }),
    );
    expect(botClient.post).toHaveBeenCalledWith('/sessions', {
      sessionId: call.externalId,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      callbackUrl: `https://backend.example/api/meet-bot/sessions/${call.externalId}`,
    });
  });

  it('sends the bot to a Teams meeting, titled and tagged as Teams', async () => {
    mocked(findInFlightMeetNotetakerCall).mockResolvedValue(null);
    mocked(db.call.create).mockImplementation(async ({ data }) => data);
    botClient.post.mockResolvedValue({ status: 202 });

    const { call } = await meetNotetakerService.sendToMeeting({
      ...input,
      meetingUrl: 'https://teams.microsoft.com/meet/2345678901234?p=AbCd&utm=x',
    });

    expect(call).toMatchObject({
      title: 'Microsoft Teams (2345678901234)',
      roomLink: 'https://teams.microsoft.com/meet/2345678901234?p=AbCd',
      metadata: { meetBot: { platform: 'teams', meetingCode: '2345678901234', status: 'requested' } },
    });
    expect(findInFlightMeetNotetakerCall).toHaveBeenCalledWith('ws-1', 'https://teams.microsoft.com/meet/2345678901234?p=AbCd');
    expect(botClient.post).toHaveBeenCalledWith('/sessions', expect.objectContaining({
      meetingUrl: 'https://teams.microsoft.com/meet/2345678901234?p=AbCd',
    }));
  });

  it('ends the call as failed when the bot is busy', async () => {
    mocked(findInFlightMeetNotetakerCall).mockResolvedValue(null);
    mocked(db.call.create).mockImplementation(async ({ data }) => data);
    botClient.post.mockRejectedValue({ isAxiosError: true, response: { status: 503 } });

    await expect(meetNotetakerService.sendToMeeting(input)).rejects.toMatchObject({ statusCode: 503 });
    const update = mocked(db.call.update).mock.calls[0][0];
    expect(update.data.status).toBe('ENDED');
    expect(update.data.metadata.meetBot).toMatchObject({ status: 'failed', reason: 'bot_busy' });
  });
});

describe('handleBotStatus', () => {
  it('ends a call whose bot failed before getting a room', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall());
    await meetNotetakerService.handleBotStatus('room-1', { status: 'failed', reason: 'denied' });
    const [, data] = mocked(updateMeetNotetakerCallAsCreator).mock.calls[0];
    expect(data.status).toBe('ENDED');
    expect(data.metadata.meetBot).toMatchObject({ status: 'failed', reason: 'denied', meetingCode: 'abc-defg-hij' });
  });

  it('ends a live call as soon as the bot leaves, through the room_finished path', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ status: 'ACTIVE' }));
    await meetNotetakerService.handleBotStatus('room-1', { status: 'ended', reason: 'meeting_ended' });
    const [, data] = mocked(updateMeetNotetakerCallAsCreator).mock.calls[0];
    expect(data.metadata.meetBot.status).toBe('ended');
    expect(noteTakerWebhookController.finishCall).toHaveBeenCalledWith('room-1');
  });

  it("doesn't end the call on progress updates", async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ status: 'ACTIVE' }));
    await meetNotetakerService.handleBotStatus('room-1', { status: 'in_call' });
    expect(noteTakerWebhookController.finishCall).not.toHaveBeenCalled();
  });

  it('refuses calls that are not notetaker calls', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ callOrigin: 'CHANNEL' }));
    await expect(meetNotetakerService.handleBotStatus('room-1', { status: 'joining' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(updateMeetNotetakerCallAsCreator).not.toHaveBeenCalled();
  });
});

describe('startBotRoom', () => {
  beforeEach(() => {
    mocked(livekitService.generateAccessToken).mockResolvedValue('bot-token');
    mocked(livekitService.resolveAgentNameForUser).mockResolvedValue('agent-a');
  });

  it('creates the room with the agent and activates the call once the bot is admitted', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall());

    await expect(meetNotetakerService.startBotRoom('room-1')).resolves.toEqual({
      livekitUrl: 'wss://livekit.example',
      token: 'bot-token',
    });

    const room = mocked(livekitService.createRoom).mock.calls[0][0];
    expect(room.name).toBe('room-1');
    expect(JSON.parse(room.metadata)).toMatchObject({ callOrigin: 'MEET_LINK', createdBy: 'user-1', agentName: 'agent-a' });
    expect(livekitService.dispatchTranscriptionAgentForCall).toHaveBeenCalledWith('room-1', 'agent-a');
    const [, data] = mocked(updateMeetNotetakerCallAsCreator).mock.calls[0];
    expect(data.status).toBe('ACTIVE');
    expect(data.metadata.meetBot.status).toBe('in_call');
    expect(livekitService.generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ userIdentity: 'meet-bot-call-id', userName: 'Google Meet', roomName: 'room-1' }),
    );
  });

  it("names the bot's default participant after the meeting's platform", async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(
      botCall({ metadata: { meetBot: { status: 'joining', platform: 'teams', meetingCode: '123', updatedAt: 'x' } } }),
    );
    await meetNotetakerService.startBotRoom('room-1');
    expect(livekitService.generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ userName: 'Microsoft Teams', metadata: JSON.stringify({ source: 'teams' }) }),
    );
  });

  it('only issues a fresh token when the room is already live', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ status: 'ACTIVE' }));
    mocked(livekitService.getRoomInfo).mockResolvedValue({ name: 'room-1' });

    await meetNotetakerService.startBotRoom('room-1');
    expect(livekitService.createRoom).not.toHaveBeenCalled();
    expect(updateMeetNotetakerCallAsCreator).not.toHaveBeenCalled();
    expect(livekitService.generateAccessToken).toHaveBeenCalled();
  });

  it("issues a speaker's own participant, named after them, without recreating the room", async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ status: 'ACTIVE' }));

    await meetNotetakerService.startBotRoom('room-1', { key: 'spaces/x/devices/7', name: 'Priya Shah' });

    expect(livekitService.createRoom).not.toHaveBeenCalled();
    const options = mocked(livekitService.generateAccessToken).mock.calls[0][0];
    expect(options.userName).toBe('Priya Shah');
    expect(options.roomName).toBe('room-1');
    expect(options.userIdentity).toMatch(/^meet-bot-call-id-[0-9a-f]{12}$/);
  });

  it('refuses speaker tokens before the bot is in the meeting', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ status: 'SCHEDULED' }));
    await expect(meetNotetakerService.startBotRoom('room-1', { key: 'k', name: 'n' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('refuses a call that already ended', async () => {
    mocked(findMeetNotetakerCall).mockResolvedValue(botCall({ status: 'ENDED' }));
    await expect(meetNotetakerService.startBotRoom('room-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(livekitService.createRoom).not.toHaveBeenCalled();
  });
});
