import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UI_TESTER_EVAL_DIR, UI_TESTER_STANDARD_CHECKS } from "xyne-claw-shared";
import type { DecideQuestion } from "../xor-decide.js";
import type { EvalSample, Expected } from "../xor-eval.js";
import { VISUAL_STATE } from "./tools.js";

export function uiTesterStandardChecks(): DecideQuestion[] {
  return UI_TESTER_STANDARD_CHECKS.map((c) => ({ ...c, ...("options" in c ? { options: { ...c.options } } : {}) }) as DecideQuestion);
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
