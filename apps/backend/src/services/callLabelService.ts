import type { Call } from '@prisma/client';
import { logger } from '@/utils/logger';
import { tagService, TagServiceError } from '@/tags/service';
import { tagRepository } from '@/database/repositories/tagRepository';
import { normalizeTagName, TAG_FORMAT_REGEX, TagMethod } from '@xyne/shared';

// Generic Tag framework sourceType/category for call labels. No configKey is
// used, so tagService.createTag skips the "category must be configured" check
// entirely (see assertManualCategoryOrOverride).
const CALL_TAG_SOURCE_TYPE = 'CALL';
const CALL_LABEL_CATEGORY = 'topic';

/** Cap on one generation run, so a verbose LLM reply can't flood Call.labels. */
const MAX_GENERATED_LABELS = 3;

/**
 * Turns label text into Tag rows on a call, for both transcript pipelines.
 * Imports nothing from transcriptService on purpose — that service calls in here.
 */
class CallLabelService {
  /** Normalize a label into the Tag framework's required format (lowercase, hyphenated). */
  slugifyLabel(raw: string): string | null {
    const slug = normalizeTagName(raw);
    if (!slug) return null;
    const safe = /^[a-z]/.test(slug) ? slug : `l-${slug}`;
    return TAG_FORMAT_REGEX.test(safe) ? safe : null;
  }

  /** Reuses this call's existing tag for `slug`, else creates one. */
  async getOrCreateLabelTag(call: Call, slug: string, method: TagMethod): Promise<string | null> {
    const existing = await tagRepository.findActiveTag(call.id, CALL_TAG_SOURCE_TYPE, CALL_LABEL_CATEGORY, slug);
    if (existing) {
      // Typing a label an LLM/automated pass only suggested asserts it just as the tick button does.
      if (method === TagMethod.MANUAL && existing.method !== TagMethod.MANUAL) {
        await tagService.confirmTag(existing.id, call.workspaceId!);
      }
      return existing.id;
    }

    try {
      const created = await tagService.createTag(
        call.id,
        CALL_TAG_SOURCE_TYPE,
        call.workspaceId!,
        CALL_LABEL_CATEGORY,
        slug,
        method,
      );
      return created.id;
    } catch (error) {
      // 409 = another run/racing worker created the same tag between the find and create above.
      if (error instanceof TagServiceError && error.status === 409) {
        const raced = await tagRepository.findActiveTag(call.id, CALL_TAG_SOURCE_TYPE, CALL_LABEL_CATEGORY, slug);
        return raced?.id ?? null;
      }
      throw error;
    }
  }

  /** Persists generated label text as Tag rows of `method`, returning ids for Call.labels. */
  async persistGeneratedLabels(
    call: Call,
    rawLabels: string[],
    method: TagMethod = TagMethod.LLM,
    logPath?: string,
  ): Promise<string[]> {
    const callId = call.externalId;
    const tagIds: string[] = [];

    for (const rawLabel of rawLabels) {
      if (tagIds.length >= MAX_GENERATED_LABELS) break;
      const slug = this.slugifyLabel(rawLabel);
      if (!slug) continue;
      try {
        const tagId = await this.getOrCreateLabelTag(call, slug, method);
        if (tagId && !tagIds.includes(tagId)) tagIds.push(tagId);
      } catch (error) {
        logger.error(`[${callId}] label_tag_failed`, { label: slug, path: logPath, error });
      }
    }

    return tagIds;
  }
}

export const callLabelService = new CallLabelService();
