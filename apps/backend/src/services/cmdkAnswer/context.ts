import { db } from '@/database/client';
import type { ACLContext } from '@/database/acl/base-acl';
import { logger } from '@/utils/logger';
import { stripHtml } from '@/agents/xyne-ai/tools/helpers';
import { vespaService } from '@/services/vespaSearch';
import {
  transformVespaResults,
  type TransformedSearchResult,
} from '@/services/vespaSearch/resultTransform';
import { RankProfile, VespaDocType, type VespaSearchHit } from '@/vespa/src/types';

/**
 * The searches claw's `buildAnswerContext` (xyne-claw answer-context.ts) runs for the cmd+K AI
 * answer, run here instead: Vespa holds hashed text that only the backend reads back, and claw
 * has no Spaces DB to act as the user with. Same areas per tab, same hits per area, same
 * deadline, and rows rendered like claw-auth's `spaces-vespa-search`, so claw answers from the
 * same block either way.
 */

/** A citation as claw's `Citation` (xyne-claw-shared) expects it, thread kind only. */
export interface CmdkAnswerCitation {
  kind: 'thread';
  channelId: string;
  conversationId?: string;
  messageId?: string;
  label?: string;
  channelName?: string;
  channelType?: string;
  channelKind?: string;
  xyneId?: string;
  chunkIndex: number;
}

export type CmdkAnswerArea = 'message' | 'ticket';

/** One area's results, as `spaces-vespa-search` would have returned them to claw. */
export interface CmdkAnswerSection {
  area: CmdkAnswerArea;
  /** Rendered rows; each cited row carries a `[clf-__TOOL_CALL_ID__#N]` token claw fills in. */
  text: string;
  citations: CmdkAnswerCitation[];
}

export interface CmdkAnswerContext {
  scope: string;
  sections: CmdkAnswerSection[];
}

/** claw's SCOPES, without the attachment, mail and KB sources. Tabs not listed search nothing. */
const SEARCH_AREAS_BY_TAB: Record<string, readonly CmdkAnswerArea[]> = {
  all: ['message', 'ticket'],
  messages: ['message'],
  tickets: ['ticket'],
};

/** claw's `message` and `ticket` search areas. */
const AREA_SEARCHES: Record<CmdkAnswerArea, { apps: string[]; filters: Record<string, unknown> }> =
  {
    message: { apps: ['chat'], filters: { slack: { docType: [VespaDocType.MESSAGE] } } },
    ticket: { apps: ['ticket'], filters: { ticket: { docType: [VespaDocType.TICKET] } } },
  };

/** claw's HITS_PER_AREA. */
const HITS_PER_AREA = 20;
/** claw's RETRIEVE_TIMEOUT_MS: a ceiling for all areas together. */
const RETRIEVE_TIMEOUT_MS = 8_000;
const TOOL_CALL_ID_PLACEHOLDER = '__TOOL_CALL_ID__';

const toIST = (value: string): string => {
  const raw = value.trim();
  const ms = /^\d{10,}$/.test(raw) ? Number(raw) * (raw.length === 10 ? 1000 : 1) : Date.parse(raw);
  if (Number.isNaN(ms) || ms < 946684800000 || ms > 4102444800000) return '(date n/a)';
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
};

const snippet = (value: string): string =>
  stripHtml(value.replace(/<\/?hi>/gi, '**'))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

/** A title as plain text, as claw-auth's `plainLabel` gives citation chips (no `<hi>` marks). */
const plainTitle = (value: string): string => value.replace(/<\/?hi>/gi, '').trim();

/** One row, in the layout of claw-auth's `formatSearchResult` (the fields a message or ticket has). */
function formatRow(r: TransformedSearchResult, chunkIndex: number | null): string {
  const title = `[${r.type}] ${snippet(r.title)}${r.subtitle ? ` — ${r.subtitle}` : ''}`;
  const lines = [
    chunkIndex == null ? title : `[clf-${TOOL_CALL_ID_PLACEHOLDER}#${chunkIndex}] ${title}`,
  ];
  if (r.context) lines.push(`  ${snippet(r.context)}`);

  const sc = r.searchContext ?? {};
  const detail: string[] = [];
  if (r.metadata.timestamp) detail.push(toIST(r.metadata.timestamp));
  if (r.metadata.channelName) detail.push(`#${r.metadata.channelName}`);
  if (r.metadata.status) detail.push(`status: ${r.metadata.status}`);
  if (sc.priority) detail.push(`priority: ${sc.priority}`);
  if (sc.stageName) detail.push(`stage: ${sc.stageName}`);
  if (sc.msgType && sc.msgType !== 'USER') detail.push(sc.msgType.toLowerCase());
  if (typeof r.relevanceScore === 'number') detail.push(`score: ${r.relevanceScore.toFixed(3)}`);
  if (detail.length > 0) lines.push(`  ${detail.join(' · ')}`);

  if (sc.senderName || sc.senderEmail || sc.senderId) {
    const from = [
      sc.senderName,
      sc.senderEmail && `<${sc.senderEmail}>`,
      sc.senderId && `(${sc.senderId})`,
    ];
    lines.push(`  From: ${from.filter(Boolean).join(' ')}`);
  }
  if (typeof sc.replyCount === 'number') {
    lines.push(`  ${sc.replyCount} repl${sc.replyCount === 1 ? 'y' : 'ies'}`);
  }
  if (sc.creatorName && sc.creatorName !== 'Unknown Creator') {
    lines.push(`  Created by: ${sc.creatorName}${sc.createdBy ? ` (${sc.createdBy})` : ''}`);
  } else if (sc.createdBy) lines.push(`  createdBy: ${sc.createdBy}`);
  if (sc.assigneeName) {
    lines.push(`  Assigned to: ${sc.assigneeName}${sc.assignedTo ? ` (${sc.assignedTo})` : ''}`);
  } else if (sc.assignedTo) lines.push(`  assignedTo: ${sc.assignedTo}`);
  if (sc.closedByName) lines.push(`  Closed by: ${sc.closedByName}`);
  const boardProject = [
    sc.boardName && `Board: ${sc.boardName}`,
    sc.projectName && `Project: ${sc.projectName}`,
  ];
  if (boardProject.some(Boolean)) lines.push(`  ${boardProject.filter(Boolean).join(' · ')}`);
  if (sc.xyneId) lines.push(`  ID: ${sc.xyneId}`);
  return lines.join('\n');
}

