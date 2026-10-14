/**
 * claw's `defaultModel` (its LITELLM.model) from a FAILED
 * /internal/litellm/models response body, or null.
 *
 * claw keeps reporting the default when only the listing fails, so a no-pin
 * "spaces" run's "Uses X by default" label survives a listing outage
 * (XYNE-66325). Old claw pods, non-JSON bodies and blank values ⇒ null.
 */
export function platformDefaultFromErrorBody(text: string): string | null {
  try {
    const body = JSON.parse(text) as { defaultModel?: unknown } | null;
    const model = body?.defaultModel;
    return typeof model === "string" && model.trim() ? model.trim() : null;
  } catch {
    return null;
  }
}
