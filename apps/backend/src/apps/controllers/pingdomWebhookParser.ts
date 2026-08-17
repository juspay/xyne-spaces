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
 * Pingdom incoming-webhook parser.
 *
 * Pingdom POSTs a single flat JSON object per check state change — no envelope
 * and no inner encoding, unlike SNS. The field mapping is ported from
 * infra-switch's Pingdom branch (`src/AlertProxy/Types/API/PingdomTrigger.hs`
 * for the wire shape, `src/AlertProxy/Utils/Common.hs:198-216` and `:340-365`
 * for the rendered fields).
 *
 * See https://www.pingdom.com/resources/webhooks/
 */

export interface PingdomProbe {
  ip?: string;
  ipv6?: string;
  location?: string;
}

export interface PingdomCheckParams {
  basic_auth?: boolean;
  encryption?: boolean;
  full_url?: string;
  header?: string;
  hostname?: string;
  ipv6?: boolean;
  port?: number;
  responsetime_threshold?: number;
  url?: string;
  verify_certificate?: boolean;
}

export interface PingdomPayload {
  version?: number;
  check_id: number;
  check_name: string;
  check_type?: string;
  check_params?: PingdomCheckParams;
  tags?: string[];
  importance_level?: string;
  custom_message?: string;
  previous_state?: string;
  current_state: string;
  /** Unix epoch seconds. */
  state_changed_timestamp?: number;
  /** `2023-10-23T06:37:36` — Pingdom omits the trailing `Z`. */
  state_changed_utc_time?: string;
  long_description?: string;
  description?: string;
  first_probe?: PingdomProbe;
  second_probe?: PingdomProbe;
}

export interface PingdomNormalizedPayload {
  title: string;
  /** Drives the card's left stripe colour. */
  severity: AlertSeverity;
  /** The severity as rendered in the card body, e.g. `CRITICAL`. */
  severityLabel: string;
  status: string;
  fields: Array<[label: string, value: string]>;
  description: string | null;
  consoleUrl: string | null;
  checkId: number;
  hostname: string | null;
  owner: string | null;
  timestamp: string | null;
}

/**
 * States that infra-switch's `makeAlertState`
 * (`src/AlertProxy/Utils/Common.hs:680-685`) treats as recovered. Everything
 * else — `DOWN` included — counts as firing.
 */
const RESOLVED_STATES = new Set(['UP', 'OK', 'RESOLVED']);

/**
 * Pingdom carries no structured metadata beyond tags, so infra-switch encodes
 * `severity`, `owner` and friends into them as `key---value`
 * (`src/AlertManager/App/Alerts/WorkflowStages/Transformer.hs:168-173`) and
 * decodes them on sync (`.../Common.hs:289-301`). Checks tagged by hand — and
 * the webhook sample in `sample/alert-proxy/pingdom-http-trigger.json` — use
 * `key::value` instead, so both separators are accepted.
 */
function parseTags(tags: string[] | undefined): Record<string, string> {
  if (!Array.isArray(tags)) {
    return {};
  }

  const parsed: Record<string, string> = {};
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      continue;
    }
    const match = /^([^:-]+)(?:---|::)(.+)$/.exec(tag.trim());
    if (match) {
      parsed[match[1].toLowerCase()] = match[2];
    }
  }
  return parsed;
}

/**
 * The severity infra-switch shows is the one stored on its alert row, seeded
 * from the check's `severity` tag at sync time. Fall back to the webhook's own
 * `importance_level` when the check carries no tag. Note this is independent of
 * the firing state — a recovered check still reports its configured severity,
 * matching infra-switch, while only the stripe colour flips to green.
 */
function resolveSeverityLabel(
  tags: Record<string, string>,
  importanceLevel: string | undefined,
): string {
  const fromTag = tags.severity?.trim();
  if (fromTag) {
    return fromTag.toUpperCase();
  }
  return String(importanceLevel ?? '').toUpperCase() === 'LOW' ? 'WARNING' : 'CRITICAL';
}

/** Card stripe colour for a firing check, from its rendered severity label. */
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

/**
 * Structural validation only, mirroring `parseSnsEnvelope`. Pingdom marks most
 * of its payload as required, but the abridged bodies real checks emit (see
 * infra-switch `sample/alert-proxy/pingdom-http-trigger.json`) carry only the
 * identity, state and description fields — those must still render rather than
 * 400, so only those are enforced here.
 */
export function parsePingdomPayload(raw: unknown): PingdomPayload | null {
  if (!isRecord(raw)) {
    return null;
  }

  const { check_id, check_name, current_state } = raw as Partial<PingdomPayload>;
  if (typeof check_id !== 'number' || !Number.isFinite(check_id)) {
    return null;
  }
  if (typeof check_name !== 'string' || typeof current_state !== 'string') {
    return null;
  }

  return raw as unknown as PingdomPayload;
}

