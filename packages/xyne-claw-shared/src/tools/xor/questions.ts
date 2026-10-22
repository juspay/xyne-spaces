export const MAX_DECIDE_QUESTIONS = 12;

export type DecideType = "yesno" | "choice" | "score" | "value";

export interface DecideQuestion {
  id: string;
  question: string;
  type: DecideType;
  options?: Record<string, string> | string[];
  dtype?: "string" | "int" | "float";
  pattern?: string;
  expect?: string | number | boolean;
  threshold?: number;
}

const ID = /^[a-zA-Z0-9_-]{1,40}$/;

export function validateDecideQuestions(raw: unknown): { questions: DecideQuestion[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "questions must be a non-empty array" };
  if (raw.length > MAX_DECIDE_QUESTIONS) return { error: `at most ${MAX_DECIDE_QUESTIONS} questions per call` };
  const seen = new Set<string>();
  const out: DecideQuestion[] = [];
  for (const q of raw as Array<Record<string, unknown>>) {
    const id = typeof q?.["id"] === "string" ? q["id"] : "";
    if (!ID.test(id) || seen.has(id)) return { error: `every question needs a unique id of letters, digits, - and _ (bad: ${JSON.stringify(q?.["id"])})` };
    seen.add(id);
    const question = typeof q["question"] === "string" ? q["question"].trim() : "";
    if (!question) return { error: `question "${id}" needs question text` };
    const type = q["type"] as DecideType;
    if (!["yesno", "choice", "score", "value"].includes(type)) return { error: `question "${id}": type must be yesno, choice, score or value` };
    const options = q["options"] as DecideQuestion["options"];
    if (type === "choice" && (!options || Array.isArray(options) || Object.keys(options).length < 2)) {
      return { error: `question "${id}": choice needs options as {key: description} with at least 2 keys` };
    }
    if (type === "score" && (!Array.isArray(options) || options.length < 2)) {
      return { error: `question "${id}": score needs options as an ordered list (low to high) of at least 2 levels` };
    }
    const dtype = (q["dtype"] as DecideQuestion["dtype"]) ?? "string";
    if (type === "value" && !["string", "int", "float"].includes(dtype)) return { error: `question "${id}": dtype must be string, int or float` };
    const threshold = typeof q["threshold"] === "number" ? Math.min(Math.max(q["threshold"], 0), 1) : undefined;
    out.push({
      id,
      question,
      type,
      ...(options ? { options } : {}),
      ...(type === "value" ? { dtype } : {}),
      ...(typeof q["pattern"] === "string" ? { pattern: q["pattern"] } : {}),
      ...(typeof q["expect"] === "string" || typeof q["expect"] === "number" || typeof q["expect"] === "boolean" ? { expect: q["expect"] } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
    });
  }
  return { questions: out };
}
