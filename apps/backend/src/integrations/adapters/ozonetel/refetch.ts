import { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { ozonetelConfigService } from '@/services/ozonetel/ozonetelConfigService';
import { ozonetelService } from '@/services/ozonetel/ozonetelService';
import { IST_OFFSET_MS } from '@/utils/dateUtils';
import { logger } from '@/utils/logger';
import { BaseRefetch, RefetchOptions, RefetchResult } from '../../core/baseRefetch';
import { adapterRegistry } from '../../core/adapterRegistry';
import { externalSourceCore } from '../../core/core';

const TAG = '[OzonetelRefetch]';
const DAY_MS = 24 * 60 * 60 * 1000;
// Ozonetel serves CDRs for the last 15 days, one day per request, at most 2 requests a minute.
const CDR_RETENTION_DAYS = 15;
const CDR_REQUEST_GAP_MS = 31_000;
// A large backfill writes its calls in chunks so it does not hammer the DB.
const INGEST_CHUNK_SIZE = 50;
const INGEST_CHUNK_PAUSE_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface CdrWindow {
  fromDate: string;
  toDate: string;
  campaignName?: string;
}

function istDayStart(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

function formatIst(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

function splitByIstDay(startMs: number, endMs: number): CdrWindow[] {
  const now = Date.now();
  let cursor = Math.max(startMs, istDayStart(now) - (CDR_RETENTION_DAYS - 1) * DAY_MS);
  const end = Math.min(endMs, now);
  const windows: CdrWindow[] = [];
  while (cursor <= end) {
    const dayEnd = istDayStart(cursor) + DAY_MS - 1000;
    windows.push({ fromDate: formatIst(cursor), toDate: formatIst(Math.min(dayEnd, end)) });
    cursor = dayEnd + 1000;
  }
  return windows;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

// CDR times are "HH:MM:SS" with the day in CallDate; the webhook sends full IST date-times.
function withCallDate(callDate: string, time: string, rollOverFrom?: string): string | undefined {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return time || undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(callDate)) return undefined;
  if (rollOverFrom && time < rollOverFrom) {
    const next = new Date(Date.parse(`${callDate}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    return `${next} ${time}`;
  }
  return `${callDate} ${time}`;
}

/** Renames CDR keys to the post-call webhook's so mapOzonetelWebhookEvent reads both. */
function toWebhookBody(row: Record<string, unknown>): Record<string, unknown> {
  const status = text(row.Status);
  const callDate = text(row.CallDate);
  const startTime = text(row.StartTime);
  return {
    ...row,
    // CallID is the live webhook's monitorUCID; UCID is one leg, and an inbound call has a row per leg.
    monitorUCID: text(row.monitorUCID) || text(row.CallID) || undefined,
    ucid: text(row.ucid) || text(row.UCID) || undefined,
    StartTime: withCallDate(callDate, startTime),
    EndTime: withCallDate(callDate, text(row.EndTime), startTime),
    AnswerTime: row.AnswerTime ?? withCallDate(callDate, text(row.PickupTime), startTime),
    Did: row.Did ?? row.DID,
    // An unanswered leg carries "", which would otherwise overwrite the answered leg's recording.
    AudioFile: text(row.AudioFile) || text(row.CallAudio) || undefined,
    DialStatus: row.DialStatus ?? row.AgentDialStatus,
    CustomerStatus: row.CustomerStatus ?? row.CustomerDialStatus,
    ...(/^un-?answered$/i.test(status) ? { Status: 'NotAnswered' } : {}),
  };
}

function callIdOf(body: Record<string, unknown>): string {
  return text(body.monitorUCID) || text(body.ucid);
}

/** Ingests only calls we have no record of; calls that already arrived live are left untouched. */
async function pullCalls(
  source: ExternalSource,
  windows: CdrWindow[],
  keep?: (body: Record<string, unknown>) => boolean,
): Promise<RefetchResult> {
  const adapter = adapterRegistry.getAdapter(source.name);
  const result: RefetchResult = { processed: 0, newTickets: 0, skipped: 0, errors: [] };
  let written = 0;

  for (const [index, window] of windows.entries()) {
    if (index > 0) await sleep(CDR_REQUEST_GAP_MS);
    let rows: Record<string, unknown>[];
    try {
      rows = await ozonetelService.fetchCallDetails({ workspaceId: source.workspaceId, ...window });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${window.fromDate}${window.campaignName ? ` ${window.campaignName}` : ''}: ${message}`);
      continue;
    }
    const bodies = rows
      .map(toWebhookBody)
      .filter(body => !keep || keep(body))
      .sort((left, right) => text(left.StartTime).localeCompare(text(right.StartTime)));

    const existing = await db.externalMessage.findMany({
      where: { externalSourceId: source.id, externalId: { in: [...new Set(bodies.map(callIdOf).filter(Boolean))] } },
      select: { externalId: true },
    });
    const tracked = new Set(existing.map(({ externalId }) => externalId));

    for (const body of bodies) {
      const callId = callIdOf(body);
      if (!callId || tracked.has(callId)) {
        result.skipped++;
        continue;
      }
      if (written > 0 && written % INGEST_CHUNK_SIZE === 0) await sleep(INGEST_CHUNK_PAUSE_MS);
      written++;
      try {
        const ingested = await externalSourceCore.ingest(adapter, source.name, body, source);
        for (const item of ingested) {
          if (item.action === 'skipped' || item.action === 'duplicate' || !item.entityId) {
            result.skipped++;
          } else {
            result.processed++;
            if (item.isNew) result.newTickets++;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`${TAG} call ingest failed`, { sourceId: source.id, callId, error: message });
        result.errors.push(`${callId}: ${message}`);
      }
    }
  }

  logger.info(`${TAG} pull done`, { sourceId: source.id, windows: windows.length, ...result, errors: result.errors.length });
  return result;
}

export class OzonetelRefetch extends BaseRefetch {
  async refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult> {
    if (!options?.startDate || !options?.endDate) {
      throw new Error(`${TAG} startDate and endDate are required`);
    }
    const windows = splitByIstDay(Date.parse(options.startDate), Date.parse(options.endDate));
    const deskId = options.targetChannelId;
    if (!deskId) return pullCalls(source, windows);

    const rules = (await ozonetelConfigService.getConfig(source.workspaceId))?.ticketRules;
    const routesToDesk = (body: Record<string, unknown>): boolean =>
      ozonetelConfigService.resolveTargetChannelId(rules, { campaignName: text(body.CampaignName) }) === deskId;
    const campaigns = Object.entries(rules?.campaignRouting ?? {})
      .filter(([, channelId]) => channelId === deskId)
      .map(([campaignName]) => campaignName);
    // The default desk also takes unrouted campaigns, which no campaignName filter can express; with several
    // campaigns one unfiltered request per day beats one per campaign, and routesToDesk keeps the right rows.
    const isDefaultDesk = rules?.defaultChannelId === deskId;
    if (!isDefaultDesk && campaigns.length === 0) {
      return { processed: 0, newTickets: 0, skipped: 0, errors: [] };
    }
    const requests =
      !isDefaultDesk && campaigns.length === 1
        ? windows.map(window => ({ ...window, campaignName: campaigns[0] }))
        : windows;
    return pullCalls(source, requests, routesToDesk);
  }
}
