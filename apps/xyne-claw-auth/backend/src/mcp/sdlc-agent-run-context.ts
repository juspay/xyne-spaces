import { sdlcAgentContextSchema } from "@xyne/shared/sdlc";

export function parseSdlcAgentRunContext(value: unknown): Record<string, unknown> | null {
  const parsed = sdlcAgentContextSchema.safeParse(value);
  return parsed.success ? (value as Record<string, unknown>) : null;
}
