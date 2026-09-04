export { tagGenerationPipeline, TagGenerationPipeline, invalidateTagConfigCache } from './pipeline';
export { tagService, TagService } from './service';
export { tagRoutes } from './routes';
export {
  CategoryConfigSchema,
  ConfirmTagBodySchema,
  CreateTagBodySchema,
  CreateTagsConfigBodySchema,
  DeleteTagBodySchema,
  GeneratedTagSchema,
  PersistedTagSchema,
  SetManualTagsBodySchema,
  TagGenerationErrorSchema,
  TagGenerationJobDataSchema,
  TagGenerationResultSchema,
  TagMethodSchema,
  TagsConfigShapeSchema,
  UpdateTagBodySchema,
  UpdateTagsConfigBodySchema,
} from './schema';
export { registerDeskEmailTags, DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey, DEFAULT_DESK_EMAIL_CONFIG } from './deskEmail';
export { DESK_TICKET_SOURCE_TYPE, syncTicketTagsForConversation } from './deskTicket';
export { enqueueTagVespaRefeed } from './vespaSync';
export { getGroupedTagsWithConfig } from './presentation';
export type { TagGroup, TagGroupWithConfig, TagGroupConfigOptions } from './presentation';
export type {
  CategoryConfig,
  ContextBuilderFn,
  GeneratedTag,
  GeneratorFn,
  PersistedTag,
  TagGenerationError,
  TagGenerationJobData,
  TagGenerationResult,
  TagsConfigShape,
} from './types';
