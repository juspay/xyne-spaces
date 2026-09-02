import { z } from 'zod';
import {
  FEATURE_ANNOUNCEMENT_CTA_TYPES,
  FEATURE_ANNOUNCEMENT_KEY_PATTERN,
  FEATURE_ANNOUNCEMENT_LIMITS,
  FeatureAnnouncementCtaType,
  isHttpUrl,
  isInternalRoute,
} from '@xyne/shared';

const { MAX_PAGES, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_KEY_LENGTH } =
  FEATURE_ANNOUNCEMENT_LIMITS;

const trimmed = z.string().transform((value) => value.trim());

const pageSchema = z.object({
  title: trimmed.pipe(z.string().min(1).max(MAX_TITLE_LENGTH)),
  description: trimmed.pipe(z.string().min(1).max(MAX_DESCRIPTION_LENGTH)),
  mediaKey: z.string().min(1).nullish(),
  mediaAlt: z.string().max(MAX_DESCRIPTION_LENGTH).nullish(),
});

const ctaShape = {
  ctaLabel: trimmed.pipe(z.string().min(1).max(MAX_TITLE_LENGTH)).nullish(),
  ctaType: z.enum(FEATURE_ANNOUNCEMENT_CTA_TYPES as [string, ...string[]]).nullish(),
  ctaTarget: trimmed.pipe(z.string().min(1)).nullish(),
};

type CtaFields = {
  ctaLabel?: string | null;
  ctaType?: string | null;
  ctaTarget?: string | null;
};

/**
 * A half-configured CTA renders as a dead button, and a ROUTE holding an absolute URL is
 * an open redirect wearing internal-navigation clothes. Both are rejected on write so a
 * bad row can never reach a client.
 */
function refineCta(value: CtaFields, ctx: z.RefinementCtx): void {
  const present = [value.ctaLabel, value.ctaType, value.ctaTarget].filter(
    (field) => field !== null && field !== undefined
  ).length;

  if (present === 0) return;

  if (present !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ctaLabel'],
      message: 'ctaLabel, ctaType and ctaTarget must be set together or all omitted',
    });
    return;
  }

  if (value.ctaType === FeatureAnnouncementCtaType.ROUTE && !isInternalRoute(value.ctaTarget!)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ctaTarget'],
      message: 'A ROUTE target must be an app-relative path beginning with a single "/"',
    });
  }

  if (value.ctaType === FeatureAnnouncementCtaType.EXTERNAL && !isHttpUrl(value.ctaTarget!)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ctaTarget'],
      message: 'An EXTERNAL target must be an absolute http(s) URL',
    });
  }
}

export const createFeatureAnnouncementSchema = z
  .object({
    key: trimmed.pipe(
      z
        .string()
        .min(1)
        .max(MAX_KEY_LENGTH)
        .regex(
          FEATURE_ANNOUNCEMENT_KEY_PATTERN,
          'Key must be lowercase alphanumeric words separated by underscores'
        )
    ),
    title: trimmed.pipe(z.string().min(1).max(MAX_TITLE_LENGTH)),
    description: trimmed.pipe(z.string().min(1).max(MAX_DESCRIPTION_LENGTH)),
    pages: z.array(pageSchema).min(1).max(MAX_PAGES),
    mediaKey: z.string().min(1).nullish(),
    mediaAlt: z.string().max(MAX_DESCRIPTION_LENGTH).nullish(),
    expiresAt: z.coerce.date().nullish(),
    cacKey: trimmed.pipe(z.string().min(1)).nullish(),
    ...ctaShape,
  })
  .superRefine(refineCta);

export const updateFeatureAnnouncementSchema = z
  .object({
    title: trimmed.pipe(z.string().min(1).max(MAX_TITLE_LENGTH)).optional(),
    description: trimmed.pipe(z.string().min(1).max(MAX_DESCRIPTION_LENGTH)).optional(),
    pages: z.array(pageSchema).min(1).max(MAX_PAGES).optional(),
    mediaKey: z.string().min(1).nullish(),
    mediaAlt: z.string().max(MAX_DESCRIPTION_LENGTH).nullish(),
    expiresAt: z.coerce.date().nullish(),
    cacKey: trimmed.pipe(z.string().min(1)).nullish(),
    ...ctaShape,
  })
  .superRefine(refineCta);

export const seenFeatureAnnouncementSchema = z.object({
  pageIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_PAGES - 1),
});

export const dismissFeatureAnnouncementsSchema = z.object({
  announcementIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_PAGES * 4),
});

export type CreateFeatureAnnouncementInput = z.infer<typeof createFeatureAnnouncementSchema>;
export type UpdateFeatureAnnouncementInput = z.infer<typeof updateFeatureAnnouncementSchema>;
