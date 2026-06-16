import type { z } from 'zod';
import type {
  CategoryConfigSchema,
  GeneratedTagSchema,
  PersistedTagSchema,
  TagGenerationErrorSchema,
  TagGenerationJobDataSchema,
  TagGenerationResultSchema,
  TagsConfigShapeSchema,
} from './schema';

export type ContextBuilderFn = (sourceId: string, sourceType: string) => Promise<string>;

export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;

export type TagsConfigShape = z.infer<typeof TagsConfigShapeSchema>;

export type GeneratedTag = z.infer<typeof GeneratedTagSchema>;

export type GeneratorFn = (
  context: string,
  categories: Record<string, CategoryConfig>,
) => Promise<GeneratedTag[]>;

export type TagGenerationJobData = z.infer<typeof TagGenerationJobDataSchema>;

export type PersistedTag = z.infer<typeof PersistedTagSchema>;

export type TagGenerationResult = z.infer<typeof TagGenerationResultSchema>;

export type TagGenerationError = z.infer<typeof TagGenerationErrorSchema>;
