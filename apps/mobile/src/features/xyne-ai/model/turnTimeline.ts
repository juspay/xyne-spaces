import type { ToolInvocation, TurnPart } from '../api/xyneAIEvents';
import { isShownText, type TextPart } from './assistantTurn';

export type StepPart = Exclude<TurnPart, { type: 'text' }>;

type TurnSegment =
  { kind: 'text'; part: TextPart } | { kind: 'steps'; id: string; parts: StepPart[] };

export function groupTurnParts(
  parts: TurnPart[],
  hasInvocation: (toolCallId: string) => boolean,
): TurnSegment[] {
  const segments: TurnSegment[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (isShownText(part)) segments.push({ kind: 'text', part });
      continue;
    }
    if (part.type === 'tool' && !hasInvocation(part.id)) continue;
    const last = segments.at(-1);
    if (last?.kind === 'steps') last.parts.push(part);
    else segments.push({ kind: 'steps', id: `steps-${part.id}`, parts: [part] });
  }
  return segments;
}

export type ToolLookup = ReadonlyMap<string, ToolInvocation>;

export function formatSeconds(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function humanizeToolName(raw: string | undefined): string {
  if (!raw) return '';
  const unprefixed = raw.includes('__') ? raw.split('__').slice(1).join('__') : raw;
  const base = unprefixed.split(':').at(-1) ?? unprefixed;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export const thinkingMs = ({
  startedAt,
  endedAt,
}: Extract<TurnPart, { type: 'reasoning' }>): number | undefined =>
  startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined;

type StepVerb = 'ran' | 'explored' | 'used';

function verbFor(toolName: string): StepVerb {
  const base = (toolName.split('__').at(-1) ?? toolName).toLowerCase().replace(/-/g, '_');
  if (/^(bash|shell|sh|exec|execute|run|terminal)(_|$)/.test(base)) return 'ran';
  if (
    /^(read|grep|glob|find|ls|list|get|fetch|query|lookup|view|browse|recall)(_|$)/.test(base) ||
    /(^|_)(search|fetch|lookup)(_|$)/.test(base)
  ) {
    return 'explored';
  }
  return 'used';
}

function nameList(names: string[]): string {
  const [first, second, third] = names;
  if (third === undefined) return names.join(' and ');
  return names.length === 3
    ? `${first}, ${second} and ${third}`
    : `${first}, ${second} and ${names.length - 2} more`;
}

interface StepSummary {
  label: string;
  failed: number;
}

export function summarizeSteps(parts: StepPart[], calls: ToolLookup): StepSummary {
  let thoughtMs = 0;
  let thought = false;
  let failed = 0;
  const clauses = new Map<StepVerb, string[]>();
  for (const part of parts) {
    if (part.type === 'reasoning') {
      thought = true;
      thoughtMs += thinkingMs(part) ?? 0;
      continue;
    }
    const call = calls.get(part.id);
    if (!call) continue;
    const verb = verbFor(call.toolName);
    const names = clauses.get(verb) ?? [];
    const name = humanizeToolName(call.toolName) || 'a tool';
    if (!names.includes(name)) names.push(name);
    clauses.set(verb, names);
    if (call.isError || call.status === 'error') failed += 1;
  }
  const sentence = [
    thoughtMs >= 1000 ? `thought for ${formatSeconds(thoughtMs)}` : thought ? 'thought' : null,
    ...[...clauses].map(([verb, names]) => `${verb} ${nameList(names)}`),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    label: sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : 'Steps',
    failed,
  };
}

export function liveActivity(parts: StepPart[], calls: ToolLookup): string {
  const current = parts.at(-1);
  if (!current || current.type === 'reasoning') return 'Thinking';
  const called = parts.flatMap(part => {
    const call = part.type === 'tool' ? calls.get(part.id) : undefined;
    return call ? [call] : [];
  });
  const call = called.filter(({ status }) => status === 'running').at(-1) ?? called.at(-1);
  return humanizeToolName(call?.toolName) || 'Working';
}

export function turnDurationLabel(durationMs: number | undefined, stopped: boolean): string | null {
  if (durationMs === undefined) return null;
  return `${stopped ? 'Stopped after' : 'Worked for'} ${formatSeconds(durationMs)}`;
}

const PREVIEW_KEYS = [
  'description',
  'question',
  'query',
  'title',
  'path',
  'file_path',
  'url',
  'command',
  'pattern',
  'prompt',
];

export function previewOf(args: Record<string, unknown>): { key: string; text: string } | null {
  for (const key of PREVIEW_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return { key, text: value.trim() };
  }
  return null;
}

export function readableResult(result: string): string {
  if (!result.trimStart().startsWith('{"content"')) return result;
  try {
    const { content } = JSON.parse(result) as { content?: { type?: string; text?: unknown }[] };
    const texts = (content ?? []).flatMap(block =>
      block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
    );
    return texts.length > 0 ? texts.join('\n\n') : result;
  } catch {
    return result;
  }
}

const DETAIL_MAX_CHARS = 4000;

export function clipDetail(text: string): string {
  return text.length > DETAIL_MAX_CHARS
    ? `${text.slice(0, DETAIL_MAX_CHARS)}\n… ${text.length - DETAIL_MAX_CHARS} more characters`
    : text;
}

export const formatArgs = (args: Record<string, unknown>): string =>
  clipDetail(JSON.stringify(args, null, 2));
