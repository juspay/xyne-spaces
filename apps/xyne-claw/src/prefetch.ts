/**
 * Query prefetch — resolve entities BEFORE the model's first turn.
 *
 * Measured motivation (debug-session analysis, 2026-08-19, agent `ask-ai`):
 * two runs of the same question spent whole turns discovering things the
 * platform can look up deterministically —
 *   - `spaces-whoami` returned the SAME id already present in the run payload,
 *   - channel / project lookups just mapped a name to an id,
 *   - each of those cost a full LLM round trip (15-25s at the measured 23-27
 *     tok/s), because emitting any tool call ends the assistant turn.
 *
 * So: extract the entities named in the query with ONE cheap model call, resolve
 * them with plain tool calls in parallel, and hand the answers to the model as
 * part of its first user message.
 *
 * Design rules this file follows, in order of importance:
 *   1. NEVER fail the run. Every step is timeout-bounded and swallowed; the
 *      worst outcome is no block at all, i.e. today's behaviour.
 *   2. Resolve, don't decide. When several channels match, attach them ALL with
 *      their ids and let the big model pick. A wrong pick made here is invisible
 *      to the model and unrecoverable; an extra 40 tokens is not.
 *   3. Bounded output. Digest only — ids, names, counts. Dumping result bodies
 *      here would recreate the context bloat that forces compaction.
 *   4. Hint, not truth. The block is labelled as prefetched and unverified, so
 *      the model re-checks rather than anchoring on it.
 */

import { LITELLM } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("prefetch");

/** The extractor is a hint generator, not a gate — if it is slow we ship without it. */
const EXTRACT_TIMEOUT_MS = Number(process.env["XYNE_CLAW_PREFETCH_EXTRACT_TIMEOUT_MS"] ?? 6_000);
/** Resolvers run in parallel, so this is the wall-clock ceiling for ALL of them. */
const RESOLVE_TIMEOUT_MS = Number(process.env["XYNE_CLAW_PREFETCH_RESOLVE_TIMEOUT_MS"] ?? 5_000);
/**
 * Per-resolver line budget, spent in whole rows (see `digest`).
 *
 * A clean channel row is ~5-6 lines (header, description, the detail line, and
 * the ids), so 12 bought exactly TWO rows — and a `Channels matching "x"` that
 * really matched 8 showed the model a quarter of them. `scrub` took ~40% of the
 * old volume out of each row, so this buys ~4 rows now instead of 2, at roughly
 * the character cost the noisy 2-row version used to have.
 *
 * Bounded above by RESOLVER_LIMIT (nothing beyond 10 rows is fetched) and by
 * MAX_BLOCK_CHARS, which still governs the block as a whole: a run with two
 * populated sections lands near 3k of the 4k cap.
 */
const MAX_LINES_PER_RESOLVER = 24;
/** Hard cap on the whole block, so a pathological resolver can never bloat turn 1. */
const MAX_BLOCK_CHARS = 4_000;
/** Asked of the resolvers themselves, so a broad name match never ships 100 rows across the wire. */
const RESOLVER_LIMIT = 10;
/** Each entity fans out to every resolver, so this bounds the fan-out at MAX_ENTITIES x 3. */
const MAX_ENTITIES = 3;
/**
 * Hits for the content probe.
 *
 * Deliberately much larger than the other resolvers, because this one PROJECTS
 * (see MENTION_PROBE_FIELDS): it never fetches message bodies, so a hit costs a
 * few hundred bytes instead of a few KB. Measured on chat_message —
 *   select *      : 8 hits 22 KB | 60 hits 461 KB
 *   projected     : 8 hits  2.8 KB | 60 hits  19.9 KB
 * i.e. 40 projected hits cost less than 8 unprojected ones. More hits directly
 * improves the answer here: the section reports which channels the ranked hits
 * fall in, so a wider sample surfaces the second and third channel instead of
 * only the top one.
 */
