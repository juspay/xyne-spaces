import type { FlowComponent, FlowDefinition } from '@xyne/shared';
import {
  MAX_DESCRIPTION_LENGTH,
  SEVERITY_STRIPE,
  buildFields,
  emptyFlowState,
  fieldsToGrid,
  isHttpUrl,
  isRecord,
  isScalar,
  passthroughLabels,
  toDisplayValue,
  truncate,
  withColorStripe,
} from './alertWebhookShared';
import type { AlertSeverity } from './alertWebhookShared';

/**
 * Amazon SNS incoming-webhook parser.
 *
 * SNS wraps every delivery in an envelope whose `Message` field is itself a
 * JSON *string*, so the payload has to be parsed twice. The inner shape varies
 * by publisher (CloudWatch, Prometheus/VictoriaMetrics, RDS event
 * subscriptions, EventBridge), and is not tagged — we discriminate structurally
 * in a fixed order, falling back to a generic card so nothing is ever dropped.
 *
 * See https://docs.aws.amazon.com/sns/latest/dg/SendMessageToHttp.prepare.html
 */

export const SNS_MESSAGE_TYPES = [
  'Notification',
  'SubscriptionConfirmation',
  'UnsubscribeConfirmation',
] as const;

export type SnsMessageType = (typeof SNS_MESSAGE_TYPES)[number];

export interface SnsEnvelope {
  Type: SnsMessageType;
  MessageId?: string;
  TopicArn: string;
  Subject?: string | null;
  Message: string;
  Timestamp?: string;
  SubscribeURL?: string;
  Token?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  UnsubscribeURL?: string;
}

export type SnsAlertSource =
  | 'cloudwatch'
  | 'prometheus'
  | 'rds'
  | 'eventbridge'
  | 'generic';

/** Alias kept so existing SNS-specific imports keep working. */
export type SnsSeverity = AlertSeverity;

export interface SnsNormalizedPayload {
  source: SnsAlertSource;
  title: string;
  severity: SnsSeverity;
  status: string;
  fields: Array<[label: string, value: string]>;
  description: string | null;
  consoleUrl: string | null;
  topicArn: string;
  region: string | null;
  accountId: string | null;
  timestamp: string | null;
}

/**
 * actionId on the "Do Confirmation" button. flowController intercepts this
 * instead of proxying the action to an app backend, because an incoming webhook
 * has no outbound webhookUrl to proxy to.
 */
export const SNS_CONFIRM_ACTION_ID = 'sns_confirm_subscription';

/**
 * Split an SNS topic ARN into its region and account id.
 * Ported from infra-switch `src/AlertProxy/App/Helper.hs:455-458`.
 */
export function parseSnsTopicArn(arn: string): { region: string | null; accountId: string | null } {
  const parts = (arn ?? '').split(':');
  if (parts.length >= 6 && parts[0] === 'arn' && parts[2] === 'sns') {
    return { region: parts[3] || null, accountId: parts[4] || null };
  }
  return { region: null, accountId: null };
}

/** CloudWatch's `Region` field is a display name, so take the code from the ARN. */
function regionCodeFromArn(arn: string | undefined, fallback: string | null): string | null {
  const parts = (arn ?? '').split(':');
  return parts.length >= 4 && parts[0] === 'arn' ? parts[3] || fallback : fallback;
}

export function parseSnsEnvelope(raw: unknown): SnsEnvelope | null {
  if (!isRecord(raw)) {
    return null;
  }

  const { Type, Message, TopicArn } = raw as Partial<SnsEnvelope>;
  if (typeof Type !== 'string' || !SNS_MESSAGE_TYPES.includes(Type as SnsMessageType)) {
    return null;
  }
  if (typeof Message !== 'string' || typeof TopicArn !== 'string') {
    return null;
  }

  return raw as unknown as SnsEnvelope;
}

// ============================================================================
// INNER MESSAGE PARSERS
// ============================================================================

