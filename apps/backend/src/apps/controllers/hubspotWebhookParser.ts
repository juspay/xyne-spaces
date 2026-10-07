import type { FlowComponent, FlowDefinition } from '@xyne/shared';
import {
  MAX_DESCRIPTION_LENGTH,
  buildFields,
  emptyFlowState,
  fieldsToGrid,
  isHttpUrl,
  isRecord,
  truncate,
  withColorStripe,
} from './alertWebhookShared';

/**
 * HubSpot incoming-webhook parser.
 *
 * Unlike the three alert sources, HubSpot is a CRM *change feed*, not an alert
 * stream: there is no severity, no firing/resolved pair, and no incident. So
 * this parser borrows the card primitives from `alertWebhookShared` but not
 * `AlertSeverity` / `SEVERITY_STRIPE` — see `HUBSPOT_EVENT_STRIPE` below.
 *
 * Two further departures from the SNS/Pingdom/GCP parsers:
 *
 *  1. The request body is a JSON *array* of events, so `parseHubspotPayload`
 *     returns a list and the caller fans out. One POST can become N cards.
 *  2. HubSpot retries a failed batch up to 10 times over 24h with
 *     `attemptNumber` incrementing from 0, so the caller MUST dedupe on
 *     `hubspotEventDedupKey` and MUST ack 200 before processing — HubSpot
 *     treats >5s as a failure and grows the batch on retry.
 *
 * These are the "generic" (expanded object support) subscriptions, where the
 * object type lives in `objectTypeId` rather than in the subscription name
 * (`object.propertyChange`, not `contact.propertyChange`).
 *
 * See https://developers.hubspot.com/docs/apps/legacy-apps/public-apps/create-generic-webhook-subscriptions
 */

export type HubspotSubscriptionType =
  | 'object.creation'
  | 'object.deletion'
  | 'object.propertyChange'
  | 'object.merge'
  | 'object.restore'
  | 'object.associationChange';

const SUBSCRIPTION_TYPES = new Set<string>([
  'object.creation',
  'object.deletion',
  'object.propertyChange',
  'object.merge',
  'object.restore',
  'object.associationChange',
]);

/**
 * Standard CRM object type ids. Custom objects are `2-<n>` and resolve only via
 * `GET /crm-object-schemas/{version}/schemas`, which needs a portal token we do
 * not hold here — those fall back to the raw id.
 */
export const HUBSPOT_OBJECT_TYPE_LABELS: Record<string, string> = {
  '0-1': 'Contact',
  '0-2': 'Company',
  '0-3': 'Deal',
  '0-5': 'Ticket',
  '0-7': 'Product',
  '0-8': 'Line item',
  '0-14': 'Quote',
  '0-18': 'Communication',
  '0-19': 'Feedback submission',
  '0-27': 'Task',
  '0-46': 'Note',
  '0-47': 'Meeting',
  '0-48': 'Call',
  '0-49': 'Email',
  '0-53': 'Invoice',
  '0-54': 'Marketing event',
  '0-69': 'Subscription',
  '0-74': 'Goal',
  '0-101': 'Payment',
  '0-115': 'User',
  '0-116': 'Postal mail',
  '0-123': 'Order',
  '0-136': 'Lead',
  '0-142': 'Cart',
};

/**
 * Change sources that are machine-generated rather than a human edit.
 *
 * `DATA_ENRICHMENT` is Breeze auto-enrichment and `IMPORT` is a CSV load: both
 * fire one `object.propertyChange` per property per record, so a single bulk run
 * buries a channel. Excluded by default; a webhook config can opt back in.
 */
export const DEFAULT_SKIPPED_CHANGE_SOURCES = new Set(['DATA_ENRICHMENT', 'IMPORT']);

/**
 * Left-edge stripe per event type.
 *
 * Deliberately not `SEVERITY_STRIPE`: these are not severities, and reusing that
 * map would imply a `critical` HubSpot event exists. The palette is the same so
 * HubSpot cards sit beside alert cards without looking foreign.
 */
export const HUBSPOT_EVENT_STRIPE: Record<HubspotSubscriptionType, string> = {
  'object.creation': '#04ba1c',
  'object.restore': '#04ba1c',
  'object.propertyChange': '#d1d5db',
  'object.associationChange': '#d1d5db',
  'object.merge': '#ECB22E',
  'object.deletion': '#d91009',
};

