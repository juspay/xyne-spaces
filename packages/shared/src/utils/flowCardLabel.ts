export interface FlowCardLike {
  title?: unknown;
  data?: unknown;
  components?: unknown;
}

interface CardComponent {
  type?: unknown;
  props?: Record<string, unknown>;
}

export const GENERIC_FLOW_CARD_LABEL = 'Shared a card';

export function decodeFlowJsonAttribute(content: string): FlowCardLike | null {
  const attrMatch = content.match(/data-flow-json="([^"]+)"/);
  if (!attrMatch?.[1]) return null;
  try {
    const json = attrMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, '\n')
      .replace(/&#13;/g, '\r')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as FlowCardLike) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}

function findComponent(flow: FlowCardLike, type: string): CardComponent | undefined {
  const components = Array.isArray(flow.components) ? (flow.components as unknown[]) : [];
  const queue = [...components];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== 'object') continue;
    const component = next as CardComponent & { children?: unknown };
    if (component.type === type) return component;
    if (Array.isArray(component.children)) queue.push(...(component.children as unknown[]));
  }
  return undefined;
}

function pullRequestNumber(url: string): string {
  const match = url.match(/\/(?:pull|pulls|pull-requests|merge_requests)\/(\d+)/);
  return match?.[1] ? `#${match[1]}` : '';
}

function namesLabel(items: unknown, nameKey: string, noun: string, verb: string): string {
  const names = (Array.isArray(items) ? items : [])
    .map(item => text(record(item)[nameKey]))
    .filter(Boolean);
  if (names.length === 0) return `${verb} ${noun}s`;
  if (names.length === 1) return join(`${verb} a ${noun}`, names[0] ?? '');
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length > 2 ? ` +${names.length - 2}` : '';
  return join(`${verb} ${names.length} ${noun}s`, `${shown}${rest}`);
}

const CARD_LABELS: Array<[string, (props: Record<string, unknown>) => string]> = [
  [
    'plan',
    props => {
      const verb = props['phase'] === 'proposed' ? 'Proposed a plan' : 'Shared a plan';
      const title = text(props['title']);
      return title ? `📋 ${verb}: ${title}` : `📋 ${verb}`;
    },
  ],
  [
    'diff',
    props => {
      const path = text(props['path']);
      return path ? `📝 Shared a diff: ${path}` : '📝 Shared a diff';
    },
  ],
  [
    'code',
    props => {
      const language = text(props['language']);
      return language ? `💻 Shared ${language} code` : '💻 Shared a code snippet';
    },
  ],
  [
    'ticket',
    props => {
      const xyneId = text(props['xyneId']);
      const title = text(props['title']);
      if (xyneId && title) return `🎫 Filed ${xyneId}: ${title}`;
      return xyneId ? `🎫 Filed ${xyneId}` : '🎫 Filed a ticket';
    },
  ],
  [
    'chart',
    props => {
      const caption = text(props['caption']);
      return caption ? `📊 ${caption}` : '📊 Shared a chart';
    },
  ],
  [
    'user_question',
    props => {
      const questions = props['questions'];
      const count = Array.isArray(questions) ? questions.length : 0;
      if (props['phase'] === 'answered') {
        return `✅ Answered ${count || 'agent'} question${count === 1 ? '' : 's'}`;
      }
      if (props['phase'] === 'declined') return 'Question request declined';
      return count > 1
        ? `💬 Agent wants to ask you ${count} questions`
        : '💬 Agent wants to ask you a question';
    },
  ],
  [
    'pr',
    props => {
      const number = pullRequestNumber(text(props['url']));
      return `🔀 ${join(number ? `PR ${number}` : 'PR', text(props['status']), text(props['title']))}`;
    },
  ],
  [
    'pr_approval',
    props => {
      const title = text(props['title']);
      if (props['phase'] === 'resolved') {
        const outcome = props['outcome'] === 'denied' ? 'Merge denied' : 'Merge approved';
        return `🔀 ${join(outcome, title)}`;
      }
      return `🔀 ${join('Approve merging', title)}`;
    },
  ],
  [
    'agent',
    props => {
      const name = text(record(props['agent'])['name']);
      if (props['variant'] === 'update') return `🤖 ${join('Proposed changes to an agent', name)}`;
      if (props['variant'] === 'profile') return `🤖 ${join('Shared an agent', name)}`;
      const phase = props['phase'];
      if (phase === 'created') return `🤖 ${join('Created an agent', name)}`;
      if (phase === 'rejected') return `🤖 ${join('Agent draft declined', name)}`;
      if (phase === 'superseded') return `🤖 ${join('Agent draft replaced', name)}`;
      return `🤖 ${join('Drafted an agent', name)}`;
    },
  ],
  [
    'agent_summary',
    props => {
      const label = text(props['label']);
      if (label) return `🤖 ${label}`;
      const total = typeof props['total'] === 'number' ? props['total'] : 0;
      return `🤖 ${total} agent${total === 1 ? '' : 's'} available`;
    },
  ],
  ['mcp_suggest', props => `🔌 ${namesLabel(props['connectors'], 'name', 'connector', 'Suggested')}`],
  [
    'provider_suggest',
    props => `🔑 ${namesLabel(props['providers'], 'name', 'provider', 'Suggested')}`,
  ],
  [
    'mcpConfigure',
    props => `🔌 ${join('Connect a connector', text(props['serverName']) || text(props['serverType']))}`,
  ],
  [
    'call_schedule',
    props => {
      const title = text(props['title']);
      if (props['phase'] === 'scheduled') return `📅 ${join('Scheduled a call', title)}`;
      return `📅 ${join('Proposed call times', title)}`;
    },
  ],
];

export function flowCardType(flow: FlowCardLike): string | null {
  for (const [type] of CARD_LABELS) {
    if (findComponent(flow, type)) return type;
  }
  return null;
}

export function flowCardLabel(flow: FlowCardLike): string | null {
  for (const [type, label] of CARD_LABELS) {
    const component = findComponent(flow, type);
    if (component) return label(record(component.props));
  }
  return null;
}

export function flowFallbackLabel(flow: FlowCardLike | null): string {
  if (!flow) return GENERIC_FLOW_CARD_LABEL;
  const fallbackText = text(record(flow.data)['fallbackText']);
  if (fallbackText) return fallbackText;
  const title = text(flow.title);
  if (title) return title;
  return flowCardLabel(flow) ?? GENERIC_FLOW_CARD_LABEL;
}
