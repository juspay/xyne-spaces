import type { FlowComponent, FlowState } from '@xyne/shared';

/**
 * Helpers shared by the alert incoming-webhook parsers (Amazon SNS, Pingdom,
 * GCP Cloud Monitoring).
 *
 * Each provider owns its payload types and field mapping; everything here is
 * provider-agnostic — value coercion, the label deny-list, and the card
 * primitives that make the three sources render identically in a channel.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'ok';

export const MAX_FIELDS = 16;
export const MAX_FIELD_VALUE_LENGTH = 400;
export const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Labels that add noise rather than signal in a chat card.
 *
 * Ported from infra-switch's `BLACKLISTED_VM_LABELS`
 * (`src/InfraSwitch/Config.hs:274`), including its default list, and overridable
 * through the environment the same way.
 */
export const DEFAULT_BLACKLISTED_LABELS =
  'uuid,node,instance,job,metrics_path,prometheus,prometheus_replica,severity,' +
  'endpoint,alert_id,alert,alertgroup,alertname,user,older_receiver';

export function emptyFlowState(): FlowState {
  return {
    values: {},
    touched: {},
    errors: {},
    submitting: false,
    submitted: false,
    history: [],
    loadingComponentIds: [],
  };
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Coerce an arbitrary JSON value into a single-line display string. */
export function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  if (typeof value === 'string') {
    return truncate(value.trim() || 'N/A', MAX_FIELD_VALUE_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return truncate(JSON.stringify(value), MAX_FIELD_VALUE_LENGTH);
  } catch {
    return 'N/A';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value that renders as a readable single line rather than a JSON blob. */
export function isScalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Drop empty/placeholder entries and cap the table length. */
export function buildFields(entries: Array<[string, unknown]>): Array<[string, string]> {
  return entries
    .map(([label, value]) => [label, toDisplayValue(value)] as [string, string])
    .filter(([, value]) => value !== 'N/A' && value !== '')
    .slice(0, MAX_FIELDS);
}

export function blacklistedLabels(): Set<string> {
  // Deliberately `||`, not `??`: an unset var and the empty value that ships in
  // .env.example must both fall back to the default rather than disable the list.
  // ALERT_BLACKLISTED_LABELS covers every alert webhook type; SNS_BLACKLISTED_LABELS
  // is kept as a fallback so existing deployments keep their configured list.
  const raw =
    process.env.ALERT_BLACKLISTED_LABELS?.trim() ||
    process.env.SNS_BLACKLISTED_LABELS?.trim() ||
    DEFAULT_BLACKLISTED_LABELS;
  return new Set(
    raw
      .split(',')
      .map(label => label.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Every label that is not blacklisted, keyed uppercase.
 *
 * infra-switch renders the label bag as a deny-list rather than an allow-list
 * (`convertLabelsToSlackBlock`, `src/AlertProxy/Utils/Common.hs:477-482`), so
 * team-specific labels reach the card instead of being silently dropped.
 */
export function passthroughLabels(labels: Record<string, unknown>): Array<[string, unknown]> {
  const blacklist = blacklistedLabels();
  return Object.entries(labels)
    .filter(([key]) => !blacklist.has(key.toLowerCase()))
    .map(([key, value]) => [key.toUpperCase(), value] as [string, unknown]);
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Left-edge stripe colour per severity.
 *
 * infra-switch drives this off `SlackAttachment.color`
 * (`src/AlertProxy/Utils/Common.hs:447-449`): green when the alert state maps to
 * OK/RESOLVED/UP, red otherwise. The warning and info shades come from Slack's
 * named palette as resolved in `slackBlockKitToFlowJSON.ts:449-454`, so alerts
 * arriving straight from a provider match ones relayed through infra-switch.
 */
export const SEVERITY_STRIPE: Record<AlertSeverity, string> = {
  critical: '#d91009',
  warning: '#ECB22E',
  ok: '#04ba1c',
  info: '#d1d5db',
};

/**
 * Wrap card content in the Slack-style coloured left border.
 * Mirrors `withColorStripe` (`slackBlockKitToFlowJSON.ts:482-489`).
 */
export function withColorStripe(
  id: string,
  children: FlowComponent[],
  color: string,
): FlowComponent {
  return {
    id,
    type: 'column',
    style: { borderLeft: `4px solid ${color}`, padding: '2px 0 2px 10px' },
    children,
  };
}

/**
 * Lay fields out as a 2-column grid that wraps onto new rows, the way Slack
 * renders `section.fields`. Mirrors `fieldsToGrid`
 * (`slackBlockKitToFlowJSON.ts:497-509`) — a grid rather than a label/value
 * table, so the render paths agree.
 *
 * `idPrefix` namespaces the generated component ids per provider (`sns`,
 * `pingdom`, `gcp`), since flow component ids must be unique within a screen.
 */
export function fieldsToGrid(
  fields: Array<[string, string]>,
  idPrefix: string,
  columns = 2,
): FlowComponent {
  const rows: FlowComponent[] = [];

  for (let i = 0; i < fields.length; i += columns) {
    const cells: FlowComponent[] = fields.slice(i, i + columns).map(([label, value], cell) => ({
      id: `${idPrefix}-field-${i + cell}`,
      type: 'column',
      children: [
        {
          id: `${idPrefix}-field-${i + cell}-label`,
          type: 'text',
          props: { content: label, bold: true },
        },
        { id: `${idPrefix}-field-${i + cell}-value`, type: 'text', props: { content: value } },
      ],
    }));
    rows.push({ id: `${idPrefix}-field-row-${i / columns}`, type: 'row', children: cells });
  }

  return rows.length === 1
    ? rows[0]
    : { id: `${idPrefix}-fields`, type: 'column', children: rows };
}