interface HubspotEventBase {
  /** Unique per event; combined with `subscriptionId` it is the dedup key. */
  eventId: number;
  subscriptionId?: number;
  /** The customer's HubSpot account. One app targetUrl serves every install. */
  portalId?: number;
  appId?: number;
  /** Epoch *milliseconds* — not seconds, unlike the Pingdom/GCP timestamps. */
  occurredAt?: number;
  /** 0-based. Non-zero means a previous delivery of this same event failed. */
  attemptNumber?: number;
  objectId?: number;
  objectTypeId?: string;
  changeSource?: string;
  /** `userId:70069977`, or absent — HubSpot omits it on creation events. */
  sourceId?: string;
  /** Documented as a general field but absent from observed payloads. */
  label?: string;
}

export interface HubspotCreationEvent extends HubspotEventBase {
  subscriptionType: 'object.creation';
  /** `NEW` on the observed creation payload. */
  changeFlag?: string;
}

export interface HubspotDeletionEvent extends HubspotEventBase {
  subscriptionType: 'object.deletion';
  changeFlag?: string;
}

export interface HubspotRestoreEvent extends HubspotEventBase {
  subscriptionType: 'object.restore';
}

export interface HubspotPropertyChangeEvent extends HubspotEventBase {
  subscriptionType: 'object.propertyChange';
  propertyName?: string;
  /** Always a string on the wire, even for numeric and date properties. */
  propertyValue?: string;
  /**
   * HubSpot's sensitive-data classification. When true the value must not be
   * rendered. Newer than HubSpot's own generic-subscription docs, so optional.
   */
  isSensitive?: boolean;
}

export interface HubspotMergeEvent extends HubspotEventBase {
  subscriptionType: 'object.merge';
  primaryObjectId?: number;
  mergedObjectIds?: number[];
  newObjectId?: number;
  numberOfPropertiesMoved?: number;
}

export interface HubspotAssociationChangeEvent extends HubspotEventBase {
  subscriptionType: 'object.associationChange';
  fromObjectTypeId?: string;
  toObjectTypeId?: string;
  associationTypeId?: number;
  associationCategory?: string;
}

export type HubspotWebhookEvent =
  | HubspotCreationEvent
  | HubspotDeletionEvent
  | HubspotRestoreEvent
  | HubspotPropertyChangeEvent
  | HubspotMergeEvent
  | HubspotAssociationChangeEvent;