const MENTION_PROBE_HITS = Number(process.env["XYNE_CLAW_PREFETCH_MENTION_HITS"] ?? 40);
/**
 * Columns the probe needs. `transformHit` types a row off docType/sddocname and
 * titles a message from messageChannelName/channelName + username, so those are
 * required for the row to render as `[message] <channel> — <sender>` at all;
 * claw-auth re-adds them anyway. Everything else — above all `text`, the whole
 * cost — is left behind.
 */
const MENTION_PROBE_FIELDS = ["docType", "channelId", "channelName", "messageChannelName", "username"];
/** Second-hop lookups (channel→project, project→channels). One hop, never recursive. */
const MAX_HOPS = 2;

/** Which resolver produced a section — drives the graph hops below. */
type ResolvedKind = "channels" | "projects" | "people" | "mentions";

interface ResolvedSection {
  kind: ResolvedKind;
  heading: string;
  body: string | null;
}

/**
 * A second-hop result, tagged by which lookup produced it. Both hops for a
 * project run in one round, so the round's results are a mixed bag that has to
 * be sorted back out by tag.
 */
type HopResult =
  | { hop: "channels"; projectId: string; body: string | null }
  | { hop: "name"; projectId: string; name: string | null };

/**
 * What the extractor pulls out of the raw question. Everything is optional:
 * a conversational message legitimately yields empty lists, and that is the
 * signal to skip prefetch entirely.
 */
export interface PrefetchSpec {
  /** `conversational` means "no retrieval needed" — we then attach nothing but identity. */
  intent: "sweep" | "lookup" | "count" | "conversational";
  /**
   * Names the question mentions — NOT typed as channel/project/person.
   *
   * The extractor has never seen this workspace, so asking it whether
   * "xyne-spaces" is a channel or a project is asking it to guess. It cannot
   * know, and a wrong guess silently drops a resolver. So it only reports the
   * names; every name is fanned out to EVERY resolver and the lookups decide.
   * A row coming back from the `project` search area IS the proof it is a project.
   */
  entities: string[];
}

/**
 * Minimal structural shape of a live tool. We deliberately do NOT import pi's
 * `ToolDefinition`: prefetch only ever needs the name and the execute closure,
 * and a structural type keeps this module independent of the SDK version.
 */
export interface ExecutableTool {
  name: string;
  execute(toolCallId: string, params: unknown): Promise<unknown>;
}

export interface PrefetchIdentity {
  userId: string;
  userName?: string | undefined;
  userEmail?: string | undefined;
}

const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "record_query_entities",
    description: "Record the entities named in the user's question so the platform can resolve their ids up front.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["sweep", "lookup", "count", "conversational"],
          description:
            "sweep = exhaustive list ('what all', 'everything'); lookup = find specific items; count = how many; conversational = no data retrieval needed.",
        },
        entities: {
          type: "array",
          items: { type: "string" },
          description:
            "Names of things the question mentions — a team, product, channel, project, repo, or person. Do NOT say what kind of thing each one is; the platform resolves that. Strip a leading '#'. Empty when the question names nothing.",
        },
      },
      required: ["intent", "entities"],
      additionalProperties: false,
    },
  },
} as const;

