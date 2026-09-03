import { buildGcpFlow, mergeGcpLabels, normalizeGcp, parseGcpPayload } from './gcpWebhookParser';
import type { GcpIncident, GcpPayload } from './gcpWebhookParser';
import { SEVERITY_STRIPE } from './alertWebhookShared';

const OPEN_INCIDENT: GcpPayload = {
  version: '1.2',
  incident: {
    incident_id: '0.abcd1234efgh',
    scoping_project_id: 'my-proj',
    scoping_project_number: 123456789012,
    url: 'https://console.cloud.google.com/monitoring/alerting/incidents/0.abcd1234efgh',
    state: 'open',
    started_at: 1698043056,
    policy_name: 'High CPU',
    policy_user_labels: { team: 'infra', alert_id: 'c604216c-c099-42be-acbb-cb3efd56d148' },
    condition_name: 'CPU utilization above threshold',
    summary: 'CPU for instance-1 is above 0.8 with a value of 0.95',
    documentation: { content: 'Runbook: restart the instance', mime_type: 'text/markdown' },
    metric: {
      type: 'compute.googleapis.com/instance/cpu/utilization',
      displayName: 'CPU utilization',
      labels: { team: 'metric-team', instance_name: 'instance-1' },
    },
    resource: {
      type: 'gce_instance',
      labels: { team: 'resource-team', zone: 'asia-south1-a' },
    },
    metadata: { user_labels: { team: 'metadata-team', env: 'prod' } },
    observed_value: '0.95',
  },
};

const CLOSED_INCIDENT: GcpPayload = {
  ...OPEN_INCIDENT,
  incident: { ...OPEN_INCIDENT.incident, state: 'closed', ended_at: 1698046656 },
};

function fieldMap(fields: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(fields);
}

describe('parseGcpPayload', () => {
  it('accepts a full incident', () => {
    expect(parseGcpPayload(OPEN_INCIDENT)).not.toBeNull();
  });

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['a bare string', 'open'],
    ['a payload with no incident', { version: '1.2' }],
    [
      'an incident missing state',
      { incident: { policy_name: 'p', condition_name: 'c' } },
    ],
    [
      'an incident missing policy_name',
      { incident: { state: 'open', condition_name: 'c' } },
    ],
    [
      'an incident missing condition_name',
      { incident: { state: 'open', policy_name: 'p' } },
    ],
  ])('rejects %s', (_label, input) => {
    expect(parseGcpPayload(input)).toBeNull();
  });
});

describe('mergeGcpLabels', () => {
  it('applies infra-switch label precedence on collision', () => {
    const labels = mergeGcpLabels(OPEN_INCIDENT.incident);

    // policy_user_labels > resource.labels > metadata.user_labels > metric.labels
    expect(labels.team).toBe('infra');
    expect(labels.zone).toBe('asia-south1-a');
    expect(labels.env).toBe('prod');
    expect(labels.instance_name).toBe('instance-1');
  });

  it('falls back through the bags when the winner is absent', () => {
    const incident: GcpIncident = {
      ...OPEN_INCIDENT.incident,
      policy_user_labels: undefined,
    };

    expect(mergeGcpLabels(incident).team).toBe('resource-team');
  });

  it('returns an empty bag when the incident carries no labels', () => {
    expect(
      mergeGcpLabels({ state: 'open', policy_name: 'p', condition_name: 'c' }),
    ).toEqual({});
  });

  it('drops non-string label values rather than stringifying them', () => {
    const labels = mergeGcpLabels({
      state: 'open',
      policy_name: 'p',
      condition_name: 'c',
      resource: { labels: { ok: 'yes', bad: 42 as unknown as string } },
    });

    expect(labels).toEqual({ ok: 'yes' });
  });
});

