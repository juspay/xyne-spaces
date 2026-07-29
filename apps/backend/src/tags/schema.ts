import { z } from 'zod';
import { TagMethod } from '@prisma/client';
import { TAG_FORMAT_MESSAGE, TAG_FORMAT_REGEX, findDuplicateTags } from '@xyne/shared';

export const TagMethodSchema = z.nativeEnum(TagMethod);


const TagNameSchema = z.string().regex(TAG_FORMAT_REGEX, TAG_FORMAT_MESSAGE);

export const CategoryConfigSchema = z
  .object({
    method: z.enum(['manual', 'llm']),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a valid hex color (e.g. #0891b2)').optional(),
    count: z.number().int().positive().optional(),
    tags: z.array(TagNameSchema).optional(),
    is_new_tag_allowed: z.boolean().optional(),
    blacklist: z.array(TagNameSchema).optional(),
    prompt: z.string().optional(),
  })
  .superRefine((category, ctx) => {
    for (const { value, index } of findDuplicateTags(category.tags)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tags', index],
        message: `tag "${value}" already exists`,
      });
    }

    for (const { value, index } of findDuplicateTags(category.blacklist)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blacklist', index],
        message: `tag "${value}" already exists`,
      });
    }
  });

export const TagsConfigShapeSchema = z.object({
  categories: z
    .record(z.string(), CategoryConfigSchema)
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
});

export const UpdateTagsConfigBodySchema = z.object({
  config: TagsConfigShapeSchema,
});

export type CreateTagsConfigBody = z.infer<typeof CreateTagsConfigBodySchema>;
export type UpdateTagsConfigBody = z.infer<typeof UpdateTagsConfigBodySchema>;
export type CreateTagBody = z.infer<typeof CreateTagBodySchema>;
export type UpdateTagBody = z.infer<typeof UpdateTagBodySchema>;
export type DeleteTagBody = z.infer<typeof DeleteTagBodySchema>;
export type SetManualTagsBody = z.infer<typeof SetManualTagsBodySchema>;
