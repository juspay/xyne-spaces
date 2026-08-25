/**
 * Renders a collected window into the files the agent reads.
 *
 * Shape of the deal with the model: WINDOW.md is the overview and is small
 * enough to read whole; events.jsonl is the full detail and is GREPPED, not
 * read. The outline in WINDOW.md carries line anchors into events.jsonl so the
 * agent can jump straight to a range instead of scanning.
 *
 * events.jsonl grep-ability is a FORMAT CONTRACT, not a nicety: keys are
 * emitted in a fixed order, booleans are unquoted, and `text` is last so a
 * truncation is visually obvious. That is what makes `grep '"unanswered":true'`
 * an exact match. Changing the key order silently breaks the recipes printed
 * in WINDOW.md and in the heartbeat skill.
 *
 * The agent has read/grep/find/ls but NO bash (xyne-claw excludes it from the
 * tool allowlist), so every recipe below is expressed as a single grep.
 */

import type { AwakeningWindow, WindowEvent } from "./types.js";
import { renderPriorRuns } from "./prior-runs.js";

/** Files land under the session's .context/ dir, which xyne-claw sanitizes. */
export const ARTIFACT_DIR = "heartbeat";
export const WINDOW_PATH = `${ARTIFACT_DIR}/WINDOW.md`;
export const EVENTS_PATH = `${ARTIFACT_DIR}/events.jsonl`;
export const CURSOR_PATH = `${ARTIFACT_DIR}/CURSOR.json`;
export const PRIOR_PATH = `${ARTIFACT_DIR}/prior-sessions.md`;

export interface RenderedWindow {
  files: Array<{ path: string; content: string }>;
  /** The path the agent is told to read first. */
  entryPath: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function hhmmss(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

function durationLabel(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h${mins % 60 ? `${mins % 60}m` : ""}`;
}

/**
 * Stamp each event with its 1-based line number in events.jsonl.
 *
 * Done ONCE, up front, so the outline in WINDOW.md and the file itself can
 * never disagree. Previously the numbering was a side effect of rendering the
 * jsonl, which made WINDOW.md silently wrong if it was rendered first.
 */
export function assignLineNumbers(events: WindowEvent[]): WindowEvent[] {
  events.forEach((e, i) => {
    e.L = i + 1;
  });
  return events;
}

/** One JSON object per line with a FIXED key order. Pure — call assignLineNumbers first. */
export function renderEventsJsonl(events: WindowEvent[]): string {
  return events
    .map((e) => {
      return JSON.stringify({
        L: e.L,
        kind: e.kind,
        at: e.at,
        id: e.id,
        ch: e.ch,
        chName: e.chName,
        cv: e.cv,
        cvTitle: e.cvTitle,
        sender: e.sender,
        senderId: e.senderId,
        isHuman: e.isHuman,
        isMe: e.isMe,
        root: e.root,
        mentionsMe: e.mentionsMe,
        unanswered: e.unanswered,
        covered: e.covered,
        coveredBy: e.coveredBy,
        question: e.question,
        actionSignals: e.actionSignals,
        edited: e.edited,
        chars: e.chars,
        text: e.text,
      });
    })
    .join("\n");
}

function renderMetrics(w: AwakeningWindow): string {
  const s = w.signals;
  const rows: Array<[string, number, string]> = [
    ["events", s.eventCount, ""],
    ["human events", s.humanEventCount, "excludes bots and your own messages"],
    ["your own messages", s.selfEventCount, ""],
    ["other bot messages", s.botEventCount, ""],
    ["distinct senders", s.distinctSenders, ""],
    ["distinct threads", s.distinctThreads, ""],
    ["new threads", s.newThreads, ""],
    ["unanswered threads", s.unansweredThreads, "last message is human, nobody replied"],
    ["direct mentions of you", s.mentionsOfMe, ""],
    ["questions", s.questions, ""],
    ["action signals", s.actionSignals, "urgent / blocked / escalation / request"],
  ];
  const uncovered = w.events.filter((e) => !e.covered).length;
  if (w.priorRuns.length > 0) {
    rows.push(["events NOT already handled", uncovered, `grep '"covered":false' .context/${EVENTS_PATH}`]);
  }
  return [
    "| signal | value | notes |",
    "|---|---:|---|",
    ...rows.map(([label, value, note]) => `| ${label} | ${value} | ${note} |`),
  ].join("\n");
}

function renderChannels(w: AwakeningWindow): string {
  const byChannel = new Map<string, { events: number; humans: number; unanswered: Set<string> }>();
  for (const e of w.events) {
    const entry = byChannel.get(e.ch) ?? { events: 0, humans: 0, unanswered: new Set<string>() };
    entry.events++;
    if (e.isHuman) entry.humans++;
    if (e.unanswered) entry.unanswered.add(e.cv);
    byChannel.set(e.ch, entry);
  }

  const lines = [
    "| channel | id | events | humans | unanswered |",
    "|---|---|---:|---:|---:|",
  ];
  for (const ch of w.channels) {
    const entry = byChannel.get(ch.id);
    if (!entry) continue;
    lines.push(`| ${ch.name} | \`${ch.id}\` | ${entry.events} | ${entry.humans} | ${entry.unanswered.size} |`);
  }

