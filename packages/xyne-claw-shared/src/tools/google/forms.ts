/**
 * Google Forms API helpers — create/read/update forms.
 * Requires scope: https://www.googleapis.com/auth/forms.body
 */

import { googleFetch } from "./oauth.js";

const BASE = "https://forms.googleapis.com/v1";
const MAX_FORM_QUESTIONS_PER_REQUEST = 50;
const MAX_FORM_TITLE_CHARS = 300;
const MAX_FORM_OPTION_COUNT = 100;

export type FormQuestionType = "SHORT_ANSWER" | "PARAGRAPH" | "EMAIL" | "DROPDOWN" | "MULTIPLE_CHOICE" | "CHECKBOX";

export interface FormQuestion {
  title: string;
  type: FormQuestionType;
  required?: boolean;
  options?: string[];
}

// Subtree of forms.get item[].questionItem.question — mirrors the Google Forms API
// `Question` union so getForm can surface type/options/required instead of dropping them.
interface FormChoiceOption {
  value?: string;
  isOther?: boolean;
}
interface FormChoiceQuestion {
  type?: string; // RADIO | CHECKBOX | DROP_DOWN
  options?: FormChoiceOption[];
  shuffle?: boolean;
}
interface FormTextQuestion {
  paragraph?: boolean; // true = long-answer (PARAGRAPH), false/absent = short-answer
}
interface FormScaleQuestion {
  low?: number;
  high?: number;
  lowLabel?: string;
  highLabel?: string;
}
interface FormDateQuestion {
  includeTime?: boolean;
  includeYear?: boolean;
}
interface FormTimeQuestion {
  duration?: boolean;
}
interface FormQuestionNode {
  questionId?: string;
  required?: boolean;
  choiceQuestion?: FormChoiceQuestion;
  textQuestion?: FormTextQuestion;
  scaleQuestion?: FormScaleQuestion;
  dateQuestion?: FormDateQuestion;
  timeQuestion?: FormTimeQuestion;
  fileUploadQuestion?: unknown;
}
interface FormItem {
  itemId?: string;
  title?: string;
  description?: string; // per-item description (distinct from form-level info.description)
  questionItem?: { question?: FormQuestionNode };
  questionGroupItem?: unknown; // grid of sub-questions
  pageBreakItem?: unknown; // section header / page break
  textItem?: unknown; // static text block
  imageItem?: unknown;
  videoItem?: unknown;
}

interface FormResponse {
  formId: string;
  responderUri?: string;
  // info.description is returned by the API but was previously never surfaced.
  info?: { title?: string; documentTitle?: string; description?: string };
  items?: FormItem[];
}

function buildQuestionItem(q: FormQuestion): Record<string, unknown> {
  if (!q.title.trim()) throw new Error("Question title cannot be empty");
  const required = q.required ?? false;
  if (q.type === "PARAGRAPH") {
    return { title: q.title, questionItem: { question: { required, textQuestion: { paragraph: true } } } };
  }
  if (q.type === "SHORT_ANSWER" || q.type === "EMAIL") {
    return { title: q.title, questionItem: { question: { required, textQuestion: {} } } };
  }
  const options = (q.options ?? []).map((v) => ({ value: v }));
  if (options.length > MAX_FORM_OPTION_COUNT) {
    throw new Error(`Too many options in a question. Max ${MAX_FORM_OPTION_COUNT}.`);
  }
  const type = q.type === "DROPDOWN" ? "DROP_DOWN" : q.type === "CHECKBOX" ? "CHECKBOX" : "RADIO";
  return {
    title: q.title,
    questionItem: { question: { required, choiceQuestion: { type, options, shuffle: false } } },
  };
}

