/**
 * One classifier (Jev) call, in full: what it was told (state), what it was
 * asked, and what it answered. Stored next to the decision it drove so the
 * pipeline UI can show it — no classifier decision is a black box.
 */
export interface ClassifierExchange {
  purpose: string;
  backend: string;
  ms: number;
  ok: boolean;
  error?: string;
  state: string;
  questionSpec: Record<string, unknown>;
  answers: Record<string, unknown> | null;
  at: string;
}
