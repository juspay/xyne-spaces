import { z } from 'zod';

/** Server-side facts the encryption service can derive from an encrypted field's plaintext. */
export const EXTRACTORS = ['mentions', 'links', 'command', 'text'] as const;
export type ExtractorName = (typeof EXTRACTORS)[number];

export interface ExtractorOutput {
  mentions: {
    /** Who to notify: the notification parser's rules (user and group ids, `@name` handles). */
    userIds: string[];
    groupIds: string[];
    handles: string[];
    channel: boolean;
    here: boolean;
    /** Who becomes a mentioned participant of the conversation: extractAllMentions' rules. */
    participants: { userIds: string[]; groupIds: string[] };
  };
  links: { all: string[]; first: string | null; pr: string[]; meet: string[] };
  /** A `/command`: its bot name and `--key value` parameters, parsed (parseBotCommandText). */
  command: { isBot: boolean; name: string | null; args: string | null; parameters: Record<string, string> } | null;
  text: { length: number; isEmpty: boolean };
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
      participants: z.object({
        userIds: z.array(z.string()),
        groupIds: z.array(z.string()),
      }),
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
      parameters: z.record(z.string(), z.string()),
    })
    .nullable()
    .optional(),
  text: z
    .object({
      length: z.number().int().nonnegative(),
      isEmpty: z.boolean(),
    })
    .optional(),
});
