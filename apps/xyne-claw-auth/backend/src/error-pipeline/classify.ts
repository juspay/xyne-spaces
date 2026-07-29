import type { IncomingError, ClassifyResult } from "./types.js";
import { getRules } from "./rules.js";

/**
 * Route one error to a domain bucket. Bucketing ONLY — whether an item is a
 * real fixable bug is the agent's call at work time, with full context.
 *
 * Deliberately dumb: DB rules (keywords + advanced regex, editable via admin,
 * live within ~60s) or `default`. NO LLM fallback — anything no rule matches
 * sits in `default`, which is the human tuning worklist: add a keyword in the
 * admin UI and the shape routes on the next fire.
 */

function haystack(e: IncomingError): string {
  return [e.message ?? "", e.normMessage ?? ""].join("  ");
}

export async function classify(e: IncomingError): Promise<ClassifyResult> {
  const hay = haystack(e);
  const rules = await getRules();

  if (rules) {
    // Keywords + advanced regex, by matchOrder — first bucket that matches wins.
    for (const b of rules) {
      if (b.keywords?.test(hay) || b.markers?.test(hay)) {
        return { bucket: b.name, reason: `rule:${b.name}`, signal: "rule" };
      }
    }
  }

  return { bucket: "default", reason: "unmatched", signal: "default" };
}
