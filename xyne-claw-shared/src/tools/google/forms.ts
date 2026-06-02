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

interface FormResponse {
  formId: string;
  responderUri?: string;
  info?: { title?: string; documentTitle?: string };
  items?: Array<{ itemId: string; title?: string }>;
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

/** Read a form: title + questions + responder URL. */
export async function getForm(token: string, formId: string): Promise<string> {
  if (!formId.trim()) throw new Error("formId is required");
  const form = (await googleFetch(`${BASE}/forms/${encodeURIComponent(formId)}`, token)) as FormResponse;
  const items = (form.items ?? []).map((it, i) => `${i + 1}. ${it.title ?? "(untitled)"}`);
  return [
    `Form: ${form.info?.title ?? "(untitled)"}`,
    `Form ID: ${form.formId}`,
    `Responder URL: ${form.responderUri ?? "(unavailable)"}`,
    `Edit URL: https://docs.google.com/forms/d/${form.formId}/edit`,
    items.length > 0 ? `Questions:\n${items.join("\n")}` : "Questions: (none)",
  ].join("\n");
}
