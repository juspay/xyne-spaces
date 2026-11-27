import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';
import { TagsConfigShapeSchema } from '../../../tags/index.js';

const categoryConfig = z.object({
  method: z.enum(['manual', 'llm']),
  color: z.string().optional(),
  count: z.number().optional(),
  tags: z.array(z.string()).optional(),
  is_new_tag_allowed: z.boolean().optional(),
  blacklist: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

// ── A channel's desk tag-generation config (/channels/:channelId/tags-config) ──

const channelId = z.object({ channelId: z.string().min(1) });

/** `/channels/:channelId/tags-config`: a channel's desk tag-generation config. Key order is the mount order. */
export const tagsConfig = route('/:channelId/tags-config', {
  get: {
    method: 'GET',
    path: '',
    params: channelId,
    response: z.object({ categories: z.record(z.string(), categoryConfig), isDefault: z.boolean() }),
  },
  /** Replaces the categories. Desk owner, channel admin or channel creator only. */
  update: {
    method: 'PATCH',
    path: '',
    params: channelId,
    body: TagsConfigShapeSchema,
    response: z.object({ categories: z.record(z.string(), categoryConfig) }),
  },
});
