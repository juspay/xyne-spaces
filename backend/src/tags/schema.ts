import { z } from 'zod';
import { TagMethod } from '@prisma/client';

export const TagMethodSchema = z.nativeEnum(TagMethod);

export const TAG_FORMAT_REGEX = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;
export const TAG_SCRIPT_TIMEOUT_MAX_MS = 5 * 60 * 1000;

const TAG_FORMAT_MESSAGE = 'must be lowercase, hyphen-separated, alphanumeric segments';
const TagNameSchema = z.string().regex(TAG_FORMAT_REGEX, TAG_FORMAT_MESSAGE);

export const CategoryConfigSchema = z
  .object({
    method: z.enum(['manual', 'llm', 'automated']),
    count: z.number().int().positive().optional(),
    tags: z.array(TagNameSchema).optional(),
    is_new_tag_allowed: z.boolean().optional(),
    blacklist: z.array(TagNameSchema).optional(),
    prompt: z.string().optional(),
    script: z.string().optional(),
    script_timeout_ms: z.number().int().positive().max(TAG_SCRIPT_TIMEOUT_MAX_MS).optional(),
  })
  .superRefine((category, ctx) => {
    if (category.method !== 'automated') {
      return;
    }

    if (typeof category.script !== 'string' || category.script.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['script'],
        message: 'automated categories must define a non-empty script',
      });
    }
  });

export const TagsConfigShapeSchema = z.object({
  categories: z
    .record(z.string(), CategoryConfigSchema)
    .refine((categories) => Object.keys(categories).length > 0, 'categories must be a non-empty object')
    .superRefine((categories, ctx) => {
      for (const category of Object.keys(categories)) {
        if (!TAG_FORMAT_REGEX.test(category)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [category],
            message: `category ${TAG_FORMAT_MESSAGE}`,
          });
        }
      }
    }),
});

export const GeneratedTagSchema = z.object({
  category: z.string().min(1),
  tag: z.string().min(1),
  reason: z.string().optional(),
});

export const TagGenerationJobDataSchema = z.object({
  jobId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  workspaceId: z.string().min(1),
  configKey: z.string().min(1),
});

export const PersistedTagSchema = z.object({
  tagCategory: z.string().min(1),
  tag: z.string().min(1),
  method: TagMethodSchema,
  reason: z.string().nullable().optional(),
});

export const TagGenerationResultSchema = z.object({
  jobId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  tags: z.array(PersistedTagSchema),
});

export const TagGenerationErrorSchema = z.object({
  jobId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  error: z.string(),
});

export const CreateTagBodySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  tagCategory: TagNameSchema,
  tag: TagNameSchema,
  method: TagMethodSchema,
  override: z.boolean().optional(),
  configKey: z.string().min(1).nullable().optional(),
});

export const UpdateTagBodySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  tagCategory: TagNameSchema,
  oldTag: TagNameSchema,
  newTag: TagNameSchema,
  override: z.boolean().optional(),
  configKey: z.string().min(1).nullable().optional(),
});

export const DeleteTagBodySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  tagCategory: TagNameSchema,
  tag: TagNameSchema,
  override: z.boolean().optional(),
  configKey: z.string().min(1).nullable().optional(),
});

export const SetManualTagsBodySchema = z.object({
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  tagCategory: TagNameSchema,
  tags: z.array(TagNameSchema),
  override: z.boolean().optional(),
  configKey: z.string().min(1).nullable().optional(),
});

export const CreateTagsConfigBodySchema = z.object({
  configKey: z.string().min(1),
  sourceType: z.string().min(1),
  config: TagsConfigShapeSchema,
  sampleContext: z.string().optional(),
});

export const UpdateTagsConfigBodySchema = z.object({
  config: TagsConfigShapeSchema,
  sampleContext: z.string().optional(),
});

export type CreateTagsConfigBody = z.infer<typeof CreateTagsConfigBodySchema>;
export type UpdateTagsConfigBody = z.infer<typeof UpdateTagsConfigBodySchema>;
export type CreateTagBody = z.infer<typeof CreateTagBodySchema>;
export type UpdateTagBody = z.infer<typeof UpdateTagBodySchema>;
export type DeleteTagBody = z.infer<typeof DeleteTagBodySchema>;
export type SetManualTagsBody = z.infer<typeof SetManualTagsBodySchema>;
