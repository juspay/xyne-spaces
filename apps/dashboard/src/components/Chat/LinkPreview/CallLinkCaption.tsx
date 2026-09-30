import React from 'react';
import { CallStatus } from '@xyne/shared';

import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

const CAPTION: Record<CallStatus, string> = {
  [CallStatus.SCHEDULED]: 'scheduled a call',
  [CallStatus.ACTIVE]: 'started a call',
  [CallStatus.IN_PROGRESS]: 'started a call',
  [CallStatus.ENDED]: 'shared a call',
  [CallStatus.CANCELLED]: 'shared a call',
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '');

/**
 * True when a message's whole visible text is the call link its preview card is for, so the
 * card can stand in for the text. A link with anything around it ("join here: …") is not.
 */
export const isCallLinkOnlyMessage = (content: string | null | undefined, url: string): boolean => {
  if (!content) return false;
  const text = decodeEntities(content.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeUrl(text) === normalizeUrl(url);
};

interface CallLinkCaptionProps {
  externalId: string;
}

/**
 * The grey line that replaces a bare call link's text ("scheduled a call", "started a call").
 * Reads the same query as CallLinkPreview, so both share one subscription. A call the viewer
 * cannot read, or one still loading, reads "shared a call".
 */
export const CallLinkCaption: React.FC<CallLinkCaptionProps> = ({ externalId }) => {
  const [call] = useCachedQuery(queries.callByExternalId({ callId: externalId }));
  return (
    <p className='text-sm text-muted-foreground'>{call ? CAPTION[call.status] : 'shared a call'}</p>
  );
};
