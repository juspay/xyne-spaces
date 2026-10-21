/**
 * Ticket thread summary agent — a short Problem / Details / Cause / Resolution summary
 * of a desk ticket's whole email thread, used to match related tickets.
 */

import { createUserMessage } from '@framework';
import { AgentsConfig } from '../config.js';
import { resolveOrgLLMClient } from '../llmClient.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { NO_DISTINGUISHING_DETAIL, UNKNOWN_CAUSE_KEY } from './summaryText';

const AGENT_NAME = 'TicketThreadSummary';

export const MAX_SUMMARY_LENGTH = 1000;

// Long threads keep their opening (the problem) and their end (the fix).
const THREAD_HEAD_LENGTH = 8_000;
const THREAD_TAIL_LENGTH = 16_000;

export interface TicketThreadSummaryContext {
  readonly userId: string;
  readonly projectId: string;
  /** Cause keys already used on this desk, most common first, so the summariser reuses them. */
  readonly knownCauseKeys?: readonly string[];
}

const SYSTEM_INSTRUCTIONS = `You summarise a customer support ticket so that other agents can find it when a similar ticket comes in, and see how it was handled.

The input is the cause keys already in use on this desk (if any), the ticket's form fields (if any), then its conversation, oldest first: emails or chat messages, phone calls given as a call summary or transcript, and internal team notes the customer never saw. Write exactly these five lines, plain text, no markdown:
Problem: <the specific issue the customer reported, in one sentence>
Details: <what tells this case apart: ids, error codes or messages, amounts, bank or payment method, product or feature, what was already tried; never a person's name, email address or phone number>
Cause: <why it happened, as the customer explained it or as support found; "Unknown" when nobody in the thread says why, including when the customer picked "Unclear" or said they do not know>
Resolution: <what support did or told the customer that settles the issue, otherwise "Not resolved yet">
CauseKey: <snake_case label of 2 to 5 words for the Cause, such as card_reissued_before_refund; "${UNKNOWN_CAUSE_KEY}" when Cause is Unknown>

Rules:
- Under 800 characters in total. Keep Details short rather than dropping Resolution.
- Resolution is the most useful line. Support's final reply usually holds it: a confirmation, a fix, a configuration change, or an instruction to the customer (such as tracing a refund with its ARN). Write "Not resolved yet" when support has not answered the problem, or has only acknowledged it, re-opened it, asked for more information, promised to investigate or review, escalated to another team, logged the complaint as feedback, said a warning will be issued, or sent an auto-acknowledgement.
- Leave out greetings, signatures, disclaimers, names, email addresses and phone numbers.
- Only state what the thread says; never guess a cause or a resolution.
- The customer's own explanation counts as the Cause ("the driver added waiting charges before pickup", "my card was reissued"); support's finding replaces it when the two differ. Keep Problem to what went wrong, Cause to why.
- Cause is a reason that could differ for another ticket with the same Problem. When the complaint is the whole story (a rude driver, an item left in the vehicle, a wrong charge with no reason given), write "Unknown" rather than repeating Problem.
- Problem is the concrete failure, never only a category: "charged a toll although the driver took a toll-free route", not "fare and payment issue". Use the form fields (category, sub-category, reason) to be precise.
- Details should carry whatever the thread gives: an order, transaction or policy id, an error code or message, an amount, a card type, bank or payment method, a product, page or feature, or what was already tried. Write exactly "Details: ${NO_DISTINGUISHING_DETAIL}" only when the thread gives none of these.
- CauseKey names the cause, not the symptom: refund_failed is a symptom, card_reissued_before_refund is a cause. Reuse a known cause key exactly when it fits; coin a new one only when none fits.
- Ignore automated messages (chatbot prompts, menu selections, auto-acknowledgements, system breakdowns, call logs) except where they confirm a fact. Summarise what the customer reported and what support did.
- A phone call's summary or transcript is part of the conversation. Internal team notes are support talking among themselves: use them for Cause and Resolution, but never present them as something the customer was told.
- If the customer gave no real detail, say so in Problem.
- Write in English even if the thread is in another language.`;

const clipThread = (thread: string): string =>
  thread.length <= THREAD_HEAD_LENGTH + THREAD_TAIL_LENGTH
    ? thread
    : `${thread.slice(0, THREAD_HEAD_LENGTH)}\n\n[...]\n\n${thread.slice(-THREAD_TAIL_LENGTH)}`;

const cleanOutput = (content: string): string =>
  content
    .replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH);

const withKnownCauseKeys = (thread: string, keys: readonly string[] | undefined): string =>
  keys && keys.length > 0
    ? `Known cause keys (labels for causes other tickets stated; reuse one only when this thread states that same cause, never to fill in an unknown cause): ${keys.join(', ')}\n\n${thread}`
    : thread;

export async function summarizeTicketThread(
  thread: string,
  context: TicketThreadSummaryContext,
  agentsConfig?: AgentsConfig,
): Promise<string> {
  const cacConfig = agentsConfig ?? (await AgentsConfig.fetch());
  const modelName = cacConfig.summariserModelName;
  const llmClient = await resolveOrgLLMClient({
    modelName,
    userId: context.userId,
    projectId: context.projectId,
  });

  logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');

  try {
    const response = await llmClient.generate({
      messages: [createUserMessage(withKnownCauseKeys(clipThread(thread), context.knownCauseKeys))],
      systemPrompt: SYSTEM_INSTRUCTIONS,
      parameters: { temperature: 0.1 },
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    });

    logLLMSuccess(AGENT_NAME, response.content);
    return cleanOutput(response.content);
  } catch (error) {
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}
