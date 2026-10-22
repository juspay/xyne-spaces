import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";
import { LITELLM, litellmEndpoint } from "./config.js";

/**
 * The routing card for agent proactivity: a few lines Spaces matches channel questions
 * against to pick an agent nobody tagged. Written from the agent's own setup, because a
 * small classifier reading a whole prompt says yes to almost everything, and owners'
 * one-line descriptions rarely name the product or the sources.
 */

export const ROUTING_CARD_MAX_CHARS = 2000;

/** What the prompt asks for; the gap to the max is slack for a model that runs over. */
const ROUTING_CARD_TARGET_CHARS = 1000;

/** The prompt is the longest input; past this it is mostly style and formatting rules. */
const PROMPT_MAX_CHARS = 20_000;

const SYSTEM_PROMPT = `You write the routing card for an AI agent. A small classifier reads the card next to a chat message and decides whether this agent should answer it without being tagged. Precision matters more than coverage: a card that sounds like it fits everything is useless.

From the agent's name, its owner's short description, its instructions, its tools and its skills, write at most ${ROUTING_CARD_TARGET_CHARS} characters, each line under 400, in exactly this shape:
Product/area: <the one product, codebase, team or domain it is for, by the name its users know it; for a codebase, the product built from it and the parts of that product people use, like its apps, screens and features>
Answers: <the kinds of questions it answers, concrete, 1-2 lines>
Problems: <the kinds of problems people report that it investigates or fixes, in the words they would use, 1-2 lines; or "none">
Not for: <nearby things it does NOT handle, including other products, and anything that is an action rather than an answer>
Sources: <what it reads to answer: repos, logs, dashboards, docs, tools>

You may also get questions people asked this agent when they tagged it in a channel, each with the start of its reply. They are the best evidence of what it is asked and in which words. Where it answered or looked into it, the question belongs under Answers or Problems; where it said the question is outside what it does, could not help, or pointed to someone or something else, it belongs under Not for. Sum them up as a few broad kinds, by the part of the product they are about and the kind of question or failure, so that a new message of the same kind matches too, in the words people use. Never list single reports, and never copy a message or name a person, customer or one-off detail. Leave out the odd question that its instructions do not support.

Rules: only use what the instructions, tools, skills and those questions support; never invent sources. Name the product explicitly. People rarely name the product or the repo; they name the part they use and say what went wrong, so the card must let a reader match those messages. An agent that investigates or fixes reported problems handles those reports: list them under Problems. If the agent mainly performs other actions (posting, creating tickets, reviewing PRs, announcing releases), write "Answers: none, it performs <action>" and "Problems: none". No preamble.`;

export interface RoutingCardInput {
  name: string;
  description: string;
  systemPrompt: string;
  /** Tool, connector, subagent and callable-agent names. */
  tools: string[];
  /** Attached skills as "name: description". */
  skills?: string[];
  /** Questions people tagged it with in public channels, newest first, with the start of its reply. */
  asked?: Array<{ question: string; reply?: string }>;
}

export async function generateRoutingCard(input: RoutingCardInput): Promise<string> {
  const user = [
    `Name: ${input.name}`,
    `Owner's description: ${input.description.trim() || "(none)"}`,
    `Tools: ${input.tools.length > 0 ? input.tools.join(", ") : "(none listed)"}`,
    `Skills: ${input.skills?.length ? input.skills.join("; ") : "(none)"}`,
    "Instructions:",
    input.systemPrompt.slice(0, PROMPT_MAX_CHARS),
    ...(input.asked?.length
      ? [
          "",
          "Questions people asked it, and how it replied:",
          ...input.asked.map((a) => `- Q: ${a.question}${a.reply ? `\n  Reply: ${a.reply}` : ""}`),
        ]
      : []),
  ].join("\n");
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
  let card = await complete(messages);
  // Over the limit after this, the cut falls on Sources, the last line and the least
  // useful one for routing; Not for, which keeps routing precise, comes before it.
  if (card.length > ROUTING_CARD_TARGET_CHARS) {
    card = await complete([
      ...messages,
      { role: "assistant", content: card },
      {
        role: "user",
        content: `That is ${card.length} characters. Rewrite it under ${ROUTING_CARD_TARGET_CHARS}, keeping every line.`,
      },
    ]);
  }
  return card.slice(0, ROUTING_CARD_MAX_CHARS);
}

async function complete(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetchLiteLLMWithRetry(
    litellmEndpoint("/v1/chat/completions"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LITELLM.apiKey}` },
      body: JSON.stringify({
        model: LITELLM.model,
        messages,
        // Reasoning models spend most of this before they write a word.
        max_tokens: 8000,
        temperature: 0,
      }),
    },
    { timeoutMs: 180_000, label: "generate-routing-card" },
  );
  if (!res.ok) throw new Error(`LLM returned ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const card = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!card) throw new Error("LLM returned no card");
  return card;
}
