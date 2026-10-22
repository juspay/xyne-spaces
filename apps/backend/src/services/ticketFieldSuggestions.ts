import {
  ClassifiableTicketTypes,
  countTicketWords,
  TICKET_FIELD_SUGGESTION_MIN_WORDS,
  type ClassifiableTicketType,
} from '@xyne/shared';
import { BOARD_TASK_INSTRUCTION, buildPrompt } from '@/agents/ticket-board';
import { TICKET_TYPE_DESCRIPTIONS } from '@/services/agents/prompts';
import { isPrivateDecisionEngineConfigured } from '@/services/decision/targets';
import { askDecision } from '@/services/decision/ask';
import type { DecisionAnswer, DecisionQuestion } from '@/services/decision/types';

const XOR_TIMEOUT_MS = 10_000;
const XOR_MAX_OPTIONS = 255;
const BOARD_MIN_CONFIDENCE = 0.9;
const TICKET_TYPE_MIN_CONFIDENCE = 0.8;

export interface TicketFieldSuggestionInput {
  title: string;
  description: string;
  boards: { id: string; name: string; description?: string }[];
}

interface TicketFieldSuggestions {
  board?: { id: string; confidence: number };
  ticketType?: { type: ClassifiableTicketType; confidence: number };
}

function confidentChoice(
  answer: DecisionAnswer | undefined,
  minConfidence: number,
): { choice: string; confidence: number } | undefined {
  if (answer?.type !== 'choice' || answer.confidence === undefined) return undefined;
  return answer.confidence >= minConfidence ? { choice: answer.choice, confidence: answer.confidence } : undefined;
}

export async function suggestTicketFields(
  { title, description, boards }: TicketFieldSuggestionInput,
  signal?: AbortSignal,
): Promise<TicketFieldSuggestions> {
  if (!isPrivateDecisionEngineConfigured() || countTicketWords(`${title} ${description}`) < TICKET_FIELD_SUGGESTION_MIN_WORDS) {
    return {};
  }

  const questions: Record<string, DecisionQuestion> = {
    ticketType: {
      type: 'choice',
      instructions: 'Classify the ticket type.',
      criteria: Object.fromEntries(ClassifiableTicketTypes.map(type => [type, TICKET_TYPE_DESCRIPTIONS[type]])),
    },
  };
  if (boards.length >= 2 && boards.length <= XOR_MAX_OPTIONS) {
    questions.board = {
      type: 'choice',
      instructions: BOARD_TASK_INSTRUCTION,
      criteria: Object.fromEntries(
        boards.map(board => [board.id, board.description ? `${board.name}: ${board.description}` : board.name]),
      ),
    };
  }

  const state = buildPrompt({ title, description, candidates: boards });
  const answers = await askDecision('ticket_fields', state, questions, XOR_TIMEOUT_MS, signal, { partial: true });

  const board = confidentChoice(answers?.board, BOARD_MIN_CONFIDENCE);
  const ticketType = confidentChoice(answers?.ticketType, TICKET_TYPE_MIN_CONFIDENCE);
  return {
    ...(board && { board: { id: board.choice, confidence: board.confidence } }),
    ...(ticketType && {
      ticketType: { type: ticketType.choice as ClassifiableTicketType, confidence: ticketType.confidence },
    }),
  };
}
