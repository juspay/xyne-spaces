/**
 * Copying steps so they can stand beside the ones they came from.
 *
 * Two edits need this and need it to mean the same thing: a second way of asking
 * a screen, and a duplicated screen. Both take a run of steps, give every step
 * inside a new id, and move every reference *between* those steps onto the new
 * ids — so the copy reads its own question rather than the original's.
 *
 * What is deliberately left alone: ids that appear as plain values. A case's
 * condition and a `GO_TO`'s target name screens and cycles, not these inner
 * steps, so a copy leads wherever the original led until something moves it.
 */
import { asRec, type Rec, type Step } from '../json.js';

/** Every id already in use, so a copy never collides with one. */
export function idsIn(config: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const rec = value as Rec;
    if (typeof rec['id'] === 'string') out.add(rec['id']);
    Object.values(rec).forEach(walk);
  };
  walk(config);
  return out;
}

/**
 * A copy of `steps` in which every step takes `suffix`, and every reference
 * between them follows.
 *
 * `taken`, when given, is what the suffixed id must not collide with; a name
 * already in use grows a number the way every other id in this layer does.
 */
export function copyWithFreshIds(steps: Step[], suffix: string, taken?: Set<string>): Step[] {
  const copy = JSON.parse(JSON.stringify(steps)) as Step[];
  const renamed = new Map<string, string>();
  const walk = (value: unknown, visit: (step: Rec) => void): void => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, visit));
    if (!value || typeof value !== 'object') return;
    const rec = value as Rec;
    if (typeof rec['id'] === 'string' && typeof rec['type'] === 'string') visit(rec);
    Object.values(rec).forEach((v) => walk(v, visit));
  };
  walk(copy, (step) => {
    const was = String(step['id']);
    let now = `${was}__${suffix}`;
    for (let n = 2; taken?.has(now); n += 1) now = `${was}__${suffix}_${String(n)}`;
    taken?.add(now);
    renamed.set(was, now);
    step['id'] = now;
  });

  // The gate and the jumps name the question they read; they must follow it.
  let text = JSON.stringify(copy);
  for (const [was, now] of renamed) text = text.split(`steps.${was}.`).join(`steps.${now}.`);
  return JSON.parse(text) as Step[];
}

/** The steps of a case, as steps. */
export function stepsOf(entry: Rec): Step[] {
  const steps = entry['steps'];
  return Array.isArray(steps) ? (steps.map(asRec) as unknown as Step[]) : [];
}
