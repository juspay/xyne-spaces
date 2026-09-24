import { v4 as uuidv4 } from 'uuid';
import { mutators } from '@xyne/shared/zero/mutators';
import { queries } from '../../zero/queries';
import {
  registerCommentStore,
  type ItemComment,
  type WorkspaceItem,
} from '../../components/workspaceItems';

type Zero = {
  mutate: (mutation: unknown) => { server: Promise<{ type: string; error?: { message: string } }> };
  run: (query: unknown) => Promise<unknown>;
};

interface CommentRow {
  id: string;
  entityId: string;
  body: string;
  anchorQuote: string | null;
  anchorSelector: string | null;
  resolved: boolean;
  createdBy: string;
  createdAt: number;
}

export interface SdlcCommentContext {
  zero: Zero;
}

let context: SdlcCommentContext | null = null;
let registered = false;
let nameCache: Map<string, string> | null = null;

async function authorNames(zero: Zero): Promise<Map<string, string>> {
  if (nameCache) return nameCache;
  try {
    const rows = (await zero.run(queries.getUsersV2())) as
      | Array<{ id: string; name?: string | null; email?: string | null }>
      | undefined;
    nameCache = new Map((rows ?? []).map(row => [row.id, row.name || row.email || '']));
  } catch {
    nameCache = new Map();
  }
  return nameCache;
}

/** The finder calls an uploaded file FILE; every edge in the hub calls it ATTACHMENT. */
function entityTypeOf(item: WorkspaceItem): string {
  const kind = (item.row as { kind?: string } | undefined)?.kind ?? 'CANVAS';
  return kind === 'FILE' ? 'ATTACHMENT' : kind;
}

/**
 * Scratch browsing is not a hub entity — it has no id of its own, so comments
 * left there would be keyed on an id every folder shares. Reject it here too,
 * so a caller that skips the surface's own check cannot write one.
 */
function isCommentable(item: WorkspaceItem): boolean {
  return entityTypeOf(item) !== 'BROWSER';
}

function toComment(row: CommentRow, nameById: Map<string, string>): ItemComment {
  return {
    id: row.id,
    itemId: row.entityId,
    body: row.body,
    author: { id: row.createdBy, name: nameById.get(row.createdBy) ?? '' },
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.anchorQuote
      ? {
          anchor: {
            quote: row.anchorQuote,
            ...(row.anchorSelector ? { selector: row.anchorSelector } : {}),
          },
        }
      : {}),
    ...(row.resolved ? { resolved: true } : {}),
  };
}

async function runMutation(zero: Zero, mutation: unknown): Promise<void> {
  const response = await zero.mutate(mutation).server;
  if (response.type === 'error') throw new Error(response.error?.message ?? 'Mutation failed');
}

/**
 * Points the shared comment layer at this client. A comment is scoped by the
 * entity it hangs off, so the hub is resolved from the entity's placement edges
 * rather than carried here.
 */
export function setSdlcCommentContext(next: SdlcCommentContext): void {
  context = next;
  if (registered) return;
  registered = true;

  registerCommentStore('sdlc-item', {
    list: async item => {
      if (!context || !isCommentable(item)) return [];
      const rows = (await context.zero.run(
        queries.getSdlcItemComments({
          entityType: entityTypeOf(item),
          entityId: item.refId,
        }),
      )) as CommentRow[] | undefined;
      const names = await authorNames(context.zero);
      return (rows ?? []).map(row => toComment(row, names));
    },

    add: async (item, comment) => {
      if (!context) throw new Error('This hub is not open');
      if (!isCommentable(item)) throw new Error('This page is not part of the hub');
      const id = uuidv4();
      const timestamp = Date.now();
      await runMutation(
        context.zero,
        mutators.sdlcItemComment.add({
          id,
          entityType: entityTypeOf(item),
          entityId: item.refId,
          body: comment.body,
          ...(comment.anchor?.quote ? { anchorQuote: comment.anchor.quote } : {}),
          ...(comment.anchor?.selector ? { anchorSelector: comment.anchor.selector } : {}),
          timestamp,
        }),
      );
      return toComment(
        {
          id,
          entityId: item.refId,
          body: comment.body,
          anchorQuote: comment.anchor?.quote ?? null,
          anchorSelector: comment.anchor?.selector ?? null,
          resolved: false,
          createdBy: '',
          createdAt: timestamp,
        },
        await authorNames(context.zero),
      );
    },

    resolve: async (_item, commentId, resolved) => {
      if (!context) throw new Error('This hub is not open');
      await runMutation(
        context.zero,
        mutators.sdlcItemComment.setResolved({
          commentId,
          resolved,
          timestamp: Date.now(),
        }),
      );
    },
  });
}
