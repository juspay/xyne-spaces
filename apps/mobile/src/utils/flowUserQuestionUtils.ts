import type { FlowAction } from '@xyne/shared';

import type {
  FlowComponentLike,
  FlowDefinitionLike,
  FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

export type UserQuestionPhase = 'pending' | 'answered' | 'declined';
export type UserQuestionType = 'single_choice' | 'multiple_choice' | 'open_ended';

export type UserQuestionOption = {
  label: string;
  description?: string;
};

export type UserQuestionItem = {
  id: string;
  label?: string;
  question: string;
  type: UserQuestionType;
  options: UserQuestionOption[];
  placeholder?: string;
  required: boolean;
};

export type UserQuestionViewModel = {
  title: string;
  phase: UserQuestionPhase;
  questions: UserQuestionItem[];
  showActions: boolean;
  submitAction: FlowAction | null;
  persistedAnswers: Record<string, string | string[]>;
  persistedNotes: Record<string, string>;
  /** Terminal footer label: "Submitted by" | "Dismissed by". */
  submitterLabel?: string;
  /** Spaces user id for the avatar — from flow.data.userId (dashboard parity). */
  submitterUserId?: string;
  /** Display-name fallback from props.decidedBy when the user directory is cold. */
  submitterNameFallback?: string;
  /** @deprecated Prefer submitterLabel + avatar; kept for markdown/previews. */
  auditLine?: string;
};

export const SKIP_QUESTION_LABEL = 'Skip this question';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const getStringProp = (props: Record<string, unknown> | undefined, key: string): string =>
  optionalString(props?.[key]) ?? '';

const parseQuestionType = (value: unknown): UserQuestionType => {
  if (value === 'multiple_choice' || value === 'open_ended') return value;
  return 'single_choice';
};

export const parseQuestionOption = (value: unknown): UserQuestionOption | null => {
  if (typeof value === 'string' && value.trim()) {
    return { label: value.trim() };
  }
  if (!isRecord(value)) return null;
  const label = getStringProp(value, 'label');
  if (!label) return null;
  const description = optionalString(value['description']);
  return description ? { label, description } : { label };
};

export const parseUserQuestionItems = (
  props: Record<string, unknown> | undefined,
): UserQuestionItem[] => {
  const rawQuestions = Array.isArray(props?.['questions']) ? props['questions'] : [];
  return rawQuestions
    .filter(isRecord)
    .map(rawQuestion => {
      const id = getStringProp(rawQuestion, 'id');
      const question = getStringProp(rawQuestion, 'question');
      if (!id || !question) return null;

      const type = parseQuestionType(rawQuestion['type']);
      const options =
        type === 'open_ended'
          ? []
          : (Array.isArray(rawQuestion['options']) ? rawQuestion['options'] : [])
              .map(parseQuestionOption)
              .filter((option): option is UserQuestionOption => option !== null)
              .filter(option => option.label !== SKIP_QUESTION_LABEL);

      const label = optionalString(rawQuestion['label']);
      const placeholder = optionalString(rawQuestion['placeholder']);
      const required = rawQuestion['required'] !== false;

      return {
        id,
        question,
        type,
        options,
        required,
        ...(label ? { label } : {}),
        ...(placeholder ? { placeholder } : {}),
      };
    })
    .filter((item): item is UserQuestionItem => item !== null);
};

export const findUserQuestionComponent = (
  components: FlowComponentLike[] | undefined,
): FlowComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'user_question') return component;
    const nested = findUserQuestionComponent(component.children);
    if (nested) return nested;
  }
  return undefined;
};

export const isUserQuestionFlow = (flow: FlowDefinitionLike): boolean => {
  if (flow.data?.['actionType'] === 'user-answer') return true;
  const screenId = typeof flow.screenId === 'string' ? flow.screenId.trim() : '';
  if (screenId.startsWith('user-question')) return true;
  return findUserQuestionComponent(flow.components) !== undefined;
};

export const canUserActOnUserQuestion = (
  flow: FlowDefinitionLike,
  currentUserId?: string,
): boolean => {
  const ownerId = optionalString(flow.data?.['userId']);
  if (!ownerId) return true;
  return Boolean(currentUserId && currentUserId === ownerId);
};

export const parseUserQuestionPhase = (value: unknown): UserQuestionPhase => {
  if (value === 'answered' || value === 'declined') return value;
  return 'pending';
};

const readPersistedRecord = (value: unknown): Record<string, string | string[]> => {
  if (!isRecord(value)) return {};
  const record: Record<string, string | string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      record[key] = entry;
      continue;
    }
    if (Array.isArray(entry)) {
      record[key] = entry.map(String).filter(Boolean);
    }
  }
  return record;
};

const readPersistedNotes = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) record[key] = entry.trim();
  }
  return record;
};

export const parseSubmitAction = (
  props: Record<string, unknown> | undefined,
): FlowAction | null => {
  const action = props?.['submitAction'];
  if (!isRecord(action) || action['type'] !== 'submit') return null;
  const actionId = optionalString(action['actionId']);
  return actionId ? { type: 'submit', actionId } : null;
};

