import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';

import { getDraft, getDraftFlushContent, isDraftEmpty } from './drafts';

/** Local composer HTML → dashboard/Zero draft HTML (custom emoji imgs, unicode, mentions). */
export const getZeroDraftFlushContent = (lookupId: string, fallback = ''): string => {
  const flushed = getDraftFlushContent(lookupId, fallback);
  const draft = getDraft(lookupId);
  if (isDraftEmpty(draft)) return flushed;
  return buildComposerContentForSend(draft.text, draft.html) ?? flushed;
};