function parseCloudWatch(
  message: Record<string, unknown>,
  envelope: SnsEnvelope,
): SnsNormalizedPayload {
  const { region, accountId } = parseSnsTopicArn(envelope.TopicArn);
  const alarmName = toDisplayValue(message.AlarmName);
  const newState = String(message.NewStateValue ?? 'UNKNOWN');

  // ALARM → critical, OK → ok, INSUFFICIENT_DATA → warning.
  // Mirrors infra-switch `Types/API/UnifiedAlertTrigger.hs:38-41`.
  const severity: SnsSeverity =
    newState === 'ALARM' ? 'critical' : newState === 'OK' ? 'ok' : 'warning';

  const trigger = isRecord(message.Trigger) ? message.Trigger : {};
  const alarmArn = typeof message.AlarmArn === 'string' ? message.AlarmArn : undefined;
  const regionCode = regionCodeFromArn(alarmArn, region);

  const consoleUrl =
    regionCode && alarmName !== 'N/A'
      ? `https://${regionCode}.console.aws.amazon.com/cloudwatch/home?region=${regionCode}#alarmsV2:alarm/${encodeURIComponent(alarmName)}`
      : null;

  return {
    source: 'cloudwatch',
    // Just the alarm name: the state is its own field and the header line
    // carries the source and account, matching infra-switch's Slack layout.
    title: alarmName,
    severity,
    status: newState,
    fields: buildFields([
      ['Alarm State', newState],
      ['Metric', trigger.MetricName],
      ['Namespace', trigger.Namespace],
      ['Threshold', trigger.Threshold],
      ['AWS Account', message.AWSAccountId],
      ['Region', message.Region],
      ['Changed At', message.StateChangeTime],
    ]),
    description: truncate(
      toDisplayValue(message.NewStateReason ?? message.AlarmDescription),
      MAX_DESCRIPTION_LENGTH,
    ),
    consoleUrl,
    topicArn: envelope.TopicArn,
    region: regionCode,
    accountId: toDisplayValue(message.AWSAccountId) !== 'N/A'
      ? String(message.AWSAccountId)
      : accountId,
    timestamp: typeof message.StateChangeTime === 'string' ? message.StateChangeTime : null,
  };
}

function parsePrometheus(
  message: Record<string, unknown>,
  envelope: SnsEnvelope,
): SnsNormalizedPayload {
  const { region, accountId } = parseSnsTopicArn(envelope.TopicArn);
  const alerts = Array.isArray(message.alerts) ? message.alerts : [];
  const first = isRecord(alerts[0]) ? alerts[0] : {};
  const labels = isRecord(first.labels) ? first.labels : {};
  const annotations = isRecord(first.annotations) ? first.annotations : {};

  const status = String(message.status ?? first.status ?? 'unknown');
  const labelSeverity = String(labels.severity ?? '').toLowerCase();
  const severity: SnsSeverity =
    status === 'resolved'
      ? 'ok'
      : labelSeverity === 'critical'
        ? 'critical'
        : labelSeverity === 'warning'
          ? 'warning'
          : 'info';

  const alertName = toDisplayValue(labels.alertname ?? annotations.summary ?? 'Prometheus alert');
  const alertCount = alerts.length;

  return {
    source: 'prometheus',
    title: alertCount > 1 ? `${alertName} (+${alertCount - 1} more)` : alertName,
    severity,
    status,
    // Curated rows first, then every label the deny-list lets through. The
    // alert name is already the card heading, and instance/job/alert_id are
    // blacklisted, so neither is repeated here.
    fields: buildFields([
      ['Alarm State', status.toUpperCase()],
      ['Severity', labels.severity],
      ['Summary', annotations.summary],
      ['Firing Since', first.startsAt],
      ...passthroughLabels(labels),
    ]),
    description: truncate(toDisplayValue(annotations.description), MAX_DESCRIPTION_LENGTH),
    consoleUrl: typeof first.generatorURL === 'string' ? first.generatorURL : null,
    topicArn: envelope.TopicArn,
    region,
    accountId,
    timestamp: typeof first.startsAt === 'string' ? first.startsAt : null,
  };
}

