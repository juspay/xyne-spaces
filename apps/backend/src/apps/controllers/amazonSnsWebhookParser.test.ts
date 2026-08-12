// Imported by path rather than from the '@xyne/shared' barrel: the published
// package is ESM-only, which Jest's CJS runtime cannot load, and its barrel
// re-exports the very large zero schema. flowSchema itself only needs zod.
import { validateFlowDefinition } from '../../../../../packages/shared/src/validation/flowSchema';
import {
  buildAmazonSnsFlow,
  buildSubscriptionConfirmationFlow,
  buildUnsubscribeConfirmationFlow,
  parseSnsEnvelope,
  parseSnsMessage,
  parseSnsTopicArn,
} from './amazonSnsWebhookParser';

/**
 * Envelopes below are real captures taken from infra-switch
 * `sample/alert-proxy/*.json` (signatures truncated), so the shapes match what
 * SNS actually delivers — including the JSON-string `Message` field and the
 * RDS keys that contain spaces.
 */

const TOPIC_ARN = 'arn:aws:sns:ap-south-1:225681119357:test-topic';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    Type: 'Notification',
    MessageId: 'b0cc3e0a-7086-583d-b02d-63a23f8d4a78',
    TopicArn: TOPIC_ARN,
    Timestamp: '2023-10-17T08:58:51.439Z',
    SignatureVersion: '1',
    Signature: 'EXAMPLE_SIGNATURE',
    SigningCertURL:
      'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-01d088a6.pem',
    Message: '{}',
    ...overrides,
  };
}

const CLOUDWATCH_MESSAGE = JSON.stringify({
  AlarmName: 'Test Alert',
  AlarmDescription: null,
  AWSAccountId: '225681119357',
  NewStateValue: 'ALARM',
  NewStateReason:
    'Threshold Crossed: 1 out of the last 1 datapoints [56.31 (17/10/23 08:56:00)] was greater than the threshold (20.0).',
  StateChangeTime: '2023-10-17T08:58:51.402+0000',
  Region: 'Asia Pacific (Mumbai)',
  AlarmArn: 'arn:aws:cloudwatch:ap-south-1:225681119357:alarm:Test Alert',
  OldStateValue: 'INSUFFICIENT_DATA',
  Trigger: {
    MetricName: 'CPUUtilization',
    Namespace: 'AWS/RDS',
    Threshold: 20.0,
  },
});

const PROMETHEUS_MESSAGE = JSON.stringify({
  receiver: 'slack_alerts',
  status: 'firing',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'VictoriaMetricsDiskUsageWarning',
        alert_id: '8f313708-db11-40d0-9e7e-b2302a01cf2d',
        namespace: 'monitoring',
        instance: '10.6.34.213:10250',
        job: 'kubelet',
        severity: 'warning',
        // Present in the real payload, and the kind of label the deny-list must
        // let through — the parser has no special knowledge of it.
        persistentvolumeclaim: 'server-volume-k8s-victoria-metrics-single-server-0',
        service: 'kubelet',
      },
      annotations: {
        description: 'Disk Usage is 96.77% for server-volume-0 in monitoring',
        summary: 'High Disk Utilization',
      },
      startsAt: '2023-10-31 11:19:48.981359198 +0000 UTC',
      generatorURL: 'http://vmalert-k8s-6df76896bb-chr2g:8080/api/v1/status',
    },
  ],
});

const RDS_MESSAGE = JSON.stringify({
  'Event Source': 'db-instance',
  'Event Time': '2026-04-29T11:51:50Z',
  'Identifier Link':
    'https://console.aws.amazon.com/rds/home?region=ap-south-1#database:id=my-db-instance',
  'Source ID': 'my-db-instance',
  'Source ARN': 'arn:aws:rds:ap-south-1:980691203742:db:my-db-instance',
  'Event ID': 'RDS-EVENT-0043',
  'Event Message': 'DB instance failover completed',
});