  if (w.silentChannels.length > 0) {
    lines.push("");
    lines.push(`Watched but silent this window: ${w.silentChannels.map((c) => `\`${c.name}\``).join(", ")}.`);
  }
  return lines.join("\n");
}

/**
 * Describe a thread's line positions in events.jsonl.
 *
 * A range is only written as `L4–L5` when the lines are genuinely contiguous.
 * Threads interleave, so a thread at lines 1, 2 and 10 rendered as "L1–L10"
 * would invite a read(offset:1, limit:10) that is 70% other threads' events.
 * Non-contiguous threads get their exact lines instead.
 */
function describeLines(list: WindowEvent[]): string {
  const lines = list.map((e) => e.L);
  const first = lines[0] ?? 0;
  const last = lines[lines.length - 1] ?? 0;
  const contiguous = lines.length === last - first + 1;
  if (contiguous) return lines.length === 1 ? `L${first}` : `L${first}–L${last}`;
  if (lines.length <= 8) return `lines ${lines.map((l) => `L${l}`).join(", ")}`;
  return `${lines.length} lines between L${first} and L${last} — grep '"cv":"${list[0]?.cv ?? ""}"' for exactly these`;
}

/** Thread-grouped outline with line anchors into events.jsonl. */
function renderOutline(w: AwakeningWindow): string {
  const threads = new Map<string, WindowEvent[]>();
  for (const e of w.events) {
    const list = threads.get(e.cv) ?? [];
    list.push(e);
    threads.set(e.cv, list);
  }

  const blocks: string[] = [];
  for (const [cv, list] of threads) {
    const first = list[0];
    if (!first) continue;
    blocks.push(
      `### ${first.chName} / \`${cv}\` — "${first.cvTitle}" (${list.length} ${list.length === 1 ? "event" : "events"}, ${describeLines(list)})`,
    );
    // The exact arguments needed to reply here. The ids are already on every
    // events.jsonl line, but as data fields — spelling them out as tool
    // parameters is what turns "I should reply to this" into an actual call.
    blocks.push(`reply here → \`channelId: "${first.ch}", conversationId: "${cv}"\``);
    blocks.push("```");
    for (const e of list) {
      const tags = [
        e.isMe ? "you" : "",
        e.mentionsMe ? "MENTION" : "",
        e.unanswered ? "UNANSWERED" : "",
        e.covered ? `handled by ${e.coveredBy}` : "",
        e.question ? "question" : "",
        ...e.actionSignals,
      ].filter(Boolean);
      const suffix = tags.length > 0 ? `  [${tags.join(", ")}]` : "";
      const text = e.text.length > 90 ? `${e.text.slice(0, 87)}…` : e.text;
      blocks.push(
        `L${String(e.L).padEnd(4)} ${hhmmss(e.atMs)}  ${e.sender.padEnd(18).slice(0, 18)}  ${text.replace(/\n/g, " ")}${suffix}`,
      );
    }
    blocks.push("```");
    blocks.push("");
  }
  return blocks.join("\n");
}

const GREP_RECIPES = [
  ["unanswered threads", `grep '"unanswered":true' .context/${EVENTS_PATH}`],
  ["mentions of you", `grep '"mentionsMe":true' .context/${EVENTS_PATH}`],
  ["open questions", `grep '"question":true' .context/${EVENTS_PATH}`],
  ["escalations", `grep '"actionSignals":\\["escalation' .context/${EVENTS_PATH}`],
  ["one thread", `grep '"cv":"<conversationId>"' .context/${EVENTS_PATH}`],
  ["one person", `grep '"sender":"<name>"' .context/${EVENTS_PATH}`],
  ["exclude your own posts", `grep '"isMe":false' .context/${EVENTS_PATH}`],
  ["not yet handled by an earlier run", `grep '"covered":false' .context/${EVENTS_PATH}`],
];

/** Section 3: a short summary; the detail lives in prior-sessions.md. */
function renderPriorSection(w: AwakeningWindow): string[] {
  if (w.priorRuns.length === 0) return [];
  const acted = w.priorRuns.filter((p) => p.covers);
  const inFlight = w.priorRuns.filter((p) => !p.completedAt);
  const uncovered = w.events.filter((e) => !e.covered).length;

  return [
    "## 3. What already happened in this window",
    "",
    `${w.priorRuns.length} earlier awakened run(s) overlap this window; ${acted.length} of them acted.`,
    `${uncovered} of ${w.events.length} events are NOT already handled.`,
    inFlight.length > 0
      ? `${inFlight.length} run(s) are STILL IN FLIGHT — leave the threads they are working on alone.`
      : "",
    "",
    `Full detail, including what each one said: \`.context/${PRIOR_PATH}\`.`,
    "",
  ].filter((l) => l !== "");
}

