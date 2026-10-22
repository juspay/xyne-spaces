import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecideQuestion } from "../xor-decide.js";
import type { EvalSample, Expected } from "../xor-eval.js";
import { STANDARD_QUESTIONS } from "./checks.js";
import { VISUAL_STATE } from "./tools.js";

export const UI_TESTER_EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../evals/ui-tester");

export function uiTesterStandardChecks(): DecideQuestion[] {
  return Object.entries(STANDARD_QUESTIONS).map(([id, q]) =>
    q.type === "noul" ? { id, question: q.instructions, type: "yesno" } : { id, question: q.instructions, type: "choice", options: q.criteria },
  );
}

interface FixtureCase {
  id: string;
  image: string;
  expected: Record<string, Expected>;
  checks?: DecideQuestion[];
}

export async function loadUiTesterEvalSet(dir = UI_TESTER_EVAL_DIR): Promise<{ checks: DecideQuestion[]; samples: EvalSample[]; context: string }> {
  const fixture = JSON.parse(await readFile(join(dir, "cases.json"), "utf8")) as { cases: FixtureCase[] };
  const samples = await Promise.all(
    fixture.cases.map(async (c) => {
      const bytes = await readFile(join(dir, c.image));
      const mime = c.image.endsWith(".png") ? "png" : "jpeg";
      return {
        id: c.id,
        image: `data:image/${mime};base64,${bytes.toString("base64")}`,
        expected: c.expected,
        ...(c.checks ? { checks: c.checks } : {}),
      } satisfies EvalSample;
    }),
  );
  return { checks: uiTesterStandardChecks(), samples, context: VISUAL_STATE };
}