const EVENTBRIDGE_MESSAGE = JSON.stringify({
  version: '0',
  id: 'cab4a1a2-009c-7b2b-e172-a6743f182cee',
  'detail-type': 'AWS API Call via CloudTrail',
  source: 'aws.elasticache',
  account: '99999999999',
  time: '2026-04-29T10:59:50Z',
  region: 'ap-south-1',
  detail: {
    eventSource: 'elasticache.amazonaws.com',
    eventName: 'TestFailover',
    eventTime: '2026-04-29T10:59:50Z',
    requestParameters: { replicationGroupId: 'ec-failover-sim', nodeGroupId: '0001' },
  },
});

const SUBSCRIPTION_CONFIRMATION = {
  Type: 'SubscriptionConfirmation',
  MessageId: '60af0ad9-6e71-4554-bb0b-8d1391d0e828',
  Token: '2336412f37fb687f5d51e6e2425c464cefc60321',
  TopicArn: TOPIC_ARN,
  Message:
    'You have chosen to subscribe to the topic arn:aws:sns:ap-south-1:225681119357:test-topic.',
  SubscribeURL:
    'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aap-south-1%3A225681119357%3Atest-topic&Token=2336412f',
  Timestamp: '2023-10-17T08:38:43.613Z',
  SignatureVersion: '1',
  Signature: 'EXAMPLE_SIGNATURE',
  SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-01d088a6.pem',
};

describe('parseSnsEnvelope', () => {
  it('accepts each of the three SNS message types', () => {
    for (const type of ['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']) {
      expect(parseSnsEnvelope(envelope({ Type: type }))).not.toBeNull();
    }
  });

  it('rejects payloads that are not SNS envelopes', () => {
    expect(parseSnsEnvelope(null)).toBeNull();
    expect(parseSnsEnvelope('a string')).toBeNull();
    expect(parseSnsEnvelope([])).toBeNull();
    expect(parseSnsEnvelope({})).toBeNull();
    // A SentinelOne payload posted to the SNS route.
    expect(parseSnsEnvelope({ threatInfo: {}, agentDetectionInfo: {} })).toBeNull();
  });

  it('rejects an unknown Type and a non-string Message', () => {
    expect(parseSnsEnvelope(envelope({ Type: 'SomethingElse' }))).toBeNull();
    expect(parseSnsEnvelope(envelope({ Message: { nested: true } }))).toBeNull();
  });
});

describe('parseSnsTopicArn', () => {
  it('splits region and account out of a topic ARN', () => {
    expect(parseSnsTopicArn(TOPIC_ARN)).toEqual({
      region: 'ap-south-1',
      accountId: '225681119357',
    });
  });

  it('returns nulls for a malformed ARN', () => {
    expect(parseSnsTopicArn('not-an-arn')).toEqual({ region: null, accountId: null });
    expect(parseSnsTopicArn('')).toEqual({ region: null, accountId: null });
  });
});