export function renderWindowMarkdown(w: AwakeningWindow): string {
  assignLineNumbers(w.events);
  const frontmatter = [
    "---",
    "artifact: xyne-window",
    "version: 1",
    `kind: ${w.kind}`,
    `agent: ${w.agentSlug}`,
    `windowStart: ${iso(w.startMs)}`,
    `windowEnd: ${iso(w.endMs)}`,
    `sealedAt: ${iso(Date.now())}`,
    `events: ${w.events.length}`,
    `truncated: ${w.truncated}`,
    `gap: ${w.gap ? `${Math.round(w.gap.skippedMs / 60_000)}m skipped` : "none"}`,
    `writePolicy: ${w.config.writePolicy}`,
    `shadow: ${w.config.shadow}`,
    "---",
  ].join("\n");

  const truncationNote = w.truncated
    ? `\n> **This window was truncated** at ${w.config.limits.maxEvents} events. Older events in the window were dropped; treat the oldest entries as incomplete.\n`
    : "";

  const gapNote = w.gap
    ? `\n> **Gap:** ${Math.round(w.gap.skippedMs / 60_000)} minutes before this window were skipped (the agent was not running). You did NOT see those events and will not get another chance to.\n`
    : "";

  return [
    frontmatter,
    "",
    `# ${w.kind === "heartbeat" ? "Heartbeat" : "Reflex"} window — ${w.agentSlug}`,
    "",
    `Window \`${hhmmss(w.startMs)} → ${hhmmss(w.endMs)}\` (${durationLabel(w.endMs - w.startMs)}).`,
    "Everything in this window is already collected below. Read this file top to bottom",
    "BEFORE opening anything else, and do not re-search Spaces for events inside it.",
    truncationNote,
    gapNote,
    "## 1. Metrics",
    "",
    renderMetrics(w),
    "",
    "## 2. Channels",
    "",
    renderChannels(w),
    "",
    ...renderPriorSection(w),
    "## 4. Outline — every event, oldest first",
    "",
    `Index into \`.context/${EVENTS_PATH}\` (${w.events.length} lines, one JSON object per line, chronological).`,
    "`L` is the line number — read a range directly with",
    `\`read(path=".context/${EVENTS_PATH}", offset=<L>, limit=<n>)\`.`,
    "",
    ...(w.config.shadow || w.config.writePolicy === "observe"
      ? []
      : [
          "**To reply to any thread below, call the Spaces send-message tool** with the",
          "`channelId` / `conversationId` printed under its heading. Writing a reply as your",
          "final answer posts nothing — this run's output is not delivered to anyone.",
          "",
        ]),
    renderOutline(w),
    "## 5. Files",
    "",
    "| path | what |",
    "|---|---|",
    `| \`.context/${WINDOW_PATH}\` | this file |`,
    `| \`.context/${EVENTS_PATH}\` | ${w.events.length} events, one per line. GREP THIS. |`,
    `| \`.context/${CURSOR_PATH}\` | exact window bounds and coverage proof |`,
    ...(w.priorRuns.length > 0
      ? [`| \`.context/${PRIOR_PATH}\` | what earlier runs in this window already did |`]
      : []),
    "",
    "### Grep recipes",
    "",
    "You have `read`, `grep`, `find` and `ls`. You do **not** have bash.",
    "",
    ...GREP_RECIPES.map(([what, cmd]) => `- ${what}: \`${cmd}\``),
    "",
  ].join("\n");
}

function renderCursor(w: AwakeningWindow): string {
  return JSON.stringify(
    {
      agentSlug: w.agentSlug,
      kind: w.kind,
      windowStart: iso(w.startMs),
      windowEnd: iso(w.endMs),
      replicaSafetyMs: w.config.cursor.replicaSafetyMs,
      overlapMs: w.config.cursor.overlapMs,
      events: w.events.length,
      truncated: w.truncated,
      gapSkippedMs: w.gap?.skippedMs ?? 0,
      channels: w.channels.map((c) => ({ id: c.id, name: c.name })),
      signals: w.signals,
    },
    null,
    2,
  );
}

/** Render the full artifact set. */
export function renderWindow(w: AwakeningWindow): RenderedWindow {
  assignLineNumbers(w.events);
  const events = renderEventsJsonl(w.events);
  return {
    entryPath: `.context/${WINDOW_PATH}`,
    files: [
      { path: EVENTS_PATH, content: events },
      { path: WINDOW_PATH, content: renderWindowMarkdown(w) },
      { path: CURSOR_PATH, content: renderCursor(w) },
      ...(w.priorRuns.length > 0
        ? [{ path: PRIOR_PATH, content: renderPriorRuns(w.priorRuns) }]
        : []),
    ],
  };
}
