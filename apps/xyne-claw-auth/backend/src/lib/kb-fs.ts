/**
 * A filesystem view over a Spaces KB collection.
 *
 * The collections API is id-addressed (`itemId`); an agent reasons in paths
 * (`services/livekit/service.md`). This module is the only place that mapping
 * exists, so everything above it can pretend the KB is a directory.
 *
 * Three facts about the API shape this file:
 *
 *  - **Folders auto-create on upload.** The upload endpoint walks the supplied
 *    `filePath` and creates any missing folder, so a nested page materialises
 *    in one call. There is no create-folder endpoint to call first.
 *  - **Updating means a new version, never a re-upload.** Re-uploading mints a
 *    fresh itemId, and itemIds are embedded in KB links; versioning keeps the
 *    id and the history.
 *  - **There is no usable server-side content search.** `/search` matches on
 *    filename only, and the Vespa-backed search returns ranked *chunks* — no
 *    line numbers, no completeness. Grep therefore runs locally over page text,
 *    which is why the session loads bodies once up front.
 *
 * Everything is session-scoped and in memory. Nothing is written to disk, so a
 * KB agent needs no working directory and no sandbox.
 */

import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { fetchAccessibleKb, type KbCollectionNode } from "./spaces-kb.js";
import { getSpacesAuthForUser } from "./spaces-db.js";
import { createLogger, createTraceId } from "../logger.js";

const log = createLogger("kb-fs", createTraceId());

/** Pages larger than this are almost certainly not hand-authored prose. */
const MAX_PAGE_CHARS = 200_000;

export interface KbGrepMatch {
  path: string;
  /** 1-indexed, so it reads like a real grep result. */
  line: number;
  text: string;
}

export interface KbWriteOutcome {
  path: string;
  status: "created" | "updated" | "unchanged";
}

export interface KbFsOptions {
  /**
   * Narrows the tree fetch to one scope. Root collections are channel-scoped,
   * so passing these avoids expanding every collection the caller can see just
   * to index one — worth setting whenever the caller knows the channel.
   */
  scopeType?: string;
  scopeId?: string;
}

export class KbFs {
  /** path -> itemId. The whole point of this class. */
  private readonly items = new Map<string, string>();
  /** path -> contents. Filled lazily; grep forces a full load. */
  private readonly bodies = new Map<string, string>();
  private loadedAll = false;
  /** Kept so reload() can repeat open()'s tree fetch with the same scope. */
  private userId = "";
  private options: KbFsOptions = {};

  private constructor(
    private readonly collectionId: string,
    private readonly auth: SpacesAuthContext,
  ) {}

  /**
   * Builds the path index for one collection.
   *
   * Paths are relative to the collection root, so the root's own name is not
   * part of them — `services/livekit/service.md`, not `Juspay Services/...`.
   */
  static async open(
    collectionId: string,
    userId: string,
    options: KbFsOptions = {},
  ): Promise<KbFs> {
    // One resolution of the Spaces session, shared by the tree fetch below and
    // by the raw upload/download calls that cannot go through spacesFetch.
    const startedAt = Date.now();
    const auth = await getSpacesAuthForUser(userId, "agent-chat");
    if (!auth) {
      throw new Error(`kb-fs: no active Spaces session for user ${userId}`);
    }

    const tree = await fetchAccessibleKb(userId, {
      includeItems: true,
      ...(options.scopeType ? { scopeType: options.scopeType } : {}),
      ...(options.scopeId ? { scopeId: options.scopeId } : {}),
    });
    if (tree === null) {
      throw new Error(`kb-fs: no active Spaces session for user ${userId}`);
    }

    const root = tree.find((c) => c.id === collectionId);
    if (!root) {
      throw new Error(
        `kb-fs: collection ${collectionId} not accessible` +
          (options.scopeId ? ` within scope ${options.scopeId}` : ""),
      );
    }

    const fs = new KbFs(collectionId, auth);
    fs.userId = userId;
    fs.options = options;

    const walk = (node: KbCollectionNode, prefix: string): void => {
      for (const item of node.items ?? []) {
        fs.items.set(prefix ? `${prefix}/${item.name}` : item.name, item.id);
      }
      for (const child of node.children ?? []) {
        walk(child, prefix ? `${prefix}/${child.name}` : child.name);
      }
    };
    walk(root, "");

    log.info(
      `[kb-fs] opened "${root.name}" (${collectionId}) for user=${userId}: ` +
        `${fs.items.size} pages in ${Date.now() - startedAt}ms` +
        (options.scopeId ? ` [scope ${options.scopeType ?? "?"}:${options.scopeId}]` : ""),
    );
    if (fs.items.size === 0) {
      // Not an error — a fresh collection is empty — but it is the state in
      // which an agent will create everything from scratch, so make it visible.
      log.warn(`[kb-fs] collection ${collectionId} contains no pages`);
    }
    return fs;
  }