function parseRds(
  message: Record<string, unknown>,
  envelope: SnsEnvelope,
): SnsNormalizedPayload {
  const { region, accountId } = parseSnsTopicArn(envelope.TopicArn);
  const sourceId = toDisplayValue(message['Source ID']);
  const eventMessage = toDisplayValue(message['Event Message']);
  const identifierLink = message['Identifier Link'];

  return {
    source: 'rds',
    title: `RDS — ${sourceId}`,
    severity: 'info',
    status: 'info',
    fields: buildFields([
      ['Source', message['Source ID']],
      ['Event Source', message['Event Source']],
      ['Event ID', message['Event ID']],
      ['Event Time', message['Event Time']],
      ['Source ARN', message['Source ARN']],
    ]),
    description: truncate(eventMessage, MAX_DESCRIPTION_LENGTH),
    consoleUrl: typeof identifierLink === 'string' ? identifierLink : null,
    topicArn: envelope.TopicArn,
    region,
    accountId: toDisplayValue(message.accountId) !== 'N/A' ? String(message.accountId) : accountId,
    timestamp: typeof message['Event Time'] === 'string' ? message['Event Time'] : null,
  };
}

function parseEventBridge(
  message: Record<string, unknown>,
  envelope: SnsEnvelope,
): SnsNormalizedPayload {
  const { region: topicRegion, accountId: topicAccountId } = parseSnsTopicArn(envelope.TopicArn);
  const detail = isRecord(message.detail) ? message.detail : {};
  const detailType = toDisplayValue(message['detail-type']);
  const eventName = toDisplayValue(detail.eventName ?? detailType);
  const requestParameters = isRecord(detail.requestParameters) ? detail.requestParameters : {};

  return {
    source: 'eventbridge',
    title: `${toDisplayValue(message.source)} — ${eventName}`,
    severity: 'info',
    status: 'info',
    fields: buildFields([
      ['Event', detail.eventName],
      ['Detail Type', message['detail-type']],
      ['Event Source', detail.eventSource ?? message.source],
      ['Region', message.region],
      ['Account', message.account],
      ['Replication Group', requestParameters.replicationGroupId],
      ['Node Group', requestParameters.nodeGroupId],
      ['Event Time', detail.eventTime ?? message.time],
    ]),
    description: null,
    consoleUrl: null,
    topicArn: envelope.TopicArn,
    region: typeof message.region === 'string' ? message.region : topicRegion,
    accountId: typeof message.account === 'string' ? message.account : topicAccountId,
    timestamp:
      typeof message.time === 'string'
        ? message.time
        : typeof detail.eventTime === 'string'
          ? detail.eventTime
          : null,
  };
}

function parseGeneric(
  message: Record<string, unknown> | null,
  rawMessage: string,
  envelope: SnsEnvelope,
): SnsNormalizedPayload {
  const { region, accountId } = parseSnsTopicArn(envelope.TopicArn);
  const subject = typeof envelope.Subject === 'string' ? envelope.Subject.trim() : '';

  // Structured but unrecognised → surface the top-level keys as fields, but only
  // the scalar ones. Nested objects and arrays (CloudWatch's Trigger, OKActions,
  // AlarmActions …) stringify into unreadable JSON blobs that swamp the card, so
  // they are dropped rather than dumped.
  const fields = message
    ? buildFields(Object.entries(message).filter(([, value]) => isScalar(value)))
    : buildFields([['Topic', envelope.TopicArn]]);

  return {
    source: 'generic',
    title: subject || 'Amazon SNS notification',
    severity: 'info',
    status: 'info',
    fields,
    description: message ? null : truncate(rawMessage.trim(), MAX_DESCRIPTION_LENGTH) || null,
    consoleUrl: null,
    topicArn: envelope.TopicArn,
    region,
    accountId,
    timestamp: typeof envelope.Timestamp === 'string' ? envelope.Timestamp : null,
  };
}

