import { randomUUID } from 'crypto';
import { ChannelType, ExternalEntityType } from '@prisma/client';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { UserRepository } from '@/database/repositories/users';
import { logger } from '@/utils/logger';
import { ozonetelConfigService, type OzonetelTicketRules } from './ozonetelConfigService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { resolveTelephonyAgentUserId } from './telephonyAgentUserService';
import type {
  TelephonyDirection,
  TelephonyEvent,
  TelephonyStatus,
} from '@/integrations/adapters/ozonetel/types';

export type {
  TelephonyDirection,
  TelephonyEvent,
  TelephonyStatus,
} from '@/integrations/adapters/ozonetel/types';

const TAG = '[TelephonyEmailService]';
const DEFAULT_SUBJECT_TEMPLATE = '{callType} call from {callerId} ({monitorUcid})';
const TELEPHONY_FORM_FIELDS: Array<{ fieldName: string; fieldType: FormFieldType }> = [
  { fieldName: 'Campaign Name', fieldType: FormFieldType.STRING },
  { fieldName: 'From Number', fieldType: FormFieldType.STRING },
  { fieldName: 'To Number', fieldType: FormFieldType.STRING },
  { fieldName: 'Call Status', fieldType: FormFieldType.STRING },
  { fieldName: 'Recording URL', fieldType: FormFieldType.STRING },
];
const SYSTEM_AGENT_LABEL = 'Xyne Automatic';

interface TelephonyStoredMetadata {
  provider: 'ozonetel';
  externalId: string;
  workspaceId: string;
  status: TelephonyStatus;
  direction?: TelephonyDirection;
  agentUserId?: string;
  fromNumber?: string;
  toNumber?: string;
  recordingUrl?: string;
  startedAt?: string;
  endedAt?: string;
  talkTimeSec?: number;
  metadata?: Record<string, unknown>;
}

interface TelephonyEmailBodyPayload {
  provider: 'ozonetel';
  from?: string;
  agent?: string;
  monitorUcid?: string;
  ucid?: string;
  uui?: string;
  callType?: string;
  campaignName?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  status?: string;
  transferType?: string;
  transferredTo?: string;
  recording?: string;
  disposition?: string;
  comments?: string;
}

function parseStoredTelephonyEmailBody(body: string): Partial<TelephonyStoredMetadata> | null {
  if (!body) return null;

  try {
    const payload = JSON.parse(body) as TelephonyEmailBodyPayload;
    if (payload.provider !== 'ozonetel') return null;

    const startedAt = parseSerializedTelephonyTimestamp(payload.startTime);
    const endedAt = parseSerializedTelephonyTimestamp(payload.endTime);
    const talkTimeSec = parseTelephonyDuration(payload.duration);

    return {
      status: parseStoredTelephonyStatus(payload.status),
      fromNumber: payload.from?.trim() || undefined,
      startedAt: asIso(startedAt),
      endedAt: asIso(endedAt),
      talkTimeSec,
      recordingUrl: payload.recording?.trim() || undefined,
      metadata: {
        ...(payload.monitorUcid?.trim() && { monitorUcid: payload.monitorUcid.trim() }),
        ...(payload.ucid?.trim() && { ucid: payload.ucid.trim() }),
        ...(payload.uui?.trim() && { uui: payload.uui.trim() }),
        ...(payload.callType?.trim() && { callType: payload.callType.trim() }),
        ...(payload.campaignName?.trim() && { campaignName: payload.campaignName.trim() }),
        ...(payload.transferType?.trim() && { transferType: payload.transferType.trim() }),
        ...(payload.transferredTo?.trim() && { transferredTo: payload.transferredTo.trim() }),
        ...(payload.disposition?.trim() && { disposition: payload.disposition.trim() }),
        ...(payload.comments?.trim() && { comments: payload.comments.trim() }),
      },
    };
  } catch {
    return null;
  }
}

