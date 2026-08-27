import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { threadCountsByTag } from '@/services/messageClassification/tagCounts';
import {
  getThreadTypeVocabulary,
  listTagsCreatedBy,
  listThreadTypeVocabulary,
  patchThreadTypeVocabulary,
  rejectVocabularyCandidates,
  reconsiderVocabularyCandidates,
  seedWorkspaceVocabulary,
  setThreadTypeVocabulary,
  MAX_ENTRIES,
  MAX_NAME_LENGTH,
  VOCABULARY_STATUSES,
  type VocabularyStatus,
} from '@/services/messageClassification/vocabulary';

/**
 * Names are the value stored in Vespa and echoed back to the model, so they are constrained
 * to the shape the built-ins use: UPPER_SNAKE, deliberately unlike the lowercase-hyphenated
 * shape people type for free-form thread tags, so the two stay distinguishable at a glance.
 */
const EntrySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'name must be UPPER_SNAKE, e.g. FEATURE_REQUEST'),
  label: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex value, e.g. #0891b2'),
  // Prompt copy, not a tooltip: this is what tells the model when the type applies, so a
  // one-word description produces a classifier that guesses.
  description: z.string().trim().min(20).max(1200),
  // Promoting a candidate is just writing it back as APPROVED with a real label and
  // description. Omitted means approved — nothing sent through the API is under review
  // unless it says so.
  status: z.enum(['APPROVED', 'UNDER_REVIEW']).optional(),
});

const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'name must be UPPER_SNAKE, e.g. FEATURE_REQUEST');

/**
 * A candidate's name as the proposer typed it — lowercase-hyphenated, unlike the UPPER_SNAKE
 * an approved entry must use. That difference is why promotion RENAMES rather than just
 * flipping a status, and why decisions are keyed on this looser shape.
 */
const CandidateNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

const DecisionSchema = z.object({
  names: z.array(CandidateNameSchema).min(1).max(MAX_ENTRIES),
});

/** Both lists optional so one curl can add without removing, or remove without adding. */
const PatchSchema = z
  .object({
    add: z.array(EntrySchema).max(MAX_ENTRIES).optional(),
    remove: z.array(NameSchema).max(MAX_ENTRIES).optional(),
  })
  .refine(patch => (patch.add?.length ?? 0) + (patch.remove?.length ?? 0) > 0, {
    message: 'Send at least one entry under "add" or "remove"',
  })
  .refine(
    patch => {
      const removing = new Set(patch.remove ?? []);
      return !(patch.add ?? []).some(entry => removing.has(entry.name));
    },
    { message: 'A name cannot appear in both "add" and "remove"' },
  );

const BodySchema = z.object({
  // Order is meaningful — it is the picker's order, the chip sort order, and the order
  // entries appear in the prompt.
  entries: z
    .array(EntrySchema)
    .max(MAX_ENTRIES)
    .superRefine((entries, ctx) => {
      const seen = new Set<string>();
      entries.forEach((entry, index) => {
        if (seen.has(entry.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'name'],
            message: `"${entry.name}" appears more than once`,
          });
        }
        seen.add(entry.name);
      });
    }),
});

/**
 * The workspace's thread-type vocabulary.
 *
 * Read by every member — the picker needs it. Written by admins only: an entry's
 * description IS the classifier's instruction for that type, so an edit changes how every
 * thread in the workspace gets classified from the next pass onward.
 */