describe('parseSnsMessage dispatch', () => {
  it('routes a CloudWatch alarm', () => {
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: CLOUDWATCH_MESSAGE }))!);

    expect(parsed.source).toBe('cloudwatch');
    expect(parsed.severity).toBe('critical');
    // Bare alarm name: the state is its own field and the header line carries
    // the source and account, matching infra-switch's Slack card.
    expect(parsed.title).toBe('Test Alert');
    expect(parsed.status).toBe('ALARM');
    expect(parsed.fields).toContainEqual(['Alarm State', 'ALARM']);
    expect(parsed.description).toContain('Threshold Crossed');
    // Region code comes from the ARN, not the human-readable `Region` field.
    expect(parsed.region).toBe('ap-south-1');
    expect(parsed.consoleUrl).toBe(
      'https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#alarmsV2:alarm/Test%20Alert',
    );
    expect(parsed.fields).toContainEqual(['Metric', 'CPUUtilization']);
  });

  it('maps CloudWatch states onto severities', () => {
    const severityFor = (state: string) =>
      parseSnsMessage(
        parseSnsEnvelope(
          envelope({
            Message: JSON.stringify({ AlarmName: 'a', NewStateValue: state, OldStateValue: 'OK' }),
          }),
        )!,
      ).severity;

    expect(severityFor('ALARM')).toBe('critical');
    expect(severityFor('OK')).toBe('ok');
    expect(severityFor('INSUFFICIENT_DATA')).toBe('warning');
  });

  it('routes a Prometheus / VictoriaMetrics alerts[] payload', () => {
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: PROMETHEUS_MESSAGE }))!);

    expect(parsed.source).toBe('prometheus');
    expect(parsed.severity).toBe('warning');
    expect(parsed.status).toBe('firing');
    expect(parsed.title).toBe('VictoriaMetricsDiskUsageWarning');
    expect(parsed.description).toContain('Disk Usage is 96.77%');
    expect(parsed.fields).toContainEqual(['Alarm State', 'FIRING']);
  });

  /**
   * Labels are rendered as a deny-list, matching infra-switch's
   * `convertLabelsToSlackBlock` — noise is suppressed and anything else, including
   * labels this parser has never heard of, still reaches the card.
   */
  it('passes non-blacklisted labels through and suppresses the noisy ones', () => {
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: PROMETHEUS_MESSAGE }))!);
    const labels = parsed.fields.map(([label]) => label);

    expect(labels).toContain('NAMESPACE');
    expect(labels).toContain('PERSISTENTVOLUMECLAIM');

    // On infra-switch's default BLACKLISTED_VM_LABELS.
    expect(labels).not.toContain('ALERT_ID');
    expect(labels).not.toContain('INSTANCE');
    expect(labels).not.toContain('JOB');
    expect(labels).not.toContain('ALERTNAME');
  });

  it('falls back to the default list when the override is blank', () => {
    const original = process.env.SNS_BLACKLISTED_LABELS;
    // The value .env.example ships. It must not disable the blacklist.
    process.env.SNS_BLACKLISTED_LABELS = '';

    try {
      const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: PROMETHEUS_MESSAGE }))!);
      const labels = parsed.fields.map(([label]) => label);

      expect(labels).not.toContain('ALERT_ID');
      expect(labels).toContain('NAMESPACE');
    } finally {
      if (original === undefined) delete process.env.SNS_BLACKLISTED_LABELS;
      else process.env.SNS_BLACKLISTED_LABELS = original;
    }
  });

  it('honours a SNS_BLACKLISTED_LABELS override', () => {
    const original = process.env.SNS_BLACKLISTED_LABELS;
    process.env.SNS_BLACKLISTED_LABELS = 'namespace';

    try {
      const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: PROMETHEUS_MESSAGE }))!);
      const labels = parsed.fields.map(([label]) => label);

      expect(labels).not.toContain('NAMESPACE');
      // No longer blacklisted once the default list is replaced.
      expect(labels).toContain('ALERT_ID');
    } finally {
      if (original === undefined) delete process.env.SNS_BLACKLISTED_LABELS;
      else process.env.SNS_BLACKLISTED_LABELS = original;
    }
  });

  it('treats a resolved Prometheus alert as ok', () => {
    const resolved = JSON.stringify({
      status: 'resolved',
      alerts: [{ status: 'resolved', labels: { alertname: 'X', severity: 'critical' } }],
    });
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: resolved }))!);

    expect(parsed.severity).toBe('ok');
    expect(parsed.status).toBe('resolved');
  });

  it('routes an RDS event subscription, whose keys contain spaces', () => {
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: RDS_MESSAGE }))!);

    expect(parsed.source).toBe('rds');
    expect(parsed.title).toBe('RDS — my-db-instance');
    expect(parsed.description).toBe('DB instance failover completed');
    expect(parsed.consoleUrl).toContain('console.aws.amazon.com/rds');
    expect(parsed.fields).toContainEqual(['Event ID', 'RDS-EVENT-0043']);
  });

  it('routes an EventBridge CloudTrail envelope', () => {
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: EVENTBRIDGE_MESSAGE }))!);

    expect(parsed.source).toBe('eventbridge');
    expect(parsed.title).toBe('aws.elasticache — TestFailover');
    expect(parsed.region).toBe('ap-south-1');
    expect(parsed.fields).toContainEqual(['Replication Group', 'ec-failover-sim']);
  });

  it('falls back to generic for a plain-text Message', () => {
    const parsed = parseSnsMessage(
      parseSnsEnvelope(envelope({ Message: 'Hello world!', Subject: 'My First Message' }))!,
    );

    expect(parsed.source).toBe('generic');
    expect(parsed.title).toBe('My First Message');
    expect(parsed.description).toBe('Hello world!');
  });

  it('falls back to generic for structured but unrecognised JSON', () => {
    const parsed = parseSnsMessage(
      parseSnsEnvelope(envelope({ Message: JSON.stringify({ somethingNew: 'value' }) }))!,
    );

    expect(parsed.source).toBe('generic');
    expect(parsed.fields).toContainEqual(['somethingNew', 'value']);
  });

  it('never throws on hostile or degenerate messages', () => {
    const messages = ['', '   ', 'null', '[]', '{', '"just a string"', '{"alerts":[]}', '0'];

    for (const message of messages) {
      expect(() => parseSnsMessage(parseSnsEnvelope(envelope({ Message: message }))!)).not.toThrow();
    }
  });
});