describe('normalizeGcp', () => {
  it('maps an open incident to FIRING with epoch timestamps converted', () => {
    const payload = normalizeGcp(OPEN_INCIDENT);

    expect(payload.status).toBe('FIRING');
    expect(payload.severity).toBe('critical');
    expect(payload.title).toBe('High CPU');
    expect(payload.projectId).toBe('my-proj');
    expect(payload.incidentId).toBe('0.abcd1234efgh');
    expect(payload.timestamp).toBe('2023-10-23T06:37:36.000Z');

    const fields = fieldMap(payload.fields);
    expect(fields['Alarm State']).toBe('FIRING');
    expect(fields['Condition']).toBe('CPU utilization above threshold');
    expect(fields['Resource']).toBe('gce_instance');
    expect(fields['Metric']).toBe('CPU utilization');
    expect(fields['Observed Value']).toBe('0.95');
    expect(fields['Started At']).toBe('2023-10-23T06:37:36.000Z');
    // Merged labels reach the card with policy_user_labels winning...
    expect(fields['TEAM']).toBe('infra');
    // ...and the shared deny-list still suppresses alert_id.
    expect(fields).not.toHaveProperty('ALERT_ID');
  });

  it('maps a closed incident to RESOLVED and prefers ended_at for the timestamp', () => {
    const payload = normalizeGcp(CLOSED_INCIDENT);

    expect(payload.status).toBe('RESOLVED');
    expect(payload.severity).toBe('ok');
    expect(payload.timestamp).toBe('2023-10-23T07:37:36.000Z');
    expect(fieldMap(payload.fields)['Ended At']).toBe('2023-10-23T07:37:36.000Z');
  });

  it('prefers summary over documentation.content for the description', () => {
    expect(normalizeGcp(OPEN_INCIDENT).description).toBe(
      'CPU for instance-1 is above 0.8 with a value of 0.95',
    );
  });

  it('falls back to documentation.content when there is no summary', () => {
    const payload = normalizeGcp({
      incident: { ...OPEN_INCIDENT.incident, summary: undefined },
    });

    expect(payload.description).toBe('Runbook: restart the instance');
  });

  it('leaves the description null when neither is present', () => {
    const payload = normalizeGcp({
      incident: { ...OPEN_INCIDENT.incident, summary: undefined, documentation: undefined },
    });

    expect(payload.description).toBeNull();
  });

  it.each([
    ['CRITICAL', 'critical'],
    ['ERROR', 'critical'],
    ['WARNING', 'warning'],
    ['INFO', 'info'],
  ])('maps incident severity %s to %s', (raw, expected) => {
    const payload = normalizeGcp({
      incident: { ...OPEN_INCIDENT.incident, severity: raw },
    });

    expect(payload.severity).toBe(expected);
  });

  it('falls back to the severity user label when the incident has no severity', () => {
    const payload = normalizeGcp({
      incident: {
        ...OPEN_INCIDENT.incident,
        policy_user_labels: { severity: 'WARNING' },
      },
    });

    expect(payload.severity).toBe('warning');
  });

  it('ignores payload severity entirely once the incident has closed', () => {
    const payload = normalizeGcp({
      incident: { ...CLOSED_INCIDENT.incident, severity: 'CRITICAL' },
    });

    expect(payload.severity).toBe('ok');
  });

  it('drops a zero ended_at rather than rendering the epoch', () => {
    const payload = normalizeGcp({
      incident: { ...OPEN_INCIDENT.incident, ended_at: 0 },
    });

    expect(fieldMap(payload.fields)).not.toHaveProperty('Ended At');
    expect(payload.timestamp).toBe('2023-10-23T06:37:36.000Z');
  });
});

describe('buildGcpFlow', () => {
  it('renders a red-striped card headed by a link to the console', () => {
    const flow = buildGcpFlow(normalizeGcp(OPEN_INCIDENT));

    expect(flow.version).toBe('2.0');
    expect(flow.title).toBe('High CPU');

    const stripe = flow.components[0].children?.[0];
    expect(stripe?.style?.borderLeft).toBe(`4px solid ${SEVERITY_STRIPE.critical}`);

    const header = stripe?.children?.[0];
    expect(header?.type).toBe('link');
    expect(header?.props?.label).toBe('🚨 GCP Alert | High CPU | my-proj');
    expect(header?.props?.href).toBe(OPEN_INCIDENT.incident.url);
  });

  it('renders a green stripe once the incident closes', () => {
    const flow = buildGcpFlow(normalizeGcp(CLOSED_INCIDENT));

    expect(flow.components[0].children?.[0]?.style?.borderLeft).toBe(
      `4px solid ${SEVERITY_STRIPE.ok}`,
    );
  });

  it('falls back to a heading when the incident carries no console url', () => {
    const flow = buildGcpFlow(
      normalizeGcp({
        incident: { ...OPEN_INCIDENT.incident, url: undefined, scoping_project_id: undefined },
      }),
    );
    const header = flow.components[0].children?.[0]?.children?.[0];

    expect(header?.type).toBe('heading');
    expect(header?.props?.content).toBe('🚨 GCP Alert | High CPU');
  });
});