/**
 * Parse the inner `Message` payload and normalise it.
 *
 * Never returns null and never throws — an unrecognised or non-JSON message
 * degrades to a `generic` card. Discrimination is structural and order matters,
 * mirroring infra-switch `src/AlertProxy/Types/API/Common.hs:54-66`.
 */
export function parseSnsMessage(envelope: SnsEnvelope): SnsNormalizedPayload {
  let message: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(envelope.Message);
    message = isRecord(parsed) ? parsed : null;
  } catch {
    message = null;
  }

  if (!message) {
    return parseGeneric(null, envelope.Message, envelope);
  }

  if (message.AlarmName !== undefined && message.NewStateValue !== undefined) {
    return parseCloudWatch(message, envelope);
  }
  if (Array.isArray(message.alerts)) {
    return parsePrometheus(message, envelope);
  }
  // RDS event-subscription payloads use keys containing spaces.
  if (message['Event Source'] !== undefined) {
    return parseRds(message, envelope);
  }
  if (message['detail-type'] !== undefined && message.detail !== undefined) {
    return parseEventBridge(message, envelope);
  }

  return parseGeneric(message, envelope.Message, envelope);
}

// ============================================================================
// FLOW BUILDERS
// ============================================================================

/**
 * Leading text of the header line, per source. infra-switch renders
 * `<Source> Alert | <name> | <account>` as a single hyperlink
 * (`src/AlertProxy/Utils/Common.hs:317`).
 */
const SOURCE_HEADER: Record<SnsAlertSource, string> = {
  cloudwatch: 'Cloudwatch Alarm',
  prometheus: 'Metrics Alert',
  rds: 'RDS Event',
  eventbridge: 'EventBridge Event',
  generic: 'SNS Notification',
};

/**
 * `Cloudwatch Alarm | 5XX Warning | 123456789012::ap-south-1`, the account and
 * region omitted when the ARN did not carry them.
 */
function buildHeaderLabel(payload: SnsNormalizedPayload): string {
  const account = [payload.accountId, payload.region].filter(Boolean).join('::');
  return [`🚨 ${SOURCE_HEADER[payload.source]}`, payload.title, account]
    .filter(Boolean)
    .join(' | ');
}

export function buildAmazonSnsFlow(payload: SnsNormalizedPayload): FlowDefinition {
  const headerLabel = buildHeaderLabel(payload);

  // The header doubles as the link to the source, as it does in infra-switch's
  // Slack card. `link.props.href` is validated with z.string().url(), so fall
  // back to a plain heading when there is no usable URL.
  const header: FlowComponent = isHttpUrl(payload.consoleUrl)
    ? {
        id: 'sns-header',
        type: 'link',
        props: { href: payload.consoleUrl, label: headerLabel, external: true },
      }
    : { id: 'sns-header', type: 'heading', props: { content: headerLabel, level: 3 } };

  const children: FlowComponent[] = [header];

  // Description sits directly under the header, above the field grid.
  if (payload.description) {
    children.push({
      id: 'sns-description',
      type: 'text',
      props: { content: payload.description, variant: 'muted' },
    });
  }

  if (payload.fields.length > 0) {
    children.push(fieldsToGrid(payload.fields, 'sns'));
  }

  return {
    version: '2.0',
    screenId: `sns-${payload.source}-${Date.now()}`,
    title: payload.title,
    components: [
      {
        id: 'sns-card',
        type: 'card',
        children: [withColorStripe('sns-stripe', children, SEVERITY_STRIPE[payload.severity])],
      },
    ],
    state: emptyFlowState(),
  };
}

/**
 * SNS delivers nothing until the SubscribeURL is visited. We post the link into
 * the channel and let a human click it rather than issuing the request
 * server-side, which keeps an attacker-supplied URL from becoming an SSRF
 * vector. The signature check upstream is what makes the posted link
 * trustworthy.
 */