/** `2023-10-23T06:37:36` → `2023-10-23T06:37:36Z`, else the epoch fallback. */
function resolveTimestamp(payload: PingdomPayload): string | null {
  const utcTime = payload.state_changed_utc_time;
  if (typeof utcTime === 'string' && utcTime.trim()) {
    return /[Zz]|[+-]\d{2}:?\d{2}$/.test(utcTime) ? utcTime : `${utcTime}Z`;
  }
  if (typeof payload.state_changed_timestamp === 'number') {
    const date = new Date(payload.state_changed_timestamp * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function normalizePingdom(payload: PingdomPayload): PingdomNormalizedPayload {
  const status = payload.current_state.toUpperCase();
  const params = isRecord(payload.check_params)
    ? (payload.check_params as PingdomCheckParams)
    : {};
  const tags = parseTags(payload.tags);
  const severityLabel = resolveSeverityLabel(tags, payload.importance_level);

  // UP/OK/RESOLVED are recovery; anything else is firing. Only the stripe
  // colour tracks the state — the rendered severity stays as configured.
  const severity: AlertSeverity = RESOLVED_STATES.has(status)
    ? 'ok'
    : stripeSeverity(severityLabel);

  // `long_description` is infra-switch's "Reason" field and Slack description
  // block; `description` is the shorter variant it falls back to.
  const description = toDisplayValue(payload.long_description ?? payload.description);
  const hostname = typeof params.hostname === 'string' ? params.hostname : null;
  const owner = tags.owner?.trim() || null;

  return {
    title: payload.check_name,
    severity,
    severityLabel,
    status,
    // Exactly the rows infra-switch's Slack card carries
    // (`src/AlertProxy/Utils/Common.hs:352-360`). Owner and Message are dropped
    // by buildFields when absent, as they are in the Haskell.
    fields: buildFields([
      ['Alarm State', status],
      ['Severity', severityLabel],
      ['Description', description],
      ['Owner', owner],
      ['Message', payload.custom_message],
    ]),
    description: description === 'N/A' ? null : truncate(description, MAX_DESCRIPTION_LENGTH),
    consoleUrl: `https://my.pingdom.com/reports/uptime#check=${payload.check_id}`,
    checkId: payload.check_id,
    hostname,
    owner,
    timestamp: resolveTimestamp(payload),
  };
}

/**
 * `🚨 Pingdom Alert | pingdom test alert | api.juspay.in`, the hostname omitted
 * when the check params did not carry it. infra-switch renders the equivalent
 * line as a single hyperlink (`src/AlertProxy/Utils/Common.hs:344`), using the
 * DB alert's account where we use the checked hostname.
 */
function buildHeaderLabel(payload: PingdomNormalizedPayload): string {
  return ['🚨 Pingdom Alert', payload.title, payload.hostname].filter(Boolean).join(' | ');
}

export function buildPingdomFlow(payload: PingdomNormalizedPayload): FlowDefinition {
  const headerLabel = buildHeaderLabel(payload);

  // The header doubles as the link to the check, as it does in infra-switch's
  // Slack card. `link.props.href` is validated with z.string().url(), so fall
  // back to a plain heading when there is no usable URL.
  const header: FlowComponent = isHttpUrl(payload.consoleUrl)
    ? {
        id: 'pingdom-header',
        type: 'link',
        props: { href: payload.consoleUrl, label: headerLabel, external: true },
      }
    : { id: 'pingdom-header', type: 'heading', props: { content: headerLabel, level: 3 } };

  const children: FlowComponent[] = [header];

  if (payload.description) {
    children.push({
      id: 'pingdom-description',
      type: 'text',
      props: { content: payload.description, variant: 'muted' },
    });
  }

  if (payload.fields.length > 0) {
    children.push(fieldsToGrid(payload.fields, 'pingdom'));
  }

  return {
    version: '2.0',
    screenId: `pingdom-${Date.now()}`,
    // `DOWN | Cards MEA offers list API`, the line infra-switch puts above the
    // Slack attachment (`src/AlertProxy/Utils/Common.hs:361`). The header link
    // below keeps the bare check name, as it does there.
    title: `${payload.status} | ${payload.title}`,
    components: [
      {
        id: 'pingdom-card',
        type: 'card',
        children: [
          withColorStripe('pingdom-stripe', children, SEVERITY_STRIPE[payload.severity]),
        ],
      },
    ],
    state: emptyFlowState(),
  };
}