const EXTRACT_SYSTEM_PROMPT = `Extract the named entities from a question asked inside Xyne Spaces (a workplace chat/ticketing platform).

Rules:
- List ONLY the names the question actually mentions. Never infer, expand, or add related things.
- Do NOT try to say whether a name is a channel, a project, or a person. You have not seen this workspace and cannot know — the platform looks each one up. Just report the name.
- Strip a leading '#'.
- Intent "conversational" is ONLY for a question that names NOTHING in the workspace: a greeting, a thank-you, or a question about you. If the question mentions ANY name, product, team, project, channel, person or topic, it is NEVER conversational — even if it is very short, has no verb, or is only two or three words. "why namma cloud", "euler status", "billing?" are all lookups.
- Classify intent by the ask, not the topic: "what all X" / "list every X" is sweep; "how many" is count; finding specific items is lookup.

Call record_query_entities exactly once.`;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringList(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asString(item).replace(/^#/, "");
    // Single characters and pathological lengths are never real entity names;
    // they only cost a resolver call that returns the whole workspace.
    if (s.length < 2 || s.length > 120) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Fire the extractor. Call this as EARLY as possible in the request handler —
 * it needs nothing but the task text, so it can overlap the MCP tool listing and
 * session restore instead of adding its latency in front of turn 1.
 *
 * Never rejects: a failure resolves to null and prefetch degrades to
 * identity-only.
 */
export function startPrefetchExtraction(task: string): Promise<PrefetchSpec | null> {
  if (!LITELLM.apiKey || !task.trim()) return Promise.resolve(null);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  return (async (): Promise<PrefetchSpec | null> => {
    try {
      const res = await fetch(`${LITELLM.url.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: LITELLM.fastModel,
          messages: [
            { role: "system", content: EXTRACT_SYSTEM_PROMPT },
            { role: "user", content: task.slice(0, 2_000) },
          ],
          tools: [EXTRACT_TOOL],
          tool_choice: { type: "function", function: { name: "record_query_entities" } },
          temperature: 0,
        }),
      });
      if (!res.ok) {
        log.warn(`[prefetch] extractor HTTP ${res.status} — skipping prefetch`);
        return null;
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
      };
      const raw = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!raw) {
        log.warn("[prefetch] extractor returned no tool call — skipping prefetch");
        return null;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const intent = asString(parsed["intent"]);
      const spec: PrefetchSpec = {
        intent:
          intent === "sweep" || intent === "lookup" || intent === "count" || intent === "conversational"
            ? intent
            : "lookup",
        // Capped low on purpose: each name fans out to every resolver, so the
        // call count is entities x resolvers.
        entities: asStringList(parsed["entities"], MAX_ENTITIES),
      };
      log.info(`[prefetch] extracted intent=${spec.intent} entities=[${spec.entities.join(", ")}]`);
      return spec;
    } catch (err) {
      // AbortError included: a slow extractor is a skipped optimisation, not an error.
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[prefetch] extractor failed (${msg}) — skipping prefetch`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
}

/** Pull the plain text out of a tool result without assuming the exact envelope. */
function toolResultText(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }> } | undefined;
  if (!r?.content) return "";
  return r.content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();
}

/**
 * Strip the parts of a rendered tool result that are noise INSIDE a prefetch
 * block, BEFORE `digest()` applies its cap.
 *
 * The resolvers share a renderer built for a tool result the model asked for
 * and reads on its own terms: it emits citation tokens for the frontend, echoes
 * the YQL it ran, and heads the list with a row count. In a prefetch block none
 * of that survives contact with reality —
 *   - `[clf-prefetch#N]` is a citation handle that resolves to NOTHING (prefetch
 *     registers no citation), so leaving it in invites the model to cite a chip
 *     that renders dead;
 *   - the echoed YQL is debugging output for a human, and it is long: the two
 *     EMPTY resolvers in the measured run spent ~700 chars on it between them;
 *   - `score: 0.000` is what a structured filter query always returns (nothing
 *     ranked it), i.e. a confidence signal that is false rather than absent;
 *   - the renderer prints `channelId` from both searchContext and metadata, so
 *     every channel row carries it twice.
 *
 * The point is not the tokens — the block is only ~3.8% of turn 1. It is that
 * MAX_LINES_PER_RESOLVER is a LINE budget, not a row budget: every noise line
 * displaces a real result. Measured on the run of 2026-08-20, a channel search
 * that matched 8 channels showed the model 2, because 6 of its 12 lines were
 * spent on the above.
 */
export function scrub(text: string): string {
  const out: string[] = [];
  let lastCreatedBy: string | null = null;
  for (const raw of text.split("\n")) {
    if (/^\s*\[Executed YQL/.test(raw)) continue;
    if (/^\s*Found \d+ result\(s\):\s*$/.test(raw)) continue;

    let line = raw.replace(/\[clf-[^\]\s]*#[\d#-]+\]\s*/g, "");
    line = line.replace(/\s*·\s*score:\s*0\.000\s*$/, "");
    if (!line.trim()) continue;

    // `Owner:` restating the `createdBy:` directly above it — the renderer
    // fills both from the same field for channel rows.
    const created = line.match(/^\s*createdBy:\s*(\S+)\s*$/);
    if (created) lastCreatedBy = created[1] ?? null;
    else {
      const owner = line.match(/^\s*Owner:\s*(\S+)\s*$/);
      if (owner && owner[1] === lastCreatedBy) continue;
      if (!owner) lastCreatedBy = null;
    }

    // Consecutive exact repeats (the doubled `channelId:`).
    if (out.length > 0 && out[out.length - 1]!.trim() === line.trim()) continue;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Trim a resolver result to the few ROWS the model needs to disambiguate.
 *
 * Row-aware, not line-aware, for two reasons the line version got wrong:
 *   - it cut mid-row, so the last channel in a block could arrive without the
 *     `channelId:` line that is the entire reason for prefetching it. A row the
 *     model cannot act on is worse than a row it never saw;
 *   - its "… N more" counted LINES, so a search matching 8 channels that showed
 *     2 reported "12 more" — a number that corresponds to nothing the model can
 *     ask for. It now counts results, which is what "query the tool directly"
 *     would return.
 */
export function digest(text: string): string | null {
  if (!text) return null;
  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // A row is an unindented `[type] …` header plus the indented detail lines
  // beneath it. Text with no header at all (`No results found.`) collapses to a
  // single row and is kept whole.
  const rows: string[][] = [];
  for (const line of lines) {
    if (rows.length === 0 || /^\[/.test(line)) rows.push([line]);
    else rows[rows.length - 1]!.push(line);
  }

  const kept: string[][] = [];
  let used = 0;
  for (const row of rows) {
    // The first row goes in whatever its length: better one oversized row than
    // an empty section.
    if (kept.length > 0 && used + row.length > MAX_LINES_PER_RESOLVER) break;
    kept.push(row);
    used += row.length;
  }

  const omitted = rows.length - kept.length;
  const body = kept.flat().join("\n");
  return omitted > 0
    ? `${body}\n… ${omitted} more result${omitted === 1 ? "" : "s"} (query the tool directly)`
    : body;
}

/**
 * Pull a project's NAME out of a rendered `project` row.
 *
 * `formatSearchResult` renders a project hit as `[project] <name> — <subtitle>`
 * (the leading `[clf-…#N]` token is absent because project rows are
 * non-routable), so the name is everything after the type tag and before the
 * em-dash subtitle separator. Null when the lookup missed, which keeps the
 * caller on its id-only fallback.
 */
export function parseProjectName(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    const m = line.match(/\[project\]\s+(.+?)\s*$/);
    if (!m) continue;
    const name = (m[1] ?? "").split(" — ")[0]?.trim();
    if (name) return name;
  }
  return null;
}

/**
 * Annotate every `projectId: <id>` line whose project we resolved a name for.
 *
 * A channel row prints its owning project as a bare id, which is unreadable on
 * its own — the model either ignores it or spends a turn resolving it. We
 * already fetch the name for the hop heading, so stamping it inline here is
 * free.
 */
export function annotateProjectIds(text: string, names: Map<string, string>): string {
  if (names.size === 0) return text;
  return text.replace(/^(\s*projectId:\s*)([A-Za-z0-9_-]{6,})\s*$/gm, (line, prefix: string, id: string) => {
    const name = names.get(id);
    return name ? `${prefix}${id} (${name})` : line;
  });
}

/**
 * Run one resolver. `undefined` when the tool is not mounted for this agent —
 * which is normal and must not be logged as an error.
 */
async function runResolver(
  tool: ExecutableTool | undefined,
  params: unknown,
  label: string,
  condense?: (text: string) => string | null,
): Promise<string | null> {
  if (!tool) return null;
  try {
    const text = toolResultText(await tool.execute("prefetch", params));
    // A condenser reshapes the rows itself and is NOT line-capped by `digest`:
    // it already emits one short line per group.
    if (condense) return condense(scrub(text));
    return digest(scrub(text));
  } catch (err) {
    log.warn(`[prefetch] ${label} resolver failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Tools are mounted under a server-prefixed name (`Xyne_Spaces__spaces-vespa-search`). */
function findTool(tools: ExecutableTool[], bareName: string): ExecutableTool | undefined {
  return tools.find((t) => t.name === bareName || t.name.endsWith(`__${bareName}`));
}

/**
 * Resolve the spec against live tools and render the block appended to the
 * model's first user message. Returns null when there is nothing worth saying.
 *
 * Identity is emitted even with no spec: it is free (already in the run payload)
 * and removes the `spaces-whoami` round trip on its own.
 */
/**
 * Collapse a rendered `message` search into the CHANNELS those hits came from.
 *
 * The name resolvers answer "what is CALLED x". This answers "where is x
 * TALKED ABOUT" — the case they all miss: an entity discussed inside a channel
 * whose name has nothing to do with it (measured locally: "InfraSwitch",
 * "Ceph" and "sovereignty" each matched 0 channels by name while being
 * discussed in a real one).
 *
 * The raw result is the wrong shape for a prefetch block — 8 hits is tens of KB
 * of message bodies. Everything except the channel identity is dropped, so the
 * section costs one line per distinct channel instead of `digest`'s 24-line cap.
 * Ordering is by how many of the top hits landed in each channel, which is a
 * relevance proxy: the rows are already ranked, so this counts the ranked
 * sample, never the corpus (rule: a prefetch count is a hint, never a fact).
 */
export function condenseMentions(text: string, max = 5): string | null {
  if (!text) return null;
  const order: string[] = [];
  const seen = new Map<string, { name: string; hits: number }>();
  let pendingName: string | null = null;
  for (const line of text.split("\n")) {
    const head = line.match(/\[message\]\s+(.+?)\s+—/);
    if (head) { pendingName = (head[1] ?? "").trim(); continue; }
    const id = line.match(/^\s*channelId:\s*(\S+)\s*$/);
    if (!id) continue;
    const key = id[1] ?? "";
    if (!key) continue;
    const existing = seen.get(key);
    if (existing) existing.hits += 1;
    else { seen.set(key, { name: pendingName ?? "(unnamed)", hits: 1 }); order.push(key); }
    pendingName = null;
  }
  if (seen.size === 0) return null;
  const total = [...seen.values()].reduce((n, v) => n + v.hits, 0);
  const rows = order
    .map((id) => ({ id, ...seen.get(id)! }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, max)
    .map((r) => `#${r.name} — channelId: ${r.id} (${r.hits}/${total} top hits)`);
  return rows.join("\n");
}

export async function buildPrefetchBlock(opts: {
  spec: PrefetchSpec | null;
  tools: ExecutableTool[];
  identity: PrefetchIdentity;
}): Promise<string | null> {
  const { spec, tools, identity } = opts;
  const sections: string[] = [];

  const who = [
    `- You are: ${identity.userName ?? "unknown"}`,
    identity.userEmail ? ` <${identity.userEmail}>` : "",
    ` — Spaces user id \`${identity.userId}\``,
  ].join("");
  sections.push(who);

  // Gate on ENTITIES, not on intent. Intent is a label the extractor guesses and
  // gets wrong on terse questions — "why namma cloud" came back
  // `{intent: "conversational", entities: []}`, which silently skipped every
  // resolver and shipped an identity-only block. Entities is the thing the
  // resolvers actually consume: empty means there is nothing to look up (so a
  // real greeting still costs no calls), non-empty means resolve regardless of
  // what the extractor called it.
  if (spec && spec.entities.length > 0) {
    // ONE budget for every round, so adding the hop below can never push the
    // first turn out. Each round races the time that is actually left.
    const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
    const raceRemaining = async <T>(jobs: Array<Promise<T>>): Promise<PromiseSettledResult<T>[]> => {
      const left = deadline - Date.now();
      if (left <= 0 || jobs.length === 0) return [];
      return Promise.race([
        Promise.allSettled(jobs),
        new Promise<PromiseSettledResult<T>[]>((r) => setTimeout(() => r([]), left)),
      ]);
    };

    // Every name against every resolver. Only the ones that return rows make it
    // into the block, so the block is self-labelling: the section heading says
    // what the thing turned out to BE, and nothing had to guess up front.
    // All three resolvers are Vespa, using STRUCTURED name filters rather than
    // free-text `query`: a filter is a deterministic match on the name field,
    // where `query` would be ranked retrieval whose top hit is not guaranteed
    // to be the entity meant. Channel and user names map to 3-gram fuzzy
    // indexes server-side, so partial names and typos still resolve.
    // `searchArea` is singular, hence one call per area.
    const resolvers: Array<{
      kind: ResolvedKind;
      area: string;
      filters: (name: string) => Record<string, unknown>;
      label: (n: string) => string;
      /** Free-text ranked query instead of a structured name filter. */
      query?: (name: string) => string;
      hits?: number;
      /** Column projection — skips the summary fetch for bodies we never read. */
      fields?: string[];
      /** Replaces the default scrub+digest when the rows need reshaping. */
      condense?: (text: string) => string | null;
    }> = [
      // `mine: true` narrows the channel guard from the area default —
      // `(permissions contains <me> or isPrivate contains "false")` — down to
      // `permissions contains <me>`, i.e. the SAME guard the `message` area
      // applies. Without it prefetch resolves public channels the caller never
      // joined: the channel row passes on the isPrivate branch, but every
      // message inside fails the strict message ACL. Measured locally on the
      // namma-cloud project: the 5 channels `mine` drops held 0 readable
      // messages each, while the 2 it keeps held 7621 and 3590. Handing the
      // model a dead id is worse than omitting it — it scopes a search there,
      // gets nothing, and reads that as "nothing was discussed" rather than
      // "no access".
      { kind: "channels", area: "channel", filters: (n) => ({ channelName: { contains: n }, mine: { eq: true } }), label: (n) => `Channels matching "${n}"` },
      { kind: "projects", area: "project", filters: (n) => ({ name: { contains: n } }), label: (n) => `Projects matching "${n}"` },
      { kind: "people", area: "user", filters: (n) => ({ name: { contains: n } }), label: (n) => `People matching "${n}"` },
      // Content probe. The three above match NAMES; this one matches what people
      // actually wrote, so an entity discussed inside a channel not named after
      // it still resolves to a usable channelId. Measured locally: "InfraSwitch",
      // "Ceph" and "sovereignty" each matched 0 channels by name while being
      // actively discussed in one. Ranked retrieval on purpose — `userInput` ORs
      // its terms, so for a multi-word entity the match set is near-everything
      // and only the ORDERING carries signal; counting the corpus would be
      // meaningless (and rule 6 forbids reporting it anyway).
      {
        kind: "mentions",
        area: "message",
        filters: () => ({}),
        query: (n) => n,
        hits: MENTION_PROBE_HITS,
        fields: MENTION_PROBE_FIELDS,
        condense: (t) => condenseMentions(t),
        label: (n) => `Channels discussing "${n}"`,
      },
    ];
    const vespa = findTool(tools, "spaces-vespa-search");

    const round1: Array<Promise<ResolvedSection>> = [];
    for (const name of spec.entities) {
      for (const r of resolvers) {
        const params: Record<string, unknown> = {
          searchArea: r.area,
          filters: r.filters(name),
          hits: r.hits ?? RESOLVER_LIMIT,
        };
        if (r.query) params["query"] = r.query(name);
        if (r.fields) params["fields"] = r.fields;
        round1.push(
          runResolver(
            vespa,
            params,
            `spaces-vespa-search(${r.area})`,
            r.condense,
          ).then((body) => ({ kind: r.kind, heading: r.label(name), body })),
        );
      }
    }

    const settled1 = await raceRemaining(round1);
    if (settled1.length === 0 && round1.length > 0) {
      log.warn(`[prefetch] resolvers exceeded ${RESOLVE_TIMEOUT_MS}ms — shipping identity only`);
    }
    const found = settled1
      .filter((r): r is PromiseFulfilledResult<ResolvedSection> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((v) => v.body);

    // ── Graph hop: project → its name + its channels (one level, never recursive) ────
    // The user names ONE thing; the answer usually needs its neighbours. Run 2
    // spent separate turns discovering the project id AND the channel ids for
    // a single named entity.
    //
    // Two lookups per project, fired in the SAME round so they cost one
    // round trip, not two:
    //   - channels in the project — Vespa's `channel` area takes a `projectId`
    //     filter, an exact structured match rather than the naming-convention
    //     guess that searching by name would be;
    //   - the project's own row, purely for its NAME. A channel row prints
    //     `projectId:` as a bare id and nothing else, so without this every
    //     mention of the project — the hop heading included — was an opaque
    //     cuid the model had to spend a turn resolving. The `project` area maps
    //     `projectId` onto `docId`, and that field only accepts `in`.
    const hops: Array<Promise<HopResult>> = [];
    const projectIds: string[] = [];
    for (const section of found) {
      if (!section.body) continue;
      for (const m of section.body.matchAll(/^\s*projectId:\s*([A-Za-z0-9_-]{6,})\s*$/gm)) {
        const id = (m[1] ?? "").trim();
        if (projectIds.includes(id)) continue;
        projectIds.push(id);
        if (projectIds.length >= MAX_HOPS) break;
      }
      if (projectIds.length >= MAX_HOPS) break;
    }
    for (const projectId of projectIds) {
      hops.push(
        runResolver(
          vespa,
          {
            searchArea: "channel",
            // Same membership narrowing as the name resolver above.
            filters: { projectId: { contains: projectId }, mine: { eq: true } },
            hits: RESOLVER_LIMIT,
            sort: { by: "lastActiveDate", dir: "desc" },
          },
          "spaces-vespa-search(channel by project)",
        ).then((body) => ({ hop: "channels" as const, projectId, body })),
      );
      hops.push(
        runResolver(
          vespa,
          { searchArea: "project", filters: { projectId: { in: [projectId] } }, hits: 1 },
          "spaces-vespa-search(project by id)",
        ).then((body) => ({ hop: "name" as const, projectId, name: parseProjectName(body) })),
      );
    }

    // Names are collected before any heading is rendered, so a name that
    // arrives inside the budget always reaches BOTH the heading and the inline
    // `projectId:` lines; one that does not simply leaves the id-only text.
    const projectNames = new Map<string, string>();
    if (hops.length > 0) {
      log.info(`[prefetch] hop project→channels+name for ${projectIds.length} project(s)`);
      const channelHops: Array<{ projectId: string; body: string }> = [];
      for (const r of await raceRemaining(hops)) {
        if (r.status !== "fulfilled") continue;
        const v = r.value;
        if (v.hop === "name") {
          if (v.name) projectNames.set(v.projectId, v.name);
        } else if (v.body) {
          channelHops.push({ projectId: v.projectId, body: v.body });
        }
      }
      for (const { projectId, body } of channelHops) {
        const name = projectNames.get(projectId);
        found.push({
          kind: "channels",
          heading: `Channels in project ${name ? `"${name}" (${projectId})` : projectId} (most recently active first)`,
          body,
        });
      }
    }

    for (const section of found) {
      sections.push(`- ${section.heading}:\n${indent(annotateProjectIds(section.body as string, projectNames))}`);
    }
  }

  // Identity alone is worth emitting (it deletes the whoami turn), but say so
  // in the log so a run with a failed extractor is distinguishable from one
  // where the question simply named nothing.
  if (sections.length === 1) log.info("[prefetch] identity-only block");

  const block = [
    "## Resolved context (prefetched — treat as a hint, verify before relying on it)",
    ...sections,
  ].join("\n");

  if (block.length > MAX_BLOCK_CHARS) {
    log.warn(`[prefetch] block ${block.length} chars exceeds cap — truncating`);
    // Cut on a line boundary. A raw slice can land mid-id and hand the model a
    // half-written `channelId:` that looks real and resolves to nothing.
    const cut = block.slice(0, MAX_BLOCK_CHARS);
    const lastBreak = cut.lastIndexOf("\n");
    return `${lastBreak > 0 ? cut.slice(0, lastBreak) : cut}\n… (truncated)`;
  }
  return block;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

/** `agentConfig.prefetchContext` — off unless explicitly enabled. */
export function prefetchEnabled(agentConfig: Record<string, unknown> | undefined): boolean {
  return agentConfig?.["prefetchContext"] === true || agentConfig?.["prefetchContext"] === "true";
}