export function buildSubscriptionConfirmationFlow(envelope: SnsEnvelope): FlowDefinition {
  const children: FlowComponent[] = [
    {
      id: 'sns-confirm-title',
      type: 'heading',
      props: { content: 'Amazon SNS subscription pending', level: 3 },
    },
    {
      id: 'sns-confirm-body',
      type: 'text',
      props: {
        // Render what SNS actually sent. Its own wording already tells the reader
        // to visit the SubscribeURL, which is the link rendered below.
        content: envelope.Message
          ? truncate(envelope.Message, MAX_DESCRIPTION_LENGTH)
          : 'A topic asked to deliver alerts to this channel. Alerts will not arrive until an admin confirms the subscription.',
      },
    },
    fieldsToGrid([['Topic', envelope.TopicArn]], 'sns'),
  ];

  if (isHttpUrl(envelope.SubscribeURL ?? null)) {
    const subscribeUrl = envelope.SubscribeURL;

    // Two buttons side by side: copy is handled entirely in the browser, while
    // confirm submits SNS_CONFIRM_ACTION_ID, handled in incomingWebhookController.
    children.push({
      id: 'sns-confirm-actions',
      type: 'row',
      style: { gap: '8px' },
      children: [
        {
          id: 'sns-confirm-submit',
          type: 'button',
          props: {
            label: 'Do Confirmation',
            variant: 'primary',
            action: {
              type: 'submit',
              actionId: SNS_CONFIRM_ACTION_ID,
              successMessage: 'Subscription confirmed',
              errorMessage: 'Could not confirm the subscription',
            },
          },
        },
        {
          id: 'sns-confirm-copy',
          type: 'button',
          props: {
            label: 'Copy Subscribe URL',
            variant: 'secondary',
            action: {
              type: 'copy',
              value: subscribeUrl,
              successMessage: 'Subscribe URL copied',
            },
          },
        },
      ],
    });
  } else {
    children.push({
      id: 'sns-confirm-missing',
      type: 'text',
      props: { content: 'No SubscribeURL was present in the request.', variant: 'warning' },
    });
  }

  return {
    version: '2.0',
    screenId: `sns-subscription-${Date.now()}`,
    title: 'Amazon SNS subscription pending',
    // Amber: nothing is broken, but a human has to act before alerts arrive.
    components: [
      {
        id: 'sns-confirm-card',
        type: 'card',
        children: [withColorStripe('sns-confirm-stripe', children, SEVERITY_STRIPE.warning)],
      },
    ],
    // The submit action posts state.values back, which is how the SubscribeURL
    // reaches the confirm handler without a second lookup.
    state: {
      ...emptyFlowState(),
      values: { subscribeUrl: envelope.SubscribeURL ?? '' },
    },
  };
}

export function buildUnsubscribeConfirmationFlow(envelope: SnsEnvelope): FlowDefinition {
  return {
    version: '2.0',
    screenId: `sns-unsubscribe-${Date.now()}`,
    title: 'Amazon SNS subscription removed',
    components: [
      {
        id: 'sns-unsub-card',
        type: 'card',
        children: [
          withColorStripe(
            'sns-unsub-stripe',
            [
              {
                id: 'sns-unsub-title',
                type: 'heading',
                props: { content: 'Amazon SNS subscription removed', level: 3 },
              },
              {
                id: 'sns-unsub-body',
                type: 'text',
                props: {
                  content: envelope.Message
                    ? truncate(envelope.Message, MAX_DESCRIPTION_LENGTH)
                    : 'This channel will no longer receive alerts from the topic below.',
                  variant: 'warning',
                },
              },
              fieldsToGrid([['Topic', envelope.TopicArn]], 'sns'),
            ],
            SEVERITY_STRIPE.info,
          ),
        ],
      },
    ],
    state: emptyFlowState(),
  };
}
