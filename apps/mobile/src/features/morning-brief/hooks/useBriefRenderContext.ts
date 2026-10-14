import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useCSSVariable, useUniwind } from 'uniwind';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useAllChannels } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { queries } from '@/src/zero/queries';
import { tryOpenDashboardCanvasFromUrl } from '@/src/utils/canvasUrl';
import { navigateToMessageDeepLinkIfApplicable } from '@/src/utils/messageDeepLink';

import type { BriefCitation, DailyBriefPayload } from '../api/dailyBriefApi';
import {
  BRIEF_TICKET_SCHEME,
  buildClawCitationUrl,
  findCitationForChunk,
  registerClawIcons,
  type ClawCiteRef,
} from '../utils/citations';
import type { BriefLineContext } from '../utils/briefText';
import {
  BRIEF_MENTION_COLORS,
  buildBriefLineMarkdownStyle,
  type BriefPalette,
} from '../utils/briefMarkdownStyle';

/** Chip fill matching the web's `--muted` token (which mobile lacks). */
const CHIP_BG = { light: '#F4F4F5', dark: '#2B2D31' } as const;

function resolveColor(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(')) {
    return value;
  }
  return fallback;
}

export function useBriefPalette(): BriefPalette {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const foreground = useCSSVariable('--color-foreground') as string;
  const secondaryForeground = useCSSVariable('--color-secondary-foreground') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;

  return useMemo(() => {
    const mention = isDark ? BRIEF_MENTION_COLORS.dark : BRIEF_MENTION_COLORS.light;
    return {
      foreground: resolveColor(foreground, isDark ? '#E1E4EA' : '#232229'),
      foregroundMuted: resolveColor(secondaryForeground, isDark ? '#B1B4B9' : '#71717A'),
      cardBg: resolveColor(cardBg, isDark ? '#1A1A1F' : '#ffffff'),
      brand: resolveColor(brand, '#fe6d36'),
      linkColor: mention.color,
      mentionColor: mention.color,
      mentionBg: mention.bg,
      chipBg: isDark ? CHIP_BG.dark : CHIP_BG.light,
    };
  }, [brand, cardBg, foreground, isDark, secondaryForeground]);
}

export interface BriefRenderContext {
  lineContext: BriefLineContext;
  markdownStyle: MarkdownStyle;
  palette: BriefPalette;
  /** Resolve an extracted citation run entry to its structured citation. */
  resolveCitation: (ref: ClawCiteRef) => BriefCitation | null;
}

/**
 * Everything a BriefLine needs to prepare and render one line: the pure text
 * pipeline context (citation routability, mention name resolution, ticket
 * prefixes), the citation resolver for the trailing chips, and the shared
 * markdown style.
 */
export function useBriefRenderContext(data: DailyBriefPayload | null): BriefRenderContext {
  const users = useUsers();
  const channels = useAllChannels();
  const [projects] = useCachedQuery(queries.getAllProjects());
  const palette = useBriefPalette();

  const userNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      const name = (user.displayName ?? user.name ?? '').trim();
      if (name) map.set(user.id, name);
    }
    return map;
  }, [users]);

  const channelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const channel of channels) {
      if (channel?.id && channel.name) map.set(channel.id, channel.name);
    }
    return map;
  }, [channels]);

  const ticketPrefixes = useMemo(
    () =>
      new Set(
        ((projects ?? []) as Array<{ code?: string | null }>)
          .map(p => (p.code ?? '').toUpperCase())
          .filter(Boolean),
      ),
    [projects],
  );

  const lineContext = useMemo((): BriefLineContext => {
    const clawCitations = data?.clawCitations;
    registerClawIcons(data?.clawCitationIcons);
    return {
      isRoutable: (toolCallId, chunkIndex): boolean => {
        const citation = findCitationForChunk(clawCitations, toolCallId, chunkIndex);
        return !!citation && !!buildClawCitationUrl(citation);
      },
      ticketPrefixes,
      resolveUserName: userId => userNames.get(userId) ?? null,
      resolveChannelName: channelId => channelNames.get(channelId) ?? null,
    };
  }, [channelNames, data, ticketPrefixes, userNames]);

  const resolveCitation = useCallback(
    (ref: ClawCiteRef): BriefCitation | null =>
      findCitationForChunk(data?.clawCitations, ref.toolCallId, ref.chunkIndex),
    [data],
  );

  const markdownStyle = useMemo(() => buildBriefLineMarkdownStyle(palette), [palette]);

  return useMemo(
    () => ({ lineContext, markdownStyle, palette, resolveCitation }),
    [lineContext, markdownStyle, palette, resolveCitation],
  );
}

/**
 * Tap dispatch for the brief's link schemes. Citations resolve to native
 * routes where one exists (threads via the message deep-link pipeline, canvas
 * via the dashboard WebView overlay); everything else falls through
 * useMentionPress, which already handles user/channel mentions, call and
 * message deep links, and external URLs.
 */
export function useOpenCitation(): (citation: BriefCitation) => void {
  const router = useRouter();
  const handleMentionPress = useMentionPress();

  return useCallback(
    (citation: BriefCitation) => {
      if (citation.kind === 'ticket' && citation.ticketId) {
        router.push({
          pathname: '/ticket/[ticketId]',
          params: {
            ticketId: citation.ticketId,
            ...(citation.channelId ? { channelId: citation.channelId } : {}),
            ...(citation.conversationId ? { threadId: citation.conversationId } : {}),
          },
        });
        return;
      }
      if (citation.kind === 'recording' && citation.recordingId) {
        router.push({
          pathname: '/recording/[recordingId]',
          params: { recordingId: citation.recordingId },
        });
        return;
      }
      const path = buildClawCitationUrl(citation);
      if (!path) return;
      const url = path.startsWith('http') ? path : `${PUBLIC_DEEP_LINK_ORIGIN}${path}`;
      if (navigateToMessageDeepLinkIfApplicable(router, url)) return;
      if (tryOpenDashboardCanvasFromUrl(router, url)) return;
      void handleMentionPress(url);
    },
    [handleMentionPress, router],
  );
}

export function useBriefLinkHandler(): (url: string) => void {
  const router = useRouter();
  const handleMentionPress = useMentionPress();

  return useCallback(
    (url: string) => {
      if (url.startsWith(BRIEF_TICKET_SCHEME)) {
        const ticketId = url.slice(BRIEF_TICKET_SCHEME.length);
        if (ticketId) {
          router.push({ pathname: '/ticket/[ticketId]', params: { ticketId } });
        }
        return;
      }
      void handleMentionPress(url);
    },
    [handleMentionPress, router],
  );
}
