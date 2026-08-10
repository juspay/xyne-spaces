/**
 * Regression tests for the draft-attachment upload ownership guard.
 *
 * Bug (production): "One or more attachment ids reference a resource you do not own".
 * A user's own draft attachment can have its entityType flipped DRAFT -> CHAT
 * (message send) or DRAFT -> DELAYED_MESSAGE (scheduled send) by the Zero
 * create-message / delayed-message mutator. When the in-flight
 * POST /api/drafts/attachments/upload lands AFTER that flip (common on large /
 * slow files), the old guard `uploadedByUserId !== userId || entityType !== DRAFT`
 * treated the user's OWN attachment as foreign and 403'd the whole batch, losing
 * every file's url.
 *
 * Fix: key the "foreign" decision on ownership + whether the row already has a
 * stored file (`url`), not on entityType. A freshly-created draft row always has
 * url === '' and is safe to fill regardless of a raced entityType change; a row
 * that already has a url is an already-committed attachment and must not be
 * repointed by this endpoint.
 *
 * These tests drive the REAL controller method against an injected fake db, so
 * they exercise the actual guard code path (not a copy of the predicate).
 */

// Keep construction inert — we override the instance fields per test.
jest.mock('../database/client', () => ({
  DatabaseClient: { getInstance: () => ({}) },
}));
jest.mock('../database/repositories/channelParticipantRepository', () => ({
  ChannelParticipantRepository: class {},
}));
jest.mock('../database/repositories/channelRepository', () => ({
  ChannelRepository: class {},
}));
jest.mock('../services/fileUploadService', () => ({
  uploadFiles: jest.fn(async (files: any[]) =>
    files.map((f, i) => ({
      originalName: f.originalname,
      fileName: `stored-${i}`,
      fileSize: f.size,
      mimeType: f.mimetype,
      fileUrl: `attachments/uploaded-${i}.png`,
    })),
  ),
}));
// Stub logger + config + the shared package (its dist is ESM and pulls the whole
// Zero schema graph — neither is relevant to the guard under test).
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/config/env', () => ({ config: { fileStorage: { provider: 'local' } } }));
jest.mock('@xyne/shared', () => ({
  AttachmentEntityType: {
    TICKET: 'TICKET', CHAT: 'CHAT', CANVAS: 'CANVAS', DRAFT: 'DRAFT',
    DELAYED_MESSAGE: 'DELAYED_MESSAGE', EMAIL: 'EMAIL',
  },
}));

import { AttachmentEntityType } from '@xyne/shared';
import { DraftAttachmentController } from './draftAttachmentController';

const USER = 'user-me';
const OTHER = 'user-other';
const ATT_ID = 'att-1';

type Row = {
  id: string;
  uploadedByUserId: string;
  entityType: AttachmentEntityType;
  url: string;
};

function makeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: any) => {
    res.body = b;
    return res;
  };
  return res;
}

/** Run the real controller with a given set of pre-existing attachment rows. */
async function runUpload(existingRows: Row[]) {
  const controller = new DraftAttachmentController();

  const upsert = jest.fn(async () => ({}));
  (controller as any).db = {
    messageAttachment: {
      findMany: jest.fn(async () => existingRows),
      upsert,
      update: jest.fn(async () => ({})),
    },
    draftMessage: {
      // Return an existing draft so the create branch (which needs workspaceId) is skipped.
      findFirst: jest.fn(async () => ({ id: 'draft-1' })),
      upsert: jest.fn(async () => ({})),
    },
  };
  (controller as any).channelParticipantRepository = {
    isParticipant: jest.fn(async () => true),
  };
  (controller as any).channelRepository = {
    getWorkspaceId: jest.fn(async () => 'ws-1'),
  };

  const req: any = {
    body: {
      attachmentIds: JSON.stringify([ATT_ID]),
      channelId: 'ch-1',
      draftMessageId: 'draft-1',
      conversationId: null,
    },
    files: { files: [{ originalname: 'a.png', size: 1234, mimetype: 'image/png' }] },
    user: { id: USER, workspaceId: 'ws-1' },
  };
  const res = makeRes();

  await controller.uploadDraftAttachment(req, res);
  return { res, upsert };
}

describe('draft attachment upload — ownership guard', () => {
  it('REGRESSION: accepts the user\'s own draft attachment even after send flipped it DRAFT -> CHAT', async () => {
    // The send raced ahead of the upload: entityType is CHAT, but url is still empty
    // because THIS upload is the writer that fills it.
    const { res, upsert } = await runUpload([
      { id: ATT_ID, uploadedByUserId: USER, entityType: AttachmentEntityType.CHAT, url: '' },
    ]);

    expect(res.statusCode).toBe(200); // pre-fix this was 403
    expect(res.body.success).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1); // the url actually got written
  });

  it('REGRESSION: accepts own draft attachment flipped DRAFT -> DELAYED_MESSAGE (scheduled send race)', async () => {
    const { res } = await runUpload([
      { id: ATT_ID, uploadedByUserId: USER, entityType: AttachmentEntityType.DELAYED_MESSAGE, url: '' },
    ]);
    expect(res.statusCode).toBe(200);
  });

  it('accepts a normal freshly-created DRAFT row', async () => {
    const { res } = await runUpload([
      { id: ATT_ID, uploadedByUserId: USER, entityType: AttachmentEntityType.DRAFT, url: '' },
    ]);
    expect(res.statusCode).toBe(200);
  });

  it('accepts a brand-new id with no existing row', async () => {
    const { res } = await runUpload([]);
    expect(res.statusCode).toBe(200);
  });

  it('SECURITY: rejects an attachment owned by a different user (cross-user overwrite)', async () => {
    const { res, upsert } = await runUpload([
      { id: ATT_ID, uploadedByUserId: OTHER, entityType: AttachmentEntityType.DRAFT, url: '' },
    ]);
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/reference a resource you do not own/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('SECURITY: rejects re-pointing an already-committed attachment (own row that already has a url)', async () => {
    const { res, upsert } = await runUpload([
      { id: ATT_ID, uploadedByUserId: USER, entityType: AttachmentEntityType.CHAT, url: 'attachments/already-there.png' },
    ]);
    expect(res.statusCode).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
