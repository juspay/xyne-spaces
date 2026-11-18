import { z } from 'zod';

/** Server-side facts the encryption service can derive from an encrypted field's plaintext. */
export const EXTRACTORS = ['mentions', 'links', 'command', 'text', 'artifact'] as const;
export type ExtractorName = (typeof EXTRACTORS)[number];

export interface ExtractorOutput {
  mentions: { userIds: string[]; groupIds: string[]; handles: string[]; channel: boolean; here: boolean };
  links: { all: string[]; first: string | null; pr: string[]; meet: string[] };
  command: { isBot: boolean; name: string | null; args: string | null } | null;
  text: { length: number; isEmpty: boolean };
  /**
   * The slash-command artifact a FlowJSON message carries (`/sev2` and friends): its registry
   * command id and badge, nothing from the body. Null when the message is not an artifact.
   */
  artifact: { command: string; badge: string } | null;
}

export type DerivedContentFacts = { version: 1 } & { [K in ExtractorName]?: ExtractorOutput[K] };

export const derivedContentFactsSchema: z.ZodType<DerivedContentFacts> = z.object({
  version: z.literal(1),
  mentions: z
    .object({
      userIds: z.array(z.string()),
      groupIds: z.array(z.string()),
      handles: z.array(z.string()),
      channel: z.boolean(),
      here: z.boolean(),
    })
    .optional(),
  links: z
    .object({
      all: z.array(z.string()),
      first: z.string().nullable(),
      pr: z.array(z.string()),
      meet: z.array(z.string()),
    })
    .optional(),
  command: z
    .object({
      isBot: z.boolean(),
      name: z.string().nullable(),
      args: z.string().nullable(),
    })
    .nullable()
    .optional(),
  text: z
    .object({
      length: z.number().int().nonnegative(),
      isEmpty: z.boolean(),
    })
    .optional(),
  artifact: z
    .object({
      command: z.string(),
      badge: z.string(),
    })
    .nullable()
    .optional(),
});