function parseStoredTelephonyStatus(value?: string): TelephonyStatus | undefined {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === 'answered') return 'ANSWERED';
  if (normalized.startsWith('missed')) return 'MISSED';
  if (normalized.startsWith('failed')) return 'FAILED';
  if (normalized === 'ringing') return 'RINGING';
  return undefined;
}

function mergeTelephonyStatus(
  current: TelephonyStatus,
  previous?: TelephonyStatus,
): TelephonyStatus {
  if (!previous) return current;
  if (current === 'ENDED') return current;
  if (current === 'RINGING' && previous !== 'RINGING') return previous;
  if (current === 'MISSED' && (previous === 'ANSWERED' || previous === 'ENDED')) {
    return 'ENDED';
  }
  if (current === 'ANSWERED' && previous === 'ENDED') return previous;
  return current;
}

function parseTelephonyDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const parts = value
    .trim()
    .split(':')
    .map(part => Number(part));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return undefined;
  const [hours, minutes, seconds] = parts as [number, number, number];
  return hours * 3600 + minutes * 60 + seconds;
}

function parseSerializedTelephonyTimestamp(value?: string): Date | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const naiveUtcMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (naiveUtcMatch) {
    return new Date(
      `${naiveUtcMatch[1]}-${naiveUtcMatch[2]}-${naiveUtcMatch[3]}T${naiveUtcMatch[4]}:${naiveUtcMatch[5]}:${naiveUtcMatch[6]}Z`,
    );
  }
  return fromIso(trimmed);
}

const STORED_METADATA_KEYS = [
  'agentId',
  'agentPhoneNumber',
  'agentStatus',
  'callType',
  'callerId',
  'campaignName',
  'comments',
  'customerStatus',
  'dialStatus',
  'disposition',
  'failureReason',
  'liveAgentUserId',
  'monitorUcid',
  'rawStatus',
  'ticketSubjectTemplate',
  'transferType',
  'transferredTo',
  'ucid',
  'uui',
] as const;

function sanitizeStoredMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const next: Record<string, unknown> = {};
  for (const key of STORED_METADATA_KEYS) {
    const value = metadata[key];
    if (value !== undefined && value !== null && (!(typeof value === 'string') || value.trim())) {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function isEnabledForCallType(
  rules: OzonetelTicketRules | undefined,
  callType: string | null | undefined,
): boolean {
  const normalized = String(callType ?? '').toLowerCase();
  if (normalized === 'inbound') return !!rules?.createTicketOnInbound;
  if (normalized === 'manual') return !!rules?.createTicketOnManual;
  if (normalized === 'preview') return !!rules?.createTicketOnPreview;
  if (normalized === 'progressive') return !!rules?.createTicketOnProgressive;
  if (normalized === 'predictive') return !!rules?.createTicketOnPredictive;
  return false;
}

function shouldCreateTicketNow(
  rules: OzonetelTicketRules | undefined,
  call: { status: TelephonyStatus; metadata: Record<string, unknown> },
): boolean {
  const trigger = rules?.createTicketOnEvent ?? 'new_call';
  if (trigger === 'new_call') return true;
  const agentId = typeof call.metadata.agentId === 'string' ? call.metadata.agentId.trim() : '';
  const agentStatus = String(call.metadata.agentStatus ?? '').toLowerCase();
  const dialStatus = String(call.metadata.dialStatus ?? '').toLowerCase();
  const customerStatus = String(call.metadata.customerStatus ?? '').toLowerCase();
  const rawStatus = String(call.metadata.rawStatus ?? '').toLowerCase();
  const hasAnsweredSignal =
    call.status === 'ANSWERED' ||
    (call.status === 'ENDED' &&
      (agentStatus === 'answered' ||
        dialStatus.includes('answered') ||
        customerStatus === 'answered' ||
        rawStatus === 'answered'));
  return hasAnsweredSignal && agentId.length > 0;
}

function normalizeCallType(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return 'Call';
  if (text.toLowerCase() === 'inbound') return 'IncomingCall';
  return text;
}

function renderTemplate(template: string, metadata: Record<string, unknown>, externalId: string): string {
  const rawAgentId = String(metadata.agentId ?? '').trim();
  const values: Record<string, string> = {
    callType: normalizeCallType(metadata.callType),
    agentId: rawAgentId || SYSTEM_AGENT_LABEL,
    monitorUcid: String(metadata.monitorUcid ?? externalId),
    ucid: String(metadata.ucid ?? ''),
    callerId: String(metadata.callerId ?? ''),
  };
  return template.replace(
    /\{(callType|agentId|monitorUcid|ucid|callerId)\}/g,
    (_, key: keyof typeof values) => values[key] ?? '',
  );
}

function asIso(date?: Date): string | undefined {
  return date ? date.toISOString() : undefined;
}

function fromIso(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatDuration(sec?: number | null): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const totalSeconds = Math.max(0, Math.round(sec));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
}

function normalizeStatusLabel(status: TelephonyStatus, metadata: Record<string, unknown> | undefined): string {
  const failureReason = typeof metadata?.failureReason === 'string' ? metadata.failureReason.trim() : '';
  if (status === 'ENDED') return 'Answered';
  if (status === 'ANSWERED') return 'Answered';
  if (status === 'MISSED') return failureReason ? `Missed (${failureReason})` : 'Missed';
  if (status === 'FAILED') return failureReason ? `Failed (${failureReason})` : 'Failed';
  return 'Ringing';
}

function buildEmailBody(meta: TelephonyStoredMetadata): string {
  const metadata = meta.metadata ?? {};
  const payload: TelephonyEmailBodyPayload = {
    provider: 'ozonetel',
    from: String(metadata.callerId ?? meta.fromNumber ?? meta.toNumber ?? '').trim() || undefined,
    agent:
      (typeof metadata.agentId === 'string' && typeof metadata.agentPhoneNumber === 'string'
        ? `${metadata.agentId} (${metadata.agentPhoneNumber})`
        : String(metadata.agentId ?? metadata.agentPhoneNumber ?? SYSTEM_AGENT_LABEL).trim()) ||
      undefined,
    monitorUcid: String(metadata.monitorUcid ?? meta.externalId ?? '').trim() || undefined,
    ucid: typeof metadata.ucid === 'string' ? metadata.ucid.trim() || undefined : undefined,
    uui: typeof metadata.uui === 'string' ? metadata.uui.trim() || undefined : undefined,
    callType: normalizeCallType(metadata.callType),
    campaignName:
      typeof metadata.campaignName === 'string' ? metadata.campaignName.trim() || undefined : undefined,
    startTime: meta.startedAt?.trim() || undefined,
    endTime: meta.endedAt?.trim() || undefined,
    duration: formatDuration(meta.talkTimeSec) ?? undefined,
    status: normalizeStatusLabel(meta.status, metadata),
    transferType:
      typeof metadata.transferType === 'string' ? metadata.transferType.trim() || undefined : undefined,
    transferredTo:
      typeof metadata.transferredTo === 'string'
        ? metadata.transferredTo.trim() || undefined
        : undefined,
    recording: meta.recordingUrl?.trim() || undefined,
    disposition:
      typeof metadata.disposition === 'string' ? metadata.disposition.trim() || undefined : undefined,
    comments:
      typeof metadata.comments === 'string' ? metadata.comments.trim() || undefined : undefined,
  };
  return JSON.stringify(payload);
}

async function ensureTelephonyFormFields(boardId: string, workspaceId: string, createdBy: string): Promise<void> {
  const mapping = await db.formContextMapping.findFirst({
    where: {
      contextId: boardId,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    },
  });

  const provisionNewForm = async (): Promise<void> => {
    const form = await repositories.forms.createWithFields({
      formName: 'Ticket Details',
      entityType: FormEntityType.TICKET,
      contextType: FormContextType.BOARD,
      workspaceId,
      createdBy,
      fields: TELEPHONY_FORM_FIELDS,
    });
    await db.formContextMapping.create({
      data: {
        id: randomUUID(),
        contextId: boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
        formId: form.id,
      },
    });
  };

  if (!mapping) {
    await provisionNewForm();
    return;
  }

  const form = await db.form.findUnique({ where: { id: mapping.formId } });
  if (!form) {
    await db.formContextMapping.delete({ where: { id: mapping.id } });
    await provisionNewForm();
    return;
  }

  const existingFields = await repositories.forms.findFormFields(mapping.formId);
  const existingNames = new Set(existingFields.map(f => f.fieldName));
  const missing = TELEPHONY_FORM_FIELDS.filter(def => !existingNames.has(def.fieldName));
  if (missing.length === 0) return;

  await repositories.forms.updateWithFields(mapping.formId, {
    formName: form.formName,
    formDescription: form.formDescription ?? undefined,
    fields: [
      ...existingFields.map(f => ({
        fieldId: f.id,
        fieldName: f.fieldName,
        fieldType: f.fieldType as unknown as FormFieldType,
        fieldEnum: f.fieldEnum ?? undefined,
        isOptional: f.isOptional,
      })),
      ...missing,
    ],
  });
}

async function syncTicketCustomFields(
  ticketId: string,
  boardId: string,
  workspaceId: string,
  createdBy: string,
  meta: TelephonyStoredMetadata,
): Promise<void> {
  await ensureTelephonyFormFields(boardId, workspaceId, createdBy);
  const current = meta.metadata ?? {};
  await repositories.forms.upsertTicketFormFields(ticketId, boardId, [
    {
      fieldName: 'Campaign Name',
      value: typeof current.campaignName === 'string' ? current.campaignName : null,
    },
    {
      fieldName: 'From Number',
      value: meta.fromNumber ?? null,
    },
    {
      fieldName: 'To Number',
      value: meta.toNumber ?? null,
    },
    { fieldName: 'Call Status', value: meta.status },
    { fieldName: 'Recording URL', value: meta.recordingUrl ?? null },
  ]);
}

export class TelephonyEmailService {
  private emailRepository = new EmailRepository();
  private externalMessageRepository = new ExternalMessageRepository();
  private userRepository = new UserRepository();

  private async findCallEmailById(emailId: string, workspaceId: string) {
    return db.email.findFirst({
      where: {
        id: emailId,
        channel: {
          workspaceId,
          type: ChannelType.CALL,
        },
      },
      select: {
        id: true,
        channelId: true,
        conversationId: true,
        body: true,
      },
    });
  }

  private async findTrackedCallEmail(
    sourceId: string,
    externalId: string,
    workspaceId: string,
  ) {
    const externalMessage = await this.externalMessageRepository.findByExternalId(
      sourceId,
      externalId,
    );
    if (!externalMessage) {
      return { hasTrackingRecord: false, email: null };
    }

    if (
      externalMessage.entityType !== ExternalEntityType.EMAIL ||
      !externalMessage.entityId
    ) {
      return { hasTrackingRecord: true, email: null };
    }

    const email = await this.findCallEmailById(externalMessage.entityId, workspaceId);
    return { hasTrackingRecord: true, email };
  }

  private async resolveCreateContext(event: TelephonyEvent) {
    const cfg = await ozonetelConfigService.getConfig(event.workspaceId);
    const rules = cfg?.ticketRules;
    const callType = String(event.metadata?.callType ?? '');
    if (!isEnabledForCallType(rules, callType)) return null;
    if (!shouldCreateTicketNow(rules, { status: event.status, metadata: event.metadata ?? {} })) return null;
    const targetChannelId = ozonetelConfigService.resolveTargetChannelId(
      rules,
      (event.metadata as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!targetChannelId) return null;

    const [channel, preference] = await Promise.all([
      db.channel.findUnique({
        where: { id: targetChannelId },
        select: { id: true },
      }),
      db.emailChannelPreference.findUnique({
        where: { channelId: targetChannelId },
        select: { ownerUserId: true, boardId: true },
      }),
    ]);
    if (!channel || !preference?.ownerUserId || !preference.boardId) return null;

    const agentUserId = await resolveTelephonyAgentUserId(
      event.workspaceId,
      event.metadata ?? {},
      event.agentUserId,
      cfg?.agentMapping,
    );
    const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId(
      'xyne-automatic',
      event.workspaceId,
    );
    const creatorUserId = agentUserId ?? xyneAutomaticBot?.id ?? preference.ownerUserId;

    return {
      createdBy: creatorUserId,
      channelId: channel.id,
    };
  }

  async prepareCoreIngestion(
    event: TelephonyEvent,
    sourceId: string,
  ): Promise<{ channelId: string; creatorUserId?: string } | null> {
    const trackedCall = await this.findTrackedCallEmail(
      sourceId,
      event.externalId,
      event.workspaceId,
    );
    if (trackedCall.email?.channelId) {
      return { channelId: trackedCall.email.channelId };
    }
    if (trackedCall.hasTrackingRecord) {
      logger.warn(`${TAG} event deferred: invalid tracked email`, {
        sourceId,
        externalId: event.externalId,
        workspaceId: event.workspaceId,
        status: event.status,
      });
      return null;
    }

    const context = await this.resolveCreateContext(event);
    if (!context?.channelId) {
      logger.info(`${TAG} event deferred`, {
        externalId: event.externalId,
        workspaceId: event.workspaceId,
        status: event.status,
      });
      return null;
    }

    return { channelId: context.channelId, creatorUserId: context.createdBy };
  }

  private renderSubject(meta: TelephonyStoredMetadata): string {
    const config = meta.metadata ?? {};
    const template =
      (meta.metadata?.ticketSubjectTemplate as string | undefined)?.trim() ||
      DEFAULT_SUBJECT_TEMPLATE;
    return renderTemplate(template, config, meta.externalId);
  }

  private async resolveAgentIdentity(meta: TelephonyStoredMetadata): Promise<string | null> {
    if (meta.agentUserId) {
      const user = await this.userRepository.findById(meta.agentUserId);
      if (user?.email?.trim()) {
        const displayName = user.displayName?.trim() || user.name?.trim();
        return displayName ? `${displayName} <${user.email.trim()}>` : user.email.trim();
      }
    }

    const agentId = typeof meta.metadata?.agentId === 'string' ? meta.metadata.agentId.trim() : '';
    if (agentId) return agentId;

    return null;
  }

  private async resolveDeskSender(meta: TelephonyStoredMetadata): Promise<string> {
    const agentIdentity = await this.resolveAgentIdentity(meta);
    if (meta.direction === 'INBOUND') {
      return (
        (typeof meta.metadata?.callerId === 'string' ? meta.metadata.callerId.trim() : '') ||
        meta.fromNumber ||
        agentIdentity ||
        'Telephony'
      );
    }

    return agentIdentity || meta.fromNumber || 'Telephony';
  }

  private async resolveDeskRecipients(meta: TelephonyStoredMetadata): Promise<string[]> {
    const agentIdentity = await this.resolveAgentIdentity(meta);
    if (meta.direction === 'INBOUND') {
      if (agentIdentity) return [agentIdentity];
      if (meta.toNumber) return [meta.toNumber];
      return [];
    }

    return meta.toNumber ? [meta.toNumber] : agentIdentity ? [agentIdentity] : [];
  }

  async applyEvent(
    event: TelephonyEvent,
    emailId: string,
  ): Promise<{ emailId: string; externalId: string; ticketId?: string | null }> {
    const existingEmail = await this.findCallEmailById(emailId, event.workspaceId);
    const cfg = await ozonetelConfigService.getConfig(event.workspaceId);
    const configuredSubjectTemplate = cfg?.ticketRules?.ticketSubjectTemplate?.trim();
    const nextMeta: TelephonyStoredMetadata = {
      provider: 'ozonetel',
      externalId: event.externalId,
      workspaceId: event.workspaceId,
      status: event.status,
      direction: event.direction,
      agentUserId: event.agentUserId,
      fromNumber: event.fromNumber,
      toNumber: event.toNumber,
      recordingUrl: event.recordingUrl,
      startedAt: asIso(event.startedAt),
      endedAt: asIso(event.endedAt),
      talkTimeSec: event.talkTimeSec,
      metadata: sanitizeStoredMetadata(event.metadata),
    };
    nextMeta.agentUserId =
      nextMeta.agentUserId ??
      ((await resolveTelephonyAgentUserId(
        event.workspaceId,
        nextMeta.metadata ?? {},
        event.agentUserId,
        cfg?.agentMapping,
      )) ?? undefined);
    const nextMetadata = { ...(nextMeta.metadata ?? {}) };
    if (configuredSubjectTemplate) {
      nextMetadata.ticketSubjectTemplate = configuredSubjectTemplate;
    } else {
      delete nextMetadata.ticketSubjectTemplate;
    }
    nextMeta.metadata = nextMetadata;
    if (!existingEmail) {
      logger.warn(`${TAG} postprocess skipped: core email not found`, {
        externalId: event.externalId,
        workspaceId: event.workspaceId,
        status: event.status,
      });
      return { emailId: '', externalId: event.externalId, ticketId: null };
    }

    const previousMeta = parseStoredTelephonyEmailBody(existingEmail.body);
    const mergedMeta: TelephonyStoredMetadata = {
      ...nextMeta,
      status: mergeTelephonyStatus(nextMeta.status, previousMeta?.status),
      fromNumber: nextMeta.fromNumber ?? previousMeta?.fromNumber,
      startedAt: nextMeta.startedAt ?? previousMeta?.startedAt,
      endedAt: nextMeta.endedAt ?? previousMeta?.endedAt,
      talkTimeSec: nextMeta.talkTimeSec ?? previousMeta?.talkTimeSec,
      recordingUrl: nextMeta.recordingUrl ?? previousMeta?.recordingUrl,
      metadata: {
        ...(previousMeta?.metadata ?? {}),
        ...(nextMeta.metadata ?? {}),
      },
    };
    const subject = this.renderSubject(mergedMeta);
    const from = await this.resolveDeskSender(mergedMeta);
    const to = await this.resolveDeskRecipients(mergedMeta);
    const mergedBody = buildEmailBody(mergedMeta);

    await this.emailRepository.update(existingEmail.id, {
      subject,
      body: mergedBody,
      from,
      to,
      sentByUserId: nextMeta.agentUserId ?? null,
    });

    const ticket = await db.ticket.findFirst({
      where: { conversationId: existingEmail.conversationId },
      select: {
        id: true,
        boardId: true,
        workspaceId: true,
        createdBy: true,
        assignedTo: true,
        title: true,
      },
    });
    if (ticket) {
      const shouldUpdateAssignee =
        !!nextMeta.agentUserId && ticket.assignedTo !== nextMeta.agentUserId;
      const shouldUpdateCreator =
        !!nextMeta.agentUserId && ticket.createdBy !== nextMeta.agentUserId;
      if (ticket.title !== subject || shouldUpdateAssignee || shouldUpdateCreator) {
        const updatedTicket = await db.ticket.update({
          where: { id: ticket.id },
          data: {
            ...(ticket.title !== subject && { title: subject }),
            ...(shouldUpdateAssignee && { assignedTo: nextMeta.agentUserId }),
            ...(shouldUpdateCreator && { createdBy: nextMeta.agentUserId }),
          },
        });
        await syncConversationTicketMdFromPrismaTicket(db, updatedTicket);
      }

      await syncTicketCustomFields(
        ticket.id,
        ticket.boardId,
        ticket.workspaceId,
        ticket.createdBy,
        mergedMeta,
      );
    }

    return { emailId: existingEmail.id, externalId: event.externalId, ticketId: ticket?.id ?? null };
  }
}

export const telephonyEmailService = new TelephonyEmailService();
