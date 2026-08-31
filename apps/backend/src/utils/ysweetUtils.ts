/**
 * Y-Sweet Utilities
 *
 * Common utilities for Y-Sweet document operations.
 */

import { DocumentManager, type ClientToken } from '@y-sweet/sdk';
import * as Y from 'yjs';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import {
  BlockNoteSchema,
  createStyleSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { mentionServerSpec } from 'blocknote-layout-server-utils';
import { config } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import { citationServerSpec } from '@/utils/canvasCitationSpec.js';
import type { BlockNoteBlock } from '@/types/blockNoteTypes.js';

const canvasCommentThreadStyleSpec = createStyleSpec(
  {
    type: 'canvasCommentThread',
    propSchema: 'string',
  },
  {
    render: () => {
      const doc = (globalThis as unknown as {
        document?: { createElement: (tagName: string) => unknown };
      }).document;
      const span = doc?.createElement('span') ?? {};
      return {
        dom: span,
        contentDOM: span,
      } as never;
    },
    parse: element =>
      (element as unknown as { getAttribute?: (name: string) => string | null }).getAttribute?.(
        'data-canvas-comment-thread-id',
      ) ?? undefined,
  },
);

function createServerSchema() {
  return BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      mention: mentionServerSpec,
      // Register "citation" so blocksToYDoc/blocksToYXmlFragment preserve the
      // call-summary citation chips into Y-Sweet instead of silently dropping them.
      citation: citationServerSpec,
    },
    styleSpecs: {
      ...defaultStyleSpecs,
      canvasCommentThread: canvasCommentThreadStyleSpec,
    },
  });
}

function createServerEditor() {
  return ServerBlockNoteEditor.create({ schema: createServerSchema() });
}
type ServerEditor = ReturnType<typeof createServerEditor>;

let sharedServerEditor: ServerEditor | null = null;
function getServerEditor(): ServerEditor {
  if (!sharedServerEditor) {
    sharedServerEditor = createServerEditor();
  }
  return sharedServerEditor;
}

/**
 * Y-Sweet XML fragment name used by the frontend collaborative editor
 */
export const YSWEET_XML_FRAGMENT = 'document-store';

/**
 * Override client token URLs to use direct Y-Sweet URL instead of proxy URL.
 * This fixes 403 Forbidden errors caused by incorrect proxy routing.
 * 
 * @param clientToken - The client token to override
 * @param ysweetUrl - The direct Y-Sweet URL
 * @param originalBaseUrl - The original base URL from the token
 */
function overrideTokenUrls(
  clientToken: { baseUrl: string; url: string },
  ysweetUrl: string,
  originalBaseUrl: string
): void {
  const originalUrl = new URL(originalBaseUrl);
  // Strip /ysweet proxy prefix from pathname, direct server serves at root
  const pathname = originalUrl.pathname.replace(/^\/ysweet(?=\/|$)/, '');
  const fullPath = pathname + originalUrl.search;
  
  // Override both HTTP baseUrl and WebSocket url
  clientToken.baseUrl = ysweetUrl + fullPath;
  clientToken.url = clientToken.url.replace(/^\/ysweet(?=\/|$)/, '');
  
  logger.debug(`[YSweetUtils] URL override: "${originalBaseUrl}" -> "${clientToken.baseUrl}"`);
}

export class YSweetHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`y-sweet ${path} responded ${status}`);
    this.name = 'YSweetHttpError';
  }
}

export interface YSweetAuthRequest {
  authorization: 'full' | 'read-only';
  validForSeconds?: number;
}

function withDocId(base: string, path: string, docId: string): string {
  return `${base.replace(/\/$/, '')}/${path}?docId=${encodeURIComponent(docId)}&z=${Date.now().toString(36)}`;
}

async function ysweetRequest(url: string, path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new YSweetHttpError(res.status, path);
  }
  return res;
}