describe('flow builders produce valid FlowDefinitions', () => {
  const messages = [
    ['cloudwatch', CLOUDWATCH_MESSAGE],
    ['prometheus', PROMETHEUS_MESSAGE],
    ['rds', RDS_MESSAGE],
    ['eventbridge', EVENTBRIDGE_MESSAGE],
    ['generic text', 'Hello world!'],
    ['generic json', JSON.stringify({ somethingNew: 'value' })],
    ['empty', ''],
  ] as const;

  it.each(messages)('validates the flow built from a %s message', (_label, message) => {
    const flow = buildAmazonSnsFlow(parseSnsMessage(parseSnsEnvelope(envelope({ Message: message }))!));
    const result = validateFlowDefinition(flow);

    expect(result.success).toBe(true);
  });

  it('validates the subscription confirmation flow', () => {
    const parsed = parseSnsEnvelope(SUBSCRIPTION_CONFIRMATION)!;
    const result = validateFlowDefinition(buildSubscriptionConfirmationFlow(parsed));

    expect(result.success).toBe(true);
  });

  it('still validates when SubscribeURL is missing', () => {
    const parsed = parseSnsEnvelope({ ...SUBSCRIPTION_CONFIRMATION, SubscribeURL: undefined })!;
    const result = validateFlowDefinition(buildSubscriptionConfirmationFlow(parsed));

    expect(result.success).toBe(true);
  });

  it('validates the unsubscribe confirmation flow', () => {
    const parsed = parseSnsEnvelope(
      envelope({ Type: 'UnsubscribeConfirmation', Message: 'You have been unsubscribed.' }),
    )!;
    const result = validateFlowDefinition(buildUnsubscribeConfirmationFlow(parsed));

    expect(result.success).toBe(true);
  });

  it('omits the link component when the source URL is not a real URL', () => {
    const parsed = parseSnsMessage(parseSnsEnvelope(envelope({ Message: RDS_MESSAGE }))!);
    const flow = buildAmazonSnsFlow({ ...parsed, consoleUrl: 'not-a-url' });

    const card = flow.components[0]!;
    expect(card.children?.some(child => child.type === 'link')).toBe(false);
    expect(validateFlowDefinition(flow).success).toBe(true);
  });
});
