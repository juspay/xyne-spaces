import {
  useMemo,
  type AnchorHTMLAttributes,
  type FC,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents, type ClawCitationContext } from '../../utils/markdownComponents';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  CLAW_CITATION_TOKEN_RE,
  CLAW_CITATION_MALFORMED_RE,
} from '../../components/ui/TipTapExtensions/CitationMark';
import {
  registerClawIcons,
  findCitationForChunk,
  buildClawCitationUrl,
} from '../../components/Chat/XyneAISidebar/utils/clawCitationUrl';
import {
  MentionRenderer,
  ChannelMentionRenderer,
} from '../../components/Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useChannel } from '../../hooks/useChannels';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import type { ToolInvocation } from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';
import type { DailyBriefPayload } from '../../api/dailyBriefApi';

const REMARK_PLUGINS = [remarkGfm];

function tidy(line: string): string {
  return line
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

function stripCitationTokens(line: string): string {
  return tidy(line.replace(CLAW_CITATION_MALFORMED_RE, ''));
}

function dropUnresolvableTokens(line: string, isRoutable: RoutableCheck): string {
  return line.replace(CLAW_CITATION_TOKEN_RE, (token, _open, body: string) => {
    const hashIdx = body.lastIndexOf('#');
    const toolCallId = body.slice('clf-'.length, hashIdx);
    const chunkIndex = Number(body.slice(hashIdx + 1));
    return isRoutable(toolCallId, chunkIndex) ? token : '';
  });
}

const MENTION_TOKEN_RE = /<@([A-Za-z0-9_-]+)>/g;
const CHANNEL_TOKEN_RE = /<#([A-Za-z0-9_-]+)>/g;
const TICKET_ID_RE = /\b([A-Z0-9]{2,10})-(\d{1,6})\b/g;
const MENTION_HREF_PREFIX = 'mention:';
const CHANNEL_HREF_PREFIX = 'channel-mention:';
const TICKET_HREF_PREFIX = 'ticket-id:';

const TICKET_ID_CLASS =
  'inline-block align-middle whitespace-nowrap rounded bg-muted px-2 py-0.5 ' +
  'text-xs font-medium text-muted-foreground';

const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;

/** Ticket ids inside an existing markdown link (a citation, or a plain URL that
 *  carries a ticket key) must be left alone — rewriting them nests one link
 *  inside another and the markdown breaks. */
function linkifyTicketIds(line: string, ticketPrefixes: ReadonlySet<string>): string {
  if (ticketPrefixes.size === 0) return line;
  const replaceOutsideLinks = (text: string): string =>
    text.replace(TICKET_ID_RE, (match, prefix: string) =>
      ticketPrefixes.has(prefix) ? `[${match}](${TICKET_HREF_PREFIX}${match})` : match,
    );

  const out: string[] = [];
  let cursor = 0;
  for (const link of line.matchAll(MARKDOWN_LINK_RE)) {
    const start = link.index ?? 0;
    out.push(replaceOutsideLinks(line.slice(cursor, start)), link[0]);
    cursor = start + link[0].length;
  }
  out.push(replaceOutsideLinks(line.slice(cursor)));
  return out.join('');
}

function linkifyMentions(line: string, ticketPrefixes: ReadonlySet<string>): string {
  const withMentions = line
    .replace(MENTION_TOKEN_RE, (_token, userId: string) => `[@](${MENTION_HREF_PREFIX}${userId})`)
    .replace(
      CHANNEL_TOKEN_RE,
      (_token, channelId: string) => `[#](${CHANNEL_HREF_PREFIX}${channelId})`,
    );
  return linkifyTicketIds(withMentions, ticketPrefixes);
}

function BriefChannelMention({ channelId }: { channelId: string }): ReactElement {
  const navigate = useNavigate();
  const channel = useChannel(channelId);
  return (
    <ChannelMentionRenderer
      channelId={channelId}
      channelName={channel?.name ?? channelId}
      isPrivate={String(channel?.visibility) === 'PRIVATE'}
      navigate={navigate}
    />
  );
}

const LINE_LAYOUT_COMPONENTS: Components = {
  p: ({ children }) => <p className='m-0'>{children}</p>,
  strong: ({ children }) => <strong className='font-medium'>{children}</strong>,
  em: ({ children }) => <em className='italic'>{children}</em>,
  ul: ({ children }) => <ul className='list-disc pl-5'>{children}</ul>,
  ol: ({ children }) => <ol className='list-decimal pl-5'>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
};

type RoutableCheck = (toolCallId: string, chunkIndex: number) => boolean;

export interface BriefRenderContext {
  components: Components;
  citationCtx: ClawCitationContext | null;
  isRoutable: RoutableCheck;
  ticketPrefixes: ReadonlySet<string>;
}

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode };

