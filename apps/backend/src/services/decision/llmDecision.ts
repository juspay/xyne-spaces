// import { LLMClient, createUserMessage } from '@framework'; // framework removed
// import { config as envConfig } from '@/config/env';
import type { DecisionAnswer, DecisionQuestion, LlmReply } from './types';

/** The classification agents' default model, so the classifiers are measured against what they replace. */
export const LLM_DECISION_MODEL = 'glm-flash-experimental';
const LLM_DECISION_TIMEOUT_MS = 30_000;

// const SYSTEM_PROMPT = [
//   'You are given a STATE and QUESTIONS about it. Answer every question using only the STATE. Do not explain.',
//   'Reply with one JSON object: {"answers": {"<question id>": <answer>}}.',
//   'A yes/no question: {"noul": p}, where p is the probability from 0 to 1 that the answer is yes.',
//   'A choice question: {"choice": "<option id>"}, exactly one of the listed ids.',
//   'A score question: {"level": i}, the index of the level that fits, 0 being the first.',
// ].join('\n');
//
// LLM framework removed; original kept below.
export const isLlmDecisionConfigured = (): boolean => false;
// export const isLlmDecisionConfigured = (): boolean =>
//   Boolean(envConfig.litellm.baseUrl && envConfig.litellm.apiKey);

// const renderQuestion = (id: string, question: DecisionQuestion): string => {
//   const head = `- id: ${id}\n  question: ${question.instructions}`;
//   if (question.type === 'choice') {
//     const options = Object.entries(question.criteria).map(([key, meaning]) => `    ${key}: ${meaning}`);
//     return `${head}\n  type: choice\n  options:\n${options.join('\n')}`;
//   }
//   if (question.type === 'score') {
//     const levels = question.criteria.map((level, i) => `    ${i}: ${level}`);
//     return `${head}\n  type: score\n  levels:\n${levels.join('\n')}`;
//   }
//   return `${head}\n  type: yes/no`;
// };
//
/** A yes/no as a probability: a number, a boolean, or "yes"/"no". */
const toProbability = (value: unknown): number => {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && /^(yes|no|true|false)$/i.test(value.trim())) return /^(yes|true)$/i.test(value.trim()) ? 1 : 0;
  return Number(value);
};

const readAnswer = (question: DecisionQuestion, raw: unknown): DecisionAnswer | null => {
  if (raw === null || raw === undefined) return null;
  // Models often skip the wrapper and reply with the bare value: "is_bug": 1, "team": "backend".
  const field = question.type === 'noul' ? 'noul' : question.type === 'choice' ? 'choice' : 'level';
  const value = typeof raw === 'object' ? (raw as Record<string, unknown>)[field] : raw;
  if (question.type === 'noul') {
    const p = toProbability(value);
    return Number.isFinite(p) && p >= 0 && p <= 1 ? { type: 'noul', noul: p } : null;
  }
  if (question.type === 'choice') {
    const isOption = typeof value === 'string' && Object.prototype.hasOwnProperty.call(question.criteria, value);
    return isOption ? { type: 'choice', choice: value, probabilities: {} } : null;
  }
  const level = Number(value);
  const top = question.criteria.length - 1;
  return Number.isInteger(level) && level >= 0 && level <= top && top > 0
    ? { type: 'score', score: level / top, level }
    : null;
};

/** The usable answers in the LLM's reply, keyed like `questions`; null when there are none. */
export const parseLlmAnswers = (
  content: string,
  questions: Record<string, DecisionQuestion>
): Record<string, DecisionAnswer> | null => {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: Record<string, unknown> | undefined;
  try {
    raw = (JSON.parse(cleaned.slice(start, end + 1)) as { answers?: Record<string, unknown> }).answers;
  } catch {
    return null;
  }
  const answers: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = readAnswer(question, raw?.[id]);
    if (answer) answers[id] = answer;
  }
  return Object.keys(answers).length > 0 ? answers : null;
};

/** The LLM's answers to the same typed questions the classifiers get, on LITELLM_*. Throws on failure. */
export async function requestLlmAnswers(
  _state: string | Record<string, unknown>,
  _questions: Record<string, DecisionQuestion>,
  _timeoutMs = LLM_DECISION_TIMEOUT_MS
): Promise<LlmReply<Record<string, DecisionAnswer>>> {
  // LLM framework removed; original kept below.
  throw new Error('LLM client is not configured');
  //   const client = new LLMClient({
  //     provider: {
  //       type: 'litellm',
  //       config: { apiKey: envConfig.litellm.apiKey, baseUrl: envConfig.litellm.baseUrl, timeout: timeoutMs },
  //     },
  //     defaultModel: LLM_DECISION_MODEL,
  //   });
  //   const stateText = typeof state === 'string' ? state : JSON.stringify(state, null, 2);
  //   const questionText = Object.entries(questions).map(([id, question]) => renderQuestion(id, question));
  //   const response = await client.generate({
  //     messages: [createUserMessage(`STATE:\n${stateText}\n\nQUESTIONS:\n${questionText.join('\n')}`)],
  //     systemPrompt: SYSTEM_PROMPT,
  //     parameters: { temperature: 0 },
  //     extraBody: { chat_template_kwargs: { enable_thinking: false } },
  //   });
  //   return { answer: parseLlmAnswers(response.content, questions), model: response.model, usage: response.usage };
  }
