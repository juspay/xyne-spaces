import type { FlowComponent, FlowDefinition } from '@xyne/shared';
import {
  MAX_DESCRIPTION_LENGTH,
  SEVERITY_STRIPE,
  buildFields,
  emptyFlowState,
  fieldsToGrid,
  isHttpUrl,
  isRecord,
  toDisplayValue,
  truncate,
  withColorStripe,
} from './alertWebhookShared';
import type { AlertSeverity } from './alertWebhookShared';

/**
 * GCP Cloud Monitoring incoming-webhook parser.
 *
 * A `webhook_basicauth` / `webhook_tokenauth` notification channel POSTs
 * `{ version, incident }` directly — no envelope and no base64, unlike a
 * Pub/Sub push subscription, which is not handled here. The shape and the field
 * mapping are ported from infra-switch
 * (`src/AlertProxy/Types/API/GcpTrigger.hs` for the wire shape,
 * `src/AlertProxy/Types/API/UnifiedAlertTrigger.hs:115-142` for status/labels,
 * `src/AlertProxy/Utils/Common.hs:259-275` and `:416-441` for the rendering).
 *
 * See https://cloud.google.com/monitoring/support/notification-options#webhooks
 */

export interface GcpDocumentation {
  content?: string;
  mime_type?: string;
}

export interface GcpMetric {
  type?: string;
  displayName?: string;
  labels?: Record<string, string>;
}

export interface GcpResource {
  type?: string;
  labels?: Record<string, string>;
}

export interface GcpMetadata {
  system_labels?: Record<string, string>;
  user_labels?: Record<string, string>;
}

export interface GcpIncident {
  incident_id?: string;
  scoping_project_id?: string;
  scoping_project_number?: number;
  url?: string;
  resource_id?: string;
  resource_name?: string;
  /** `open` | `closed`. */
  state: string;
  /** Unix epoch seconds. */
  started_at?: number;
  /** Unix epoch seconds. */
  ended_at?: number;
  policy_name: string;
  policy_user_labels?: Record<string, string>;
  condition_name: string;
  condition?: unknown;
  summary?: string;
  documentation?: GcpDocumentation;
  metric?: GcpMetric;
  resource?: GcpResource;
  metadata?: GcpMetadata;
  observed_value?: string;
  /**
   * Not present in infra-switch's Haskell record, which therefore ignores it.
   * GCP does send it on newer policies, and it is the only severity signal in
   * the payload, so it is read here.
   */
  severity?: string;
}

export interface GcpPayload {
  version?: string;
  incident: GcpIncident;
}

export interface GcpNormalizedPayload {
  title: string;
  /** Drives the card's left stripe colour. */
  severity: AlertSeverity;
  /** The severity as rendered in the card body, e.g. `CRITICAL`. */
  severityLabel: string;
  status: string;
  fields: Array<[label: string, value: string]>;
  description: string | null;
  consoleUrl: string | null;
  incidentId: string | null;
  projectId: string | null;
  owner: string | null;
  timestamp: string | null;
}

/**
 * Structural validation only, mirroring `parseSnsEnvelope`. The three enforced
 * incident fields are exactly the non-`Maybe` ones of infra-switch's
 * `GcpIncident` (`src/AlertProxy/Types/API/GcpTrigger.hs:51-72`).
 */
export function parseGcpPayload(raw: unknown): GcpPayload | null {
  if (!isRecord(raw) || !isRecord(raw.incident)) {
    return null;
  }

  const incident = raw.incident;
  if (
    typeof incident.state !== 'string' ||
    typeof incident.policy_name !== 'string' ||
    typeof incident.condition_name !== 'string'
  ) {
    return null;
  }

  return raw as unknown as GcpPayload;
}