async function ysweetJson<T>(base: string, path: string, docId: string, body: unknown): Promise<T> {
  const res = await ysweetRequest(withDocId(base, path, docId), path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** POST /doc/new */
export async function ysweetCreateDoc(docId: string): Promise<void> {
  await ysweetJson(config.ysweet.url, 'doc/new', docId, { docId });
}

export function ysweetGetClientToken(docId: string, auth: YSweetAuthRequest): Promise<ClientToken> {
  return ysweetJson<ClientToken>(config.ysweet.url, `doc/${encodeURIComponent(docId)}/auth`, docId, auth);
}

export async function ysweetGetOrCreateDocAndToken(
  docId: string,
  auth: YSweetAuthRequest,
): Promise<ClientToken> {
  try {
    return await ysweetGetClientToken(docId, auth);
  } catch (error) {
    if (!(error instanceof YSweetHttpError) || error.status !== 404) {
      throw error;
    }
    await ysweetCreateDoc(docId);
    return ysweetGetClientToken(docId, auth);
  }
}

function tokenHeaders(clientToken: ClientToken): Record<string, string> {
  return clientToken.token ? { Authorization: `Bearer ${clientToken.token}` } : {};
}

export async function ysweetGetAsUpdate(clientToken: ClientToken): Promise<Uint8Array> {
  const path = 'as-update';
  const res = await ysweetRequest(withDocId(clientToken.baseUrl, path, clientToken.docId), path, {
    method: 'GET',
    headers: tokenHeaders(clientToken),
  });
  return new Uint8Array(await res.arrayBuffer());
}

export async function ysweetUpdateDoc(clientToken: ClientToken, update: Uint8Array): Promise<void> {
  const path = 'update';
  await ysweetRequest(withDocId(clientToken.baseUrl, path, clientToken.docId), path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...tokenHeaders(clientToken) },
    body: update,
  });
}

/**
 * Initialize a Y-Sweet document with BlockNote content.
 * This ensures the collaborative editor has content when first opened.
 *
 * @param canvasId - The document ID (canvas ID)
 * @param blocks - BlockNote blocks to initialize the document with
 * @returns true if initialization was successful, false otherwise
 */
export async function initializeYSweetDoc(
  canvasId: string,
  blocks: BlockNoteBlock[]
): Promise<boolean> {
  try {
    const ysweetUrl = config.ysweet.url;
    if (!ysweetUrl) {
      logger.warn('[YSweetUtils] Y-Sweet URL not configured, skipping Y-Sweet initialization');
      return false;
    }

    // Step 1: Make sure the document exists and get a write token for it
    const clientToken = await ysweetGetOrCreateDocAndToken(canvasId, {
      authorization: 'full',
    });
    logger.debug(`[YSweetUtils] Created/retrieved Y-Sweet document for canvas ${canvasId}`);

    // Step 2: Convert BlockNote blocks to Y.Doc format
    const editor = getServerEditor();
    const ydoc = editor.blocksToYDoc(blocks as any, YSWEET_XML_FRAGMENT);

    // Step 3: Encode the state as an update
    const update = Y.encodeStateAsUpdate(ydoc);

    // Step 4: Override URLs to use direct Y-Sweet URL instead of proxy URL
    overrideTokenUrls(clientToken, ysweetUrl, clientToken.baseUrl);

    // Step 5: Update the document with initial content
    await ysweetUpdateDoc(clientToken, update);

    logger.info(`[YSweetUtils] Successfully initialized Y-Sweet document for canvas ${canvasId} with ${blocks.length} blocks`);
    return true;
  } catch (error) {
    // Log error but don't fail the entire operation
    logger.error('[YSweetUtils] Failed to initialize Y-Sweet document:', error);
    return false;
  }
}

/**
 * Sync BlockNote content to an existing Y-Sweet document for collaborative editing.
 * This ensures the collaborative editor shows the AI-updated content.
 *
 * The approach:
 * 1. Get existing Y.Doc state from Y-Sweet (if any)
 * 2. Apply it to a new Y.Doc to get the current state
 * 3. Clear the existing content in the XmlFragment
 * 4. Insert the new content from BlockNote blocks
 * 5. Push the diff update to Y-Sweet
 *
 * @param canvasId - The document ID (canvas ID)
 * @param blocks - BlockNote blocks to sync to the document
 * @returns true if sync was successful, false otherwise
 */
