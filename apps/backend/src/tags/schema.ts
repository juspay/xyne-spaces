import { z } from 'zod';
import { CategoryConfigSchema, TAG_FORMAT_MESSAGE, TAG_FORMAT_REGEX, TagMethod, TagsConfigShapeSchema } from '@xyne/shared';

export const TagMethodSchema = z.nativeEnum(TagMethod);


const TagNameSchema = z.string().regex(TAG_FORMAT_REGEX, TAG_FORMAT_MESSAGE);

// CategoryConfigSchema and TagsConfigShapeSchema live in @xyne/shared (tags/index.ts), so the
// typed route for a channel's tags config validates its body with them.
export { CategoryConfigSchema, TagsConfigShapeSchema };

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

export const ConfirmTagBodySchema = z.object({
  tagId: z.string().min(1),
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
export type ConfirmTagBody = z.infer<typeof ConfirmTagBodySchema>;
export type SetManualTagsBody = z.infer<typeof SetManualTagsBodySchema>;