export const isQuestionComplete = (
  question: UserQuestionItem,
  answers: Record<string, string | string[]>,
  notes: Record<string, string>,
): boolean => {
  const note = notes[question.id]?.trim() ?? '';
  if (note.length > 0) return true;

  const answer = answers[question.id];
  if (typeof answer === 'string') return answer.trim().length > 0;
  if (Array.isArray(answer)) return answer.length > 0;
  return false;
};

/**
 * Drop blank string / empty-array answers before POST /apps/flow/action.
 * Backend treats `answers[id] === ''` as an invalid option even when notes
 * carry a "Something else" reply (400).
 */
export const sanitizeUserQuestionAnswers = (
  answers: Record<string, unknown> | undefined,
): Record<string, string | string[]> => {
  if (!answers || typeof answers !== 'object') return {};
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const cleaned = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(Boolean);
      if (cleaned.length > 0) next[key] = cleaned;
    }
  }
  return next;
};

export const findFirstIncompleteRequiredQuestionIndex = (
  questions: UserQuestionItem[],
  answers: Record<string, string | string[]>,
  notes: Record<string, string>,
): number =>
  questions.findIndex(
    question => question.required && !isQuestionComplete(question, answers, notes),
  );

export const formatQuestionAnswerSummary = (
  question: UserQuestionItem,
  answers: Record<string, string | string[]>,
  notes: Record<string, string>,
  phase: UserQuestionPhase,
): string => {
  if (phase === 'declined') return 'Dismissed';

  const parts: string[] = [];
  const answer = answers[question.id];
  if (typeof answer === 'string' && answer.trim()) {
    parts.push(answer.trim());
  } else if (Array.isArray(answer) && answer.length > 0) {
    parts.push(answer.join(', '));
  }

  const note = notes[question.id]?.trim();
  if (note) parts.push(note);

  return parts.length > 0 ? parts.join(', ') : '—';
};

export const createUserQuestionViewModel = (
  component: FlowComponentLike,
  flow: FlowDefinitionLike,
  options: { currentUserId?: string } = {},
): UserQuestionViewModel | null => {
  if (component.type !== 'user_question') return null;

  const props = isRecord(component.props) ? component.props : undefined;
  const questions = parseUserQuestionItems(props);
  if (questions.length === 0) return null;

  const submitAction = parseSubmitAction(props);
  const phase = parseUserQuestionPhase(props?.['phase']);
  if (phase === 'pending' && !submitAction) return null;

  const title = getStringProp(props, 'title') || 'Question';
  const decidedBy = optionalString(props?.['decidedBy']);
  const decidedById = optionalString(props?.['decidedById']);
  const dataUserId = optionalString(flow.data?.['userId']);
  const submitterUserId = decidedById ?? dataUserId;
  const submitterLabel =
    phase === 'answered' ? 'Submitted by' : phase === 'declined' ? 'Dismissed by' : undefined;
  const auditLine =
    submitterLabel && (decidedBy || submitterUserId)
      ? `${submitterLabel} ${decidedBy ? `@${decidedBy}` : ''}`.trim()
      : undefined;

  return {
    title,
    phase,
    questions,
    showActions: phase === 'pending' && canUserActOnUserQuestion(flow, options.currentUserId),
    submitAction,
    persistedAnswers: readPersistedRecord(props?.['answers']),
    persistedNotes: readPersistedNotes(props?.['notes']),
    ...(submitterLabel ? { submitterLabel } : {}),
    ...(submitterUserId ? { submitterUserId } : {}),
    ...(decidedBy ? { submitterNameFallback: decidedBy } : {}),
    ...(auditLine ? { auditLine } : {}),
  };
};

export const userQuestionComponentToMarkdown = (
  component: FlowComponentLike,
  options: FlowTextNormalizationOptions = {},
): string => {
  if (component.type !== 'user_question') return '';

  const props = isRecord(component.props) ? component.props : undefined;
  const questions = parseUserQuestionItems(props);
  if (questions.length === 0) return '';

  const phase = parseUserQuestionPhase(props?.['phase']);
  const title = getStringProp(props, 'title') || 'Question';
  const answers = readPersistedRecord(props?.['answers']);
  const notes = readPersistedNotes(props?.['notes']);
  const lines = [`# ${title}`];

  for (const question of questions) {
    lines.push(`**${question.question}**`);
    lines.push(formatQuestionAnswerSummary(question, answers, notes, phase));
  }

  if (!options.omitButtons && phase === 'pending') {
    lines.push('**Submit**');
  }

  return lines.filter(line => line.trim().length > 0).join('\n\n');
};

export const userQuestionFlowToMarkdown = (
  flow: FlowDefinitionLike,
  options: FlowTextNormalizationOptions = {},
): string => {
  const component = findUserQuestionComponent(flow.components);
  if (!component) return '';
  return userQuestionComponentToMarkdown(component, options);
};