  /** Every known path, optionally filtered by prefix. Free — index only. */
  list(prefix = ""): string[] {
    const paths = [...this.items.keys()];
    const filtered = prefix ? paths.filter((p) => p.startsWith(prefix)) : paths;
    return filtered.sort();
  }

  exists(path: string): boolean {
    return this.items.has(path);
  }

  /** Contents of one page, or null when the path is unknown. */
  async read(path: string): Promise<string | null> {
    const cached = this.bodies.get(path);
    if (cached !== undefined) return cached;

    const itemId = this.items.get(path);
    if (!itemId) return null;

    const text = await this.download(itemId);
    if (text !== null) this.bodies.set(path, text);
    return text;
  }

  /**
   * Literal search across every page, with line numbers.
   *
   * Loads all bodies on first call. At the scale this KB operates
   * (tens to low hundreds of pages) that is one pass of a few hundred KB, and
   * it is the only way to get grep semantics: the server can offer ranked
   * chunks, which have no line numbers and no completeness guarantee.
   */
  async grep(pattern: string | RegExp, pathPrefix = ""): Promise<KbGrepMatch[]> {
    await this.loadAll();

    const re =
      typeof pattern === "string"
        ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        : pattern;

    const matches: KbGrepMatch[] = [];
    for (const [path, body] of this.bodies) {
      if (pathPrefix && !path.startsWith(pathPrefix)) continue;
      const lines = body.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const text = lines[i] ?? "";
        if (re.test(text)) matches.push({ path, line: i + 1, text: text.trim() });
      }
    }
    return matches;
  }

  /**
   * Creates the page, or versions it when the content actually differs.
   *
   * The comparison is the point. Discovery re-runs are largely deterministic,
   * so most pages come back identical; versioning them anyway buries the few
   * real changes under dozens of no-op versions and makes the history — the
   * only reason to version at all — unreadable.
   */
  async write(path: string, content: string): Promise<KbWriteOutcome> {
    if (content.length > MAX_PAGE_CHARS) {
      throw new Error(`kb-fs: ${path} exceeds ${MAX_PAGE_CHARS} chars`);
    }

    let itemId = this.items.get(path);

    if (!itemId) {
      // The index is a snapshot from open(). Another session — the next merge
      // batch, a concurrent run — may have created this page since, and the
      // upload endpoint does NOT version on name collision: it creates a second
      // item and renames it "operations (1).md". That duplicate is permanent,
      // because nothing in the stack can delete a page. So confirm against the
      // live listing before creating.
      await this.reload();
      itemId = this.items.get(path);
    }

    if (!itemId) {
      const newId = await this.uploadNew(path, content);
      this.items.set(path, newId);
      this.bodies.set(path, content);
      return { path, status: "created" };
    }

    const current = await this.read(path);
    if (current !== null && current.trim() === content.trim()) {
      return { path, status: "unchanged" };
    }

    await this.uploadVersion(itemId, path, content);
    this.bodies.set(path, content);

    // Versioning creates a NEW collection_item row: `item.id` changes, only
    // `fileId` carries across (see createItemVersion). The version endpoint
    // returns just { success, versionNumber }, so the new id has to be looked
    // up — otherwise a second write to the same page in one session would use
    // the superseded id and 404. Links are unaffected: KB URLs key on fileId.
    await this.refreshItemId(path);

    return { path, status: "updated" };
  }

  /**
   * Replaces `oldText` with `newText` in one page.
   *
   * Fails unless `oldText` occurs exactly once. That single constraint is what
   * makes an agent's edits safe rather than hopeful: without it, changing one
   * alias silently rewrites every line that resembles it.
   */
  async edit(path: string, oldText: string, newText: string): Promise<KbWriteOutcome> {
    const body = await this.read(path);
    if (body === null) throw new Error(`kb-fs: ${path} not found`);

    const occurrences = body.split(oldText).length - 1;
    if (occurrences === 0) throw new Error(`kb-fs: text not found in ${path}`);
    if (occurrences > 1) {
      throw new Error(`kb-fs: text is not unique in ${path} (${occurrences} occurrences)`);
    }

    return this.write(path, body.replace(oldText, newText));
  }

  // There is deliberately no delete. itemIds are embedded in saved KB links,
  // and every other operation here is non-destructive; an obsolete page is
  // rewritten as a redirect stub, keeping its id and its history.

  // -------------------------------------------------------------------------

  /**
   * The one expensive operation here, so it is timed.
   *
   * Grep needs full text (the server can only offer ranked chunks, which have
   * no line numbers), so the first grep pays for every page. If this line ever
   * shows seconds rather than hundreds of milliseconds, the KB has outgrown
   * read-everything and grep needs a narrowing step in front of it.
   */
  /**
   * Re-reads the path→itemId index from the live collection.
   *
   * The index is a snapshot from open(); a page created by another session
   * since then is invisible to it. Only used before creating a page, where a
   * stale miss would produce a permanent duplicate.
   */
  private async reload(): Promise<void> {
    const tree = await fetchAccessibleKb(this.userId, {
      includeItems: true,
      ...(this.options.scopeType ? { scopeType: this.options.scopeType } : {}),
      ...(this.options.scopeId ? { scopeId: this.options.scopeId } : {}),
    });
    const root = tree?.find((c) => c.id === this.collectionId);
    if (!root) return;

    const before = this.items.size;
    this.items.clear();
    const walk = (node: KbCollectionNode, prefix: string): void => {
      for (const item of node.items ?? []) {
        this.items.set(prefix ? `${prefix}/${item.name}` : item.name, item.id);
      }
      for (const child of node.children ?? []) {
        walk(child, prefix ? `${prefix}/${child.name}` : child.name);
      }
    };
    walk(root, "");

    if (this.items.size !== before) {
      log.info(`[kb-fs] index reloaded: ${before} -> ${this.items.size} pages`);
    }
  }

  private async loadAll(): Promise<void> {
    if (this.loadedAll) return;

    const startedAt = Date.now();
    const alreadyCached = this.bodies.size;
    for (const path of this.items.keys()) {
      if (!this.bodies.has(path)) await this.read(path);
    }
    this.loadedAll = true;

    const fetched = this.bodies.size - alreadyCached;
    const totalChars = [...this.bodies.values()].reduce((sum, body) => sum + body.length, 0);
    log.info(
      `[kb-fs] loaded ${this.bodies.size} pages (${fetched} fetched, ${alreadyCached} cached), ` +
        `${Math.round(totalChars / 1024)}KB in ${Date.now() - startedAt}ms`,
    );

    const unreadable = this.items.size - this.bodies.size;
    if (unreadable > 0) {
      // Grep silently under-reports by exactly this many pages.
      log.warn(`[kb-fs] ${unreadable} of ${this.items.size} pages could not be read`);
    }
  }

  /**
   * Re-reads one path's itemId after it has been superseded by a new version.
   *
   * Costs one tree fetch. Only called on an actual content change, which is the
   * rare case — an unchanged write returns before reaching here.
   */
  private async refreshItemId(path: string): Promise<void> {
    try {
      const res = await this.rawFetch("/api/collections/accessible?includeItems=1", {
        method: "GET",
      });
      const body = (await res.json()) as { collections?: KbCollectionNode[] };
      const root = (body.collections ?? []).find((c) => c.id === this.collectionId);
      if (!root) return;

      const find = (node: KbCollectionNode, prefix: string): string | undefined => {
        for (const item of node.items ?? []) {
          if ((prefix ? `${prefix}/${item.name}` : item.name) === path) return item.id;
        }
        for (const child of node.children ?? []) {
          const hit = find(child, prefix ? `${prefix}/${child.name}` : child.name);
          if (hit) return hit;
        }
        return undefined;
      };

      const fresh = find(root, "");
      if (fresh) this.items.set(path, fresh);
      else log.warn(`[kb-fs] ${path} vanished from the tree after versioning`);
    } catch (err) {
      // The write succeeded; only the cached id is stale. Log and continue —
      // the next KbFs.open rebuilds it correctly.
      log.warn(`[kb-fs] could not refresh itemId for ${path}: ${String(err)}`);
    }
  }

  private async download(itemId: string): Promise<string | null> {
    try {
      const res = await this.rawFetch(`/api/collections/items/${itemId}/download`, {
        method: "GET",
      });
      return await res.text();
    } catch (err) {
      log.warn(`[kb-fs] download ${itemId} failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Creates a page, materialising any missing folders on the way.
   *
   * Two details, both verified against the running backend rather than assumed:
   *
   *  - The folder chain comes from a `paths` field: a JSON ARRAY, one entry per
   *    uploaded file, holding the DIRECTORY only. Sending the full path creates
   *    a folder named after the file (`services/x/service.md/service.md`), and
   *    sending `filePath` instead is ignored entirely, dropping the page into
   *    the collection root.
   *  - The response is `{ results: [{ fileName, itemId, status }] }` — not
   *    `{ items: [{ id }] }`.
   */
  private async uploadNew(path: string, content: string): Promise<string> {
    const form = new FormData();
    form.append("files", new File([content], basename(path), { type: "text/markdown" }));
    form.append("paths", JSON.stringify([dirname(path)]));

    const res = await this.rawFetch(`/api/collections/${this.collectionId}/upload`, {
      method: "POST",
      body: form,
    });

    const data = (await res.json()) as {
      results?: Array<{ itemId?: string; status?: string; error?: string }>;
    };
    const result = data.results?.[0];
    if (!result?.itemId || result.status !== "success") {
      throw new Error(
        `kb-fs: upload of ${path} failed: ${result?.error ?? JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return result.itemId;
  }

  private async uploadVersion(itemId: string, path: string, content: string): Promise<void> {
    const form = new FormData();
    form.append("file", new File([content], basename(path), { type: "text/markdown" }));
    await this.rawFetch(`/api/collections/items/${itemId}/versions`, {
      method: "POST",
      body: form,
    });
  }

  /**
   * spacesFetch cannot be used for these: it hardcodes
   * `Content-Type: application/json`, and multipart needs the boundary set by
   * the runtime, while download needs the raw body rather than parsed JSON.
   */
  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const { token, sessionId, workspaceId } = this.auth;
    if (!token) throw new Error("kb-fs: Spaces auth token missing");

    // Same resolution order spacesFetch uses, and the caller's baseUrl wins so
    // a session pointed at another deployment stays pointed at it.
    const baseUrl = (
      this.auth.baseUrl ??
      process.env["SPACES_BACKEND_URL"] ??
      process.env["XYNE_SPACES_URL"] ??
      ""
    ).replace(/\/+$/, "");
    if (!baseUrl) throw new Error("kb-fs: SPACES_BACKEND_URL not configured");

    const cookies: string[] = [];
    if (sessionId) cookies.push(`xyne_session=${sessionId}`, `user_session_id=${sessionId}`);
    if (workspaceId) cookies.push(`xyne_last_workspace=${workspaceId}`);

    const res = await fetch(new URL(path, `${baseUrl}/`).toString(), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(sessionId ? { "x-session-id": sessionId } : {}),
        ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`kb-fs: ${init.method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  }
}

function basename(path: string): string {
  return path.split("/").pop() ?? "page.md";
}

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}