export class ThreadTypeVocabularyController {
  /**
   * The approved vocabulary — what the picker offers and what chips are labelled from.
   *
   * Every member calls this, so it never widens to include candidates and never carries
   * counts. Deciding their fate is `getReview`, which is admin-gated.
   */
  getVocabulary = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({
        success: true,
        entries: await getThreadTypeVocabulary(req.user!.workspaceId),
      });
    } catch (error) {
      logger.error('[threadTypeVocabulary] read failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * The review queue: candidates, turned-down names, filters, option counts and thread usage.
   *
   * Admin-gated at the route, and it has to be. The thread counts are taken with the
   * per-user permission filter deliberately OFF, so this endpoint reports usage across
   * channels the caller is not a member of — fine for someone curating the workspace
   * vocabulary, not something to hand to every member.
   */
  getReview = async (req: Request, res: Response): Promise<void> => {
    try {
      // ?status= narrows to one or more of APPROVED|UNDER_REVIEW|REJECTED. The review queue
      // opens on UNDER_REVIEW alone; omitting it means all three.
      const requested = String(req.query['status'] ?? '')
        .split(',')
        .map(value => value.trim().toUpperCase())
        .filter((value): value is VocabularyStatus =>
          (VOCABULARY_STATUSES as readonly string[]).includes(value),
        );

      // Candidates are unbounded, so this path is always paged — a workspace that has
      // accumulated thousands of invented names must not ship all of them to a browser.
      const csv = (key: string): string[] =>
        String(req.query[key] ?? '')
          .split(',')
          .map(value => value.trim())
          .filter(value => value.length > 0);

      // The unattributed bucket travels as the literal 'BUILT_IN' because an empty string
      // survives neither a query string nor a comma split.
      const proposedBy = csv('proposedBy').map(value => (value === 'BUILT_IN' ? '' : value));
      const page = await listThreadTypeVocabulary(req.user!.workspaceId, {
        statuses: requested,
        proposedBy,
        limit: Number(req.query['limit']) || undefined,
        offset: Number(req.query['offset']) || undefined,
      });

      // ?counts=true attaches thread counts. Opt-in: it costs a Vespa round trip, and a
      // caller only listing names has no use for it.
      if (req.query['counts'] !== 'true') {
        res.status(200).json({ success: true, ...page, entries: page.rows });
        return;
      }

      const { total, lastUsed, ok } = await threadCountsByTag(req.user!.workspaceId);

      // Counting failed. Send the vocabulary without counts rather than a wall of zeros —
      // the client renders an absent count as "unknown", and a zero as "nobody uses this".
      if (!ok) {
        res.status(200).json({ success: true, ...page, entries: page.rows });
        return;
      }

      res.status(200).json({
        success: true,
        total: page.total,
        facets: page.facets,
        entries: page.rows.map(entry => ({
          ...entry,
          // Counted with the per-user permission filter deliberately off: a tag used widely
          // in channels this admin is not in still deserves to look widely used.
          threadCount: total.get(entry.name) ?? 0,
          lastUsedAt: lastUsed.get(entry.name) ?? null,
        })),
      });
    } catch (error) {
      logger.error('[threadTypeVocabulary] read failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Add or drop individual types. The form meant for a one-line curl — no need to GET the
   * list, edit it and send it all back, and two people adding different types at the same
   * time do not clobber each other.
   */
  /**
   * Copy the starting vocabulary into this workspace.
   *
   * Explicit and admin-only: nothing seeds itself. A workspace that has pared its vocabulary
   * down to three types must not get twelve back because someone opened a thread. Idempotent
   * — re-running adds only the names that are missing, and `added` reports how many.
   */
  seedVocabulary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { added } = await seedWorkspaceVocabulary(req.user!.workspaceId, req.user!.id);
      res.status(200).json({ success: true, added });
    } catch (error) {
      logger.error('[threadTypeVocabulary] seed failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  patchVocabulary = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid patch',
          issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
        });
        return;
      }

      const result = await patchThreadTypeVocabulary(
        req.user!.workspaceId,
        parsed.data,
        req.user!.id,
      );
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      // The service throws this when a patch would empty the vocabulary; it is the caller's
      // mistake, not a server fault.
      if (error instanceof Error && error.message.includes('at least one thread type')) {
        res.status(400).json({ error: error.message });
        return;
      }
      logger.error('[threadTypeVocabulary] patch failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * The names THIS person has proposed that are still undecided.
   *
   * Small and bounded — one person's inventions — which is what makes it cheap enough to
   * hold for a session. It exists so the author's own chip can show as under review without
   * denormalising a pending flag onto the applied tag (which would go stale the moment an
   * admin decided it) and without pulling every candidate in the workspace into every client.
   */
  myPendingNames = async (req: Request, res: Response): Promise<void> => {
    try {
      const mine = await listTagsCreatedBy(req.user!.id, req.user!.workspaceId);
      res.status(200).json({
        success: true,
        names: mine.filter(entry => entry.status === 'UNDER_REVIEW').map(entry => entry.name),
      });
    } catch (error) {
      logger.error('[threadTypeVocabulary] mine failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Turn down one or more proposed names.
   *
   * Workspace-wide, mirroring promotion: candidates are per-proposer, so deciding only the
   * row in front of you would leave an identical proposal from someone else in the queue.
   *
   * Nothing is removed from any thread. The tag stays where it was applied and stays
   * searchable — this only stops the NAME being offered, assigned, or proposed again.
   */
  rejectCandidates = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = DecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid decision',
          issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
        });
        return;
      }

      const decided = await rejectVocabularyCandidates(
        req.user!.workspaceId,
        parsed.data.names,
        req.user!.id,
      );
      // `decided` counts rows, not names: one name can have several proposers. A zero means
      // nothing was outstanding — already decided, or never proposed here.
      res.status(200).json({ success: true, decided });
    } catch (error) {
      logger.error('[threadTypeVocabulary] reject failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /** Put a turned-down name back in the queue, clearing the reason with it. */
  reconsiderCandidates = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = DecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid decision',
          issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
        });
        return;
      }

      const decided = await reconsiderVocabularyCandidates(
        req.user!.workspaceId,
        parsed.data.names,
        req.user!.id,
      );
      res.status(200).json({ success: true, decided });
    } catch (error) {
      logger.error('[threadTypeVocabulary] reconsider failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  updateVocabulary = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid vocabulary',
          issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
        });
        return;
      }

      // An empty vocabulary is not "no types" — it silently falls back to the built-ins on
      // the next read, which is not what an admin who just cleared the list would expect.
      // Refusing is the honest answer; removing the feature is a flag, not a config edit.
      if (parsed.data.entries.length === 0) {
        res.status(400).json({ error: 'A workspace must keep at least one thread type' });
        return;
      }

      const entries = await setThreadTypeVocabulary(
        req.user!.workspaceId,
        parsed.data.entries,
        req.user!.id,
      );
      res.status(200).json({ success: true, entries });
    } catch (error) {
      logger.error('[threadTypeVocabulary] write failed:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