export async function syncToYSweet(canvasId: string, blocks: BlockNoteBlock[]): Promise<boolean> {
  try {
    const ysweetUrl = config.ysweet.url;
    if (!ysweetUrl) {
      logger.warn('[YSweetUtils] Y-Sweet URL not configured, skipping Y-Sweet sync');
      return false;
    }

    // Get a client token with full authorization for write operations
    const clientToken = await ysweetGetOrCreateDocAndToken(canvasId, {
      authorization: 'full',
    });

    // Override URLs before both read and write so backend uses the internal Y-Sweet service.
    overrideTokenUrls(clientToken, ysweetUrl, clientToken.baseUrl);

    // Create a new Y.Doc to work with
    const ydoc = new Y.Doc();

    // Get the existing document state from Y-Sweet
    try {
      const existingUpdate = await ysweetGetAsUpdate(clientToken);
      if (existingUpdate && existingUpdate.length > 0) {
        // Apply existing state to our doc
        Y.applyUpdate(ydoc, existingUpdate);
        logger.debug(`[YSweetUtils] Retrieved existing Y-Sweet state for canvas ${canvasId}`);
      }
    } catch (getError) {
      // Document might not exist yet, that's okay
      logger.debug(`[YSweetUtils] No existing Y-Sweet state for canvas ${canvasId}, creating new`);
    }

    // Get the XmlFragment that BlockNote uses
    const fragment = ydoc.getXmlFragment(YSWEET_XML_FRAGMENT);

    // Use ServerBlockNoteEditor.blocksToYXmlFragment to directly populate the fragment
    // This is more efficient than creating an intermediate Y.Doc and cloning elements
    const editor = getServerEditor();
    
    ydoc.transact(() => {
      // Clear existing content
      fragment.delete(0, fragment.length);
      // Directly populate fragment with new blocks
      editor.blocksToYXmlFragment(blocks as any, fragment);
    });

    // Encode the state diff as an update
    const update = Y.encodeStateAsUpdate(ydoc);

    // Push the update to Y-Sweet with full authorization
    await ysweetUpdateDoc(clientToken, update);

    logger.info(`[YSweetUtils] Successfully synced content to Y-Sweet for canvas ${canvasId}`);
    return true;
  } catch (error) {
    // Log error but don't fail the entire operation
    logger.error('[YSweetUtils] Failed to sync to Y-Sweet:', error);
    return false;
  }
}

/**
 * Read BlockNote content from a Y-Sweet document.
 * This retrieves the content stored in Y-Sweet for collaborative editing.
 *
 * @param canvasId - The document ID (canvas ID)
 * @returns Array of BlockNote blocks, or empty array if unable to read
 */
export async function readFromYSweet(canvasId: string): Promise<BlockNoteBlock[]> {
  try {
    const ysweetUrl = config.ysweet.url;
    if (!ysweetUrl) {
      logger.warn('[YSweetUtils] Y-Sweet URL not configured, returning empty content');
      return [];
    }

    // Get a client token with read-only authorization
    const clientToken = await ysweetGetClientToken(canvasId, {
      authorization: 'read-only',
    });

    // Override URLs to use direct Y-Sweet URL instead of proxy URL
    overrideTokenUrls(clientToken, ysweetUrl, clientToken.baseUrl);

    const existingUpdate = await ysweetGetAsUpdate(clientToken);

    if (!existingUpdate || existingUpdate.length === 0) {
      logger.debug(`[YSweetUtils] No existing Y-Sweet state for canvas ${canvasId}`);
      return [];
    }

    // Create a new Y.Doc and apply the existing state
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, existingUpdate);

    // Convert Y.Doc back to BlockNote blocks using ServerBlockNoteEditor
    const editor = getServerEditor();
    const blocks = editor.yDocToBlocks(ydoc, YSWEET_XML_FRAGMENT);

    logger.info(`[YSweetUtils] Successfully read ${blocks.length} blocks from Y-Sweet for canvas ${canvasId}`);
    return blocks as BlockNoteBlock[];
  } catch (error) {
    logger.error('[YSweetUtils] Failed to read from Y-Sweet:', error);
    return [];
  }
}

/**
 * Get a Y-Sweet DocumentManager instance.
 * Useful for other Y-Sweet operations beyond initialization.
 *
 * @returns DocumentManager instance or null if Y-Sweet is not configured
 */
export function getYSweetManager(): DocumentManager | null {
  const ysweetUrl = config.ysweet.url;
  if (!ysweetUrl) {
    logger.warn('[YSweetUtils] Y-Sweet URL not configured');
    return null;
  }
  return new DocumentManager(ysweetUrl);
}