/** Create a form with title and optional questions. Returns form ID + responder URL. */
export async function createForm(
  token: string,
  title: string,
  questions: FormQuestion[] = [],
): Promise<string> {
  if (!title.trim()) throw new Error("Form title cannot be empty");
  if (title.length > MAX_FORM_TITLE_CHARS) {
    throw new Error(`Form title too long. Max ${MAX_FORM_TITLE_CHARS} characters.`);
  }
  if (questions.length > MAX_FORM_QUESTIONS_PER_REQUEST) {
    throw new Error(`Too many questions. Max ${MAX_FORM_QUESTIONS_PER_REQUEST} per request.`);
  }
  const created = (await googleFetch(`${BASE}/forms`, token, {
    method: "POST",
    body: JSON.stringify({ info: { title, documentTitle: title } }),
  })) as FormResponse;

  if (questions.length > 0) {
    const requests = questions.map((q, idx) => ({
      createItem: { item: buildQuestionItem(q), location: { index: idx } },
    }));
    await googleFetch(`${BASE}/forms/${encodeURIComponent(created.formId)}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }

  const full = (await googleFetch(`${BASE}/forms/${encodeURIComponent(created.formId)}`, token)) as FormResponse;
  const editorUrl = `https://docs.google.com/forms/d/${created.formId}/edit`;
  return [
    `Form created: ${title}`,
    `Form ID: ${created.formId}`,
    `Edit URL: ${editorUrl}`,
    `Responder URL: ${full.responderUri ?? "(unavailable)"}`,
    `Questions added: ${questions.length}`,
  ].join("\n");
}

/** Append questions to an existing form. */
export async function addQuestionsToForm(
  token: string,
  formId: string,
  questions: FormQuestion[],
): Promise<string> {
  if (!formId.trim()) throw new Error("formId is required");
  if (questions.length === 0) throw new Error("questions cannot be empty");
  if (questions.length > MAX_FORM_QUESTIONS_PER_REQUEST) {
    throw new Error(`Too many questions. Max ${MAX_FORM_QUESTIONS_PER_REQUEST} per request.`);
  }
  const existing = (await googleFetch(`${BASE}/forms/${encodeURIComponent(formId)}`, token)) as FormResponse;
  const startIdx = (existing.items ?? []).length;
  const requests = questions.map((q, i) => ({
    createItem: { item: buildQuestionItem(q), location: { index: startIdx + i } },
  }));
  await googleFetch(`${BASE}/forms/${encodeURIComponent(formId)}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  return `Added ${questions.length} question(s) to form ${formId}`;
}

/**
 * Render one forms.get item as human-readable lines, preserving the question
 * type, choice options, scale range and required flag the API returns — all of
 * which the previous "N. title" mapping silently dropped.
 */
function formatFormItem(it: FormItem, index: number): string {
  const lines: string[] = [];
  const title = it.title?.trim() || "(untitled)";
  const q = it.questionItem?.question;

  if (q) {
    // Derive the answer type + any type-specific detail from the question union.
    let typeMarker = "QUESTION";
    const detail: string[] = [];
    if (q.choiceQuestion) {
      // choiceQuestion.type is the exact API enum (RADIO | CHECKBOX | DROP_DOWN).
      typeMarker = q.choiceQuestion.type ?? "CHOICE";
      // choiceQuestion.options[].value holds the answer choices — previously dropped.
      const opts = (q.choiceQuestion.options ?? [])
        .map((o) => (o.isOther ? `${o.value ?? "Other"} (other)` : o.value))
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      if (opts.length > 0) detail.push(`Options: ${opts.join(", ")}`);
    } else if (q.textQuestion) {
      // textQuestion.paragraph distinguishes long-answer from short-answer.
      typeMarker = q.textQuestion.paragraph ? "PARAGRAPH" : "SHORT_ANSWER";
    } else if (q.scaleQuestion) {
      // scaleQuestion.low/high define the linear-scale range — previously dropped.
      typeMarker = "SCALE";
      const { low, high, lowLabel, highLabel } = q.scaleQuestion;
      detail.push(`Scale: ${low ?? "?"} to ${high ?? "?"}`);
      if (lowLabel || highLabel) detail.push(`Labels: ${lowLabel ?? ""} … ${highLabel ?? ""}`.trim());
    } else if (q.dateQuestion) {
      typeMarker = "DATE";
    } else if (q.timeQuestion) {
      // timeQuestion.duration = true means it asks for an elapsed duration.
      typeMarker = q.timeQuestion.duration ? "DURATION" : "TIME";
    } else if (q.fileUploadQuestion) {
      typeMarker = "FILE_UPLOAD";
    }
    // question.required — was never surfaced, so mandatory fields looked optional.
    const requiredMarker = q.required ? " (required)" : "";
    lines.push(`${index + 1}. ${title} [${typeMarker}]${requiredMarker}`);
    if (it.description?.trim()) lines.push(`   ${it.description.trim()}`);
    for (const d of detail) lines.push(`   ${d}`);
  } else {
    // Non-question items still render with their title and a type marker instead of
    // being mislabeled as questions.
    let typeMarker = "ITEM";
    if (it.pageBreakItem) typeMarker = "SECTION";
    else if (it.textItem) typeMarker = "TEXT";
    else if (it.imageItem) typeMarker = "IMAGE";
    else if (it.videoItem) typeMarker = "VIDEO";
    else if (it.questionGroupItem) typeMarker = "QUESTION_GROUP";
    lines.push(`${index + 1}. ${title} [${typeMarker}]`);
    if (it.description?.trim()) lines.push(`   ${it.description.trim()}`);
  }
  return lines.join("\n");
}

/** Read a form: title + description + typed questions/options + responder URL. */
export async function getForm(token: string, formId: string): Promise<string> {
  if (!formId.trim()) throw new Error("formId is required");
  const form = (await googleFetch(`${BASE}/forms/${encodeURIComponent(formId)}`, token)) as FormResponse;
  const items = (form.items ?? []).map((it, i) => formatFormItem(it, i));
  const out = [
    `Form: ${form.info?.title ?? "(untitled)"}`,
  ];
  // info.description is returned by the API but was previously never shown.
  if (form.info?.description?.trim()) out.push(`Description: ${form.info.description.trim()}`);
  out.push(
    `Form ID: ${form.formId}`,
    `Responder URL: ${form.responderUri ?? "(unavailable)"}`,
    `Edit URL: https://docs.google.com/forms/d/${form.formId}/edit`,
    items.length > 0 ? `Questions:\n${items.join("\n")}` : "Questions: (none)",
  );
  return out.join("\n");
}