export interface HubspotNormalizedEvent {
  /** `<subscriptionId>:<eventId>`; the idempotency key against retries. */
  dedupKey: string;
  subscriptionType: HubspotSubscriptionType;
  /** e.g. `Contact created`. */
  title: string;
  objectTypeLabel: string;
  /**
   * Strings, not numbers: observed ids reach 874716779721, which overflows a
   * Postgres `integer`, and they are only ever used as opaque identifiers.
   */
  objectId: string | null;
  portalId: string | null;
  fields: Array<[label: string, value: string]>;
  description: string | null;
  recordUrl: string | null;
  changeSource: string | null;
  /** ISO 8601, converted from `occurredAt`'s epoch milliseconds. */
  timestamp: string | null;
  /** True when this delivery is a retry, i.e. `attemptNumber > 0`. */
  isRetry: boolean;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Structural validation only, mirroring `parseGcpPayload`.
 *
 * Just two fields are enforced — `eventId` and a known `subscriptionType` —
 * because they are the minimum needed to dedupe and to dispatch; everything
 * else differs by event type and is normalized defensively.
 *
 * Individually malformed events are dropped rather than failing the batch: the
 * caller has to ack 200 regardless (a non-2xx makes HubSpot redeliver all ten
 * times), so rejecting the whole array would only discard the valid events too.
 * Returns null when the body is not an array at all.
 */
export function parseHubspotPayload(raw: unknown): HubspotWebhookEvent[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const events: HubspotWebhookEvent[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const subscriptionType = asString(entry.subscriptionType);
    if (!subscriptionType || !SUBSCRIPTION_TYPES.has(subscriptionType)) {
      continue;
    }
    if (asNumber(entry.eventId) === undefined) {
      continue;
    }
    events.push(entry as unknown as HubspotWebhookEvent);
  }

  return events;
}

export function hubspotEventDedupKey(event: HubspotWebhookEvent): string {
  return `${event.subscriptionId ?? 'na'}:${event.eventId}`;
}

/** Whether this event's change source is filtered out by the webhook config. */
export function isSkippedChangeSource(
  event: HubspotWebhookEvent,
  skipped: Set<string> = DEFAULT_SKIPPED_CHANGE_SOURCES,
): boolean {
  const source = asString(event.changeSource);
  return source !== undefined && skipped.has(source.toUpperCase());
}

export function hubspotObjectTypeLabel(objectTypeId: string | undefined): string {
  if (!objectTypeId) {
    return 'Record';
  }
  return HUBSPOT_OBJECT_TYPE_LABELS[objectTypeId] ?? objectTypeId;
}

/**
 * The generic record route, which works for every object type including custom
 * ones — unlike the older `/contacts/<portalId>/contact/<id>` form.
 */
export function hubspotRecordUrl(
  portalId: number | undefined,
  objectTypeId: string | undefined,
  objectId: number | undefined,
): string | null {
  if (portalId === undefined || !objectTypeId || objectId === undefined) {
    return null;
  }
  return `https://app.hubspot.com/contacts/${portalId}/record/${objectTypeId}/${objectId}`;
}

const VERB: Record<HubspotSubscriptionType, string> = {
  'object.creation': 'created',
  'object.deletion': 'deleted',
  'object.propertyChange': 'updated',
  'object.merge': 'merged',
  'object.restore': 'restored',
  'object.associationChange': 'association changed',
};

export function normalizeHubspotEvent(event: HubspotWebhookEvent): HubspotNormalizedEvent {
  const objectTypeLabel = hubspotObjectTypeLabel(event.objectTypeId);
  const entries: Array<[string, unknown]> = [];
  let description: string | null = null;

  switch (event.subscriptionType) {
    case 'object.propertyChange': {
      // Redact rather than render when HubSpot flags the property as sensitive.
      const value = event.isSensitive === true ? '(hidden — sensitive property)' : event.propertyValue;
      entries.push(['PROPERTY', event.propertyName], ['VALUE', value]);
      break;
    }
    case 'object.merge': {
      entries.push(
        ['PRIMARY OBJECT', event.primaryObjectId],
        ['NEW OBJECT', event.newObjectId],
        ['MERGED OBJECTS', event.mergedObjectIds?.join(', ')],
        ['PROPERTIES MOVED', event.numberOfPropertiesMoved],
      );
      break;
    }
    case 'object.associationChange': {
      entries.push(
        ['FROM', hubspotObjectTypeLabel(event.fromObjectTypeId)],
        ['TO', hubspotObjectTypeLabel(event.toObjectTypeId)],
        ['ASSOCIATION TYPE', event.associationTypeId],
        ['CATEGORY', event.associationCategory],
      );
      break;
    }
    case 'object.creation':
    case 'object.deletion': {
      entries.push(['CHANGE', event.changeFlag]);
      break;
    }
    case 'object.restore':
      break;
  }

  entries.push(
    ['RECORD', event.objectId],
    ['SOURCE', event.changeSource],
    ['CHANGED BY', event.sourceId],
  );

  if (event.label) {
    description = truncate(event.label, MAX_DESCRIPTION_LENGTH);
  }

  const occurredAt = asNumber(event.occurredAt);

  return {
    dedupKey: hubspotEventDedupKey(event),
    subscriptionType: event.subscriptionType,
    title: `${objectTypeLabel} ${VERB[event.subscriptionType]}`,
    objectTypeLabel,
    objectId: event.objectId === undefined ? null : String(event.objectId),
    portalId: event.portalId === undefined ? null : String(event.portalId),
    fields: buildFields(entries),
    description,
    recordUrl: hubspotRecordUrl(event.portalId, event.objectTypeId, event.objectId),
    changeSource: asString(event.changeSource) ?? null,
    // Epoch milliseconds, so no *1000 here unlike the Pingdom/GCP parsers.
    timestamp: occurredAt === undefined ? null : new Date(occurredAt).toISOString(),
    isRetry: (asNumber(event.attemptNumber) ?? 0) > 0,
  };
}

export function buildHubspotFlow(payload: HubspotNormalizedEvent): FlowDefinition {
  // The header doubles as the link to the record in HubSpot; `link.props.href`
  // is validated with z.string().url(), so fall back to a plain heading.
  const header: FlowComponent = isHttpUrl(payload.recordUrl)
    ? {
        id: 'hubspot-header',
        type: 'link',
        props: { href: payload.recordUrl, label: payload.title, external: true },
      }
    : { id: 'hubspot-header', type: 'heading', props: { content: payload.title, level: 3 } };

  const children: FlowComponent[] = [header];

  if (payload.description) {
    children.push({
      id: 'hubspot-description',
      type: 'text',
      props: { content: payload.description, variant: 'muted' },
    });
  }

  if (payload.fields.length > 0) {
    children.push(fieldsToGrid(payload.fields, 'hubspot'));
  }

  return {
    version: '2.0',
    screenId: `hubspot-${payload.dedupKey}`,
    title: payload.title,
    components: [
      {
        id: 'hubspot-card',
        type: 'card',
        children: [
          withColorStripe(
            'hubspot-stripe',
            children,
            HUBSPOT_EVENT_STRIPE[payload.subscriptionType],
          ),
        ],
      },
    ],
    state: emptyFlowState(),
  };
}