/** A row's citation, as claw-auth's `harvest` builds it for message and ticket rows. */
function citationFor(r: TransformedSearchResult, chunkIndex: number): CmdkAnswerCitation | null {
  const sc = r.searchContext ?? {};
  if (!sc.channelId) return null;
  return {
    kind: 'thread',
    channelId: sc.channelId,
    ...(sc.conversationId && { conversationId: sc.conversationId }),
    chunkIndex,
    label: plainTitle(r.title) || r.type,
    ...(sc.messageId && { messageId: sc.messageId }),
    ...(sc.xyneId && { xyneId: sc.xyneId }),
  };
}

/** claw-auth's `applyChannelInfo`: channel name, scope type and type (desk tickets route to Support). */
async function applyChannelInfo(citations: CmdkAnswerCitation[]): Promise<void> {
  const ids = [...new Set(citations.map((c) => c.channelId))];
  if (ids.length === 0) return;
  const channels = await db.channel.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, scopeType: true, type: true },
  });
  const byId = new Map(channels.map((c) => [c.id, c]));
  for (const c of citations) {
    const channel = byId.get(c.channelId);
    if (!channel) continue;
    if (channel.name && !c.channelName) c.channelName = channel.name;
    if (channel.scopeType && !c.channelType) c.channelType = String(channel.scopeType);
    if (channel.type && !c.channelKind) c.channelKind = String(channel.type);
  }
}

async function searchArea(
  area: CmdkAnswerArea,
  query: string,
  auth: ACLContext
): Promise<CmdkAnswerSection | null> {
  const { apps, filters } = AREA_SEARCHES[area];
  const response = await vespaService.searchService.searchVespa(query, auth.userId, apps, {
    rankProfile: RankProfile.nativeRank,
    offset: 0,
    limit: HITS_PER_AREA,
    groupBy: '',
    slack: {},
    ticket: {},
    file: {},
    mail: {},
    call: {},
    workspaceId: auth.workspaceId,
    privateQuery: true,
    literalQuery: true,
    ...filters,
  });
  const hits = (response.root.children ?? []) as VespaSearchHit[];
  const results = await transformVespaResults(hits, db, false, true);
  if (results.length === 0) return null;

  const citations: CmdkAnswerCitation[] = [];
  const rows = results.map((r, i) => {
    const citation = citationFor(r, i + 1);
    if (citation) citations.push(citation);
    return formatRow(r, citation ? i + 1 : null);
  });
  await applyChannelInfo(citations);
  return { area, text: rows.join('\n\n'), citations };
}

/** Never throws; an area that fails or misses the deadline is left out, like in claw. */
export async function buildCmdkAnswerContext(
  query: string,
  tab: string,
  auth: ACLContext
): Promise<CmdkAnswerContext> {
  const areas = SEARCH_AREAS_BY_TAB[tab] ?? [];
  const started = Date.now();

  // Each area lands in its own slot as it finishes; at the deadline the rest are dropped, so one
  // slow area never discards the fast ones.
  const done: Array<CmdkAnswerSection | null> = new Array(areas.length).fill(null);
  const jobs = areas.map((area, i) =>
    searchArea(area, query, auth)
      .then((section) => {
        done[i] = section;
      })
      .catch((error: unknown) => {
        logger.warn('[CmdkAnswer] area search failed', {
          area,
          error: error instanceof Error ? error.name : 'unknown',
        });
      })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.all(jobs).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), RETRIEVE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);

  const sections = done.filter((s): s is CmdkAnswerSection => s !== null);
  logger.info('[CmdkAnswer] context built', {
    tab,
    sections: sections.length,
    areas: areas.length,
    timedOut,
    ms: Date.now() - started,
  });
  return { scope: tab, sections };
}