function withMentionAnchor(base: Components): Components {
  const BaseAnchor = base.a as unknown as FC<AnchorProps>;
  const anchor = (props: AnchorProps): ReactElement => {
    const href = props.href ?? '';
    if (href.startsWith(MENTION_HREF_PREFIX)) {
      const userId = href.slice(MENTION_HREF_PREFIX.length);
      if (userId) return <MentionRenderer userId={userId} />;
    }
    if (href.startsWith(CHANNEL_HREF_PREFIX)) {
      const channelId = href.slice(CHANNEL_HREF_PREFIX.length);
      if (channelId) return <BriefChannelMention channelId={channelId} />;
    }
    if (href.startsWith(TICKET_HREF_PREFIX)) {
      return <span className={TICKET_ID_CLASS}>{href.slice(TICKET_HREF_PREFIX.length)}</span>;
    }
    return <BaseAnchor {...props} />;
  };
  return { ...base, a: anchor as NonNullable<Components['a']> };
}

export function useBriefRenderContext(
  data: DailyBriefPayload | null,
  content: string,
  key: string,
): BriefRenderContext {
  const [projects] = useCachedQuery(queries.getAllProjects());
  const ticketPrefixes = useMemo(
    () =>
      new Set(
        ((projects ?? []) as Array<{ code?: string | null }>)
          .map(p => (p.code ?? '').toUpperCase())
          .filter(Boolean),
      ),
    [projects],
  );

  return useMemo(() => {
    const clawCitations = data?.clawCitations as ToolInvocation[] | undefined;
    if (!clawCitations?.length) {
      return {
        components: withMentionAnchor({
          ...createMarkdownComponents(key),
          ...LINE_LAYOUT_COMPONENTS,
        }),
        citationCtx: null,
        isRoutable: () => false,
        ticketPrefixes,
      };
    }
    registerClawIcons(data?.clawCitationIcons);
    const citationCtx: ClawCitationContext = {
      toolInvocations: clawCitations,
      toolNumbers: buildClawCitationToolNumbers(content),
    };
    return {
      components: withMentionAnchor({
        ...createMarkdownComponents(key, citationCtx),
        ...LINE_LAYOUT_COMPONENTS,
      }),
      citationCtx,
      isRoutable: (toolCallId: string, chunkIndex: number): boolean => {
        const citation = findCitationForChunk(clawCitations, toolCallId, chunkIndex);
        return !!citation && !!buildClawCitationUrl(citation);
      },
      ticketPrefixes,
    };
  }, [data, content, key, ticketPrefixes]);
}

interface BriefLineProps {
  children: string;
  context: BriefRenderContext;
}

export function BriefLine({ children, context }: BriefLineProps): ReactElement | null {
  const { components, citationCtx, isRoutable, ticketPrefixes } = context;
  const cited = citationCtx
    ? stripCitationTokens(
        linkifyAndGroupClawCitations(
          dropUnresolvableTokens(children, isRoutable),
          citationCtx.toolNumbers,
        ),
      )
    : stripCitationTokens(children);
  const text = linkifyMentions(cited, ticketPrefixes);
  if (!text.trim()) return null;
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={url => url} components={components}>
      {text}
    </Markdown>
  );
}
