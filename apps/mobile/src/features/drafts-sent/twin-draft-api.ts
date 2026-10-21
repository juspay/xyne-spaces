import { apiPost, isMtlsRequestError } from '@/src/services/apiClient';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';

import { buildTwinApproveBody } from './twin-draft-assist';

export type TwinReplyDraftPosted = {
  channelId: string;
  conversationId: string;
};

export type TwinReplyDraftApproveResult = {
  success: true;
  posted?: TwinReplyDraftPosted;
};

type ApproveResponse = {
  success?: boolean;
  posted?: Partial<TwinReplyDraftPosted> | null;
};

const TWIN_REPLY_DRAFT_PATH = '/conversations/reply-drafts';

export const isTwinDraftDeliveryError = (error: unknown): boolean =>
  isMtlsRequestError(error) && error.statusCode === 502;

export const isTwinDraftGoneError = (error: unknown): boolean =>
  isMtlsRequestError(error) && error.statusCode === 404;

const headers = async (): Promise<Record<string, string>> => {
  const auth = await buildAuthenticatedHeaders();
  return { ...auth, 'Content-Type': 'application/json' };
};

const readPosted = (posted: ApproveResponse['posted']): TwinReplyDraftPosted | undefined => {
  if (!posted) return undefined;
  const channelId = posted.channelId?.trim();
  const conversationId = posted.conversationId?.trim();
  if (!channelId || !conversationId) return undefined;
  return { channelId, conversationId };
};

export const approveTwinReplyDraft = async (
  draftId: string,
  editedMessage?: string,
  originalMessage?: string,
): Promise<TwinReplyDraftApproveResult> => {
  const body = buildTwinApproveBody(editedMessage, originalMessage);
  const response = await apiPost<ApproveResponse>(
    `${TWIN_REPLY_DRAFT_PATH}/${draftId}/approve`,
    body,
    { headers: await headers() },
  );
  const posted = readPosted(response.posted);
  return {
    success: true,
    ...(posted ? { posted } : {}),
  };
};

export const declineTwinReplyDraft = async (draftId: string): Promise<void> => {
  await apiPost(`${TWIN_REPLY_DRAFT_PATH}/${draftId}/decline`, {}, { headers: await headers() });
};