function labelBag(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const entries = Object.entries(value).filter(([, val]) => typeof val === 'string');
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Union of every label bag on the incident.
 *
 * Port of `getLabels` (`src/AlertProxy/Types/API/UnifiedAlertTrigger.hs:121-137`),
 * whose `Map.unions` is left-biased, giving the precedence
 * `policy_user_labels > resource.labels > metadata.user_labels > metric.labels`.
 * Spread order below is the reverse of that, so higher-precedence bags overwrite.
 */
export function mergeGcpLabels(incident: GcpIncident): Record<string, string> {
  return {
    ...labelBag(incident.metric?.labels),
    ...labelBag(incident.metadata?.user_labels),
    ...labelBag(incident.resource?.labels),
    ...labelBag(incident.policy_user_labels),
  };
}

/**
 * The severity infra-switch renders is the one stored on its alert row, whose
 * vocabulary is `INFO | WARNING | ERROR | CRITICAL`
 * (`src/AlertManager/Types/Alerts.hs:129`). Anything unrecognised is treated as
 * critical, matching `parseGcpSeverity`'s default
 * (`src/AlertManager/App/Alerts/WorkflowStages/Transformer.hs:522-528`).
 */
function normalizeSeverityName(raw: string | undefined): string | null {
  const upper = String(raw ?? '').trim().toUpperCase();
  return ['CRITICAL', 'ERROR', 'WARNING', 'INFO'].includes(upper) ? upper : null;
}

/** Card stripe colour for a firing incident, from its rendered severity label. */
function stripeSeverity(severityLabel: string): AlertSeverity {
  switch (severityLabel) {
    case 'WARNING':
      return 'warning';
    case 'INFO':
      return 'info';
    default:
      return 'critical';
  }
}

function epochSecondsToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeGcp(payload: GcpPayload): GcpNormalizedPayload {
  const incident = payload.incident;
  const labels = mergeGcpLabels(incident);

  // `open` fires, anything else resolves — the mapping `getStatus` and the three
  // inline re-derivations in infra-switch all agree on.
  const isOpen = incident.state === 'open';
  const status = isOpen ? 'FIRING' : 'RESOLVED';

  // infra-switch reads the severity off its DB alert row, which has no analog
  // here, so fall back through the payload's own signals. Like the Haskell, this
  // is independent of the firing state — a closed incident still reports its
  // configured severity and only the stripe colour flips to green.
  const severityLabel =
    normalizeSeverityName(incident.severity) ??
    normalizeSeverityName(incident.policy_user_labels?.severity) ??
    normalizeSeverityName(labels.severity) ??
    'CRITICAL';
  const severity: AlertSeverity = isOpen ? stripeSeverity(severityLabel) : 'ok';

  // `summary` then `documentation.content` — the `getAnnotations` precedence at
  // `src/AlertProxy/Types/API/UnifiedAlertTrigger.hs:139-142`.
  const description = toDisplayValue(incident.summary ?? incident.documentation?.content);
  const startedAt = epochSecondsToIso(incident.started_at);
  const endedAt = epochSecondsToIso(incident.ended_at);
  // infra-switch stamps the owner into the policy's user labels when it syncs
  // the alert (`.../Transformer.hs:497`), which is where it reads back here.
  const owner = (incident.policy_user_labels?.owner ?? labels.owner)?.trim() || null;

  return {
    title: incident.policy_name,
    severity,
    severityLabel,
    status,
    // Exactly the four rows of the Slack card's fields section
    // (`src/AlertProxy/Utils/Common.hs:427-432`). Owner drops out when the
    // policy carries no owner label.
    fields: buildFields([
      ['Alarm State', status],
      ['Severity', severityLabel],
      ['Condition', incident.condition_name],
      ['Owner', owner],
    ]),
    description: description === 'N/A' ? null : truncate(description, MAX_DESCRIPTION_LENGTH),
    consoleUrl: typeof incident.url === 'string' ? incident.url : null,
    incidentId: typeof incident.incident_id === 'string' ? incident.incident_id : null,
    projectId: typeof incident.scoping_project_id === 'string'
      ? incident.scoping_project_id
      : null,
    owner,
    timestamp: endedAt ?? startedAt,
  };
}

/**
 * `🚨 GCP Alert | High CPU | my-proj`, the project omitted when the incident did
 * not carry it. Mirrors infra-switch's Slack heading
 * (`src/AlertProxy/Utils/Common.hs:421`), using the scoping project where it
 * uses the DB alert's account.
 */
function buildHeaderLabel(payload: GcpNormalizedPayload): string {
  return ['🚨 GCP Alert', payload.title, payload.projectId].filter(Boolean).join(' | ');
}

export function buildGcpFlow(payload: GcpNormalizedPayload): FlowDefinition {
  const headerLabel = buildHeaderLabel(payload);

  // The header doubles as the link to the incident in the Cloud console.
  // `link.props.href` is validated with z.string().url(), so fall back to a
  // plain heading when there is no usable URL.
  const header: FlowComponent = isHttpUrl(payload.consoleUrl)
    ? {
        id: 'gcp-header',
        type: 'link',
        props: { href: payload.consoleUrl, label: headerLabel, external: true },
      }
    : { id: 'gcp-header', type: 'heading', props: { content: headerLabel, level: 3 } };

  const children: FlowComponent[] = [header];

  if (payload.description) {
    children.push({
      id: 'gcp-description',
      type: 'text',
      props: { content: payload.description, variant: 'muted' },
    });
  }

  if (payload.fields.length > 0) {
    children.push(fieldsToGrid(payload.fields, 'gcp'));
  }

  return {
    version: '2.0',
    screenId: `gcp-${Date.now()}`,
    // `FIRING | High CPU`, the line infra-switch puts above the Slack
    // attachment. The header link below keeps the bare policy name.
    title: `${payload.status} | ${payload.title}`,
    components: [
      {
        id: 'gcp-card',
        type: 'card',
        children: [withColorStripe('gcp-stripe', children, SEVERITY_STRIPE[payload.severity])],
      },
    ],
    state: emptyFlowState(),
  };
}
