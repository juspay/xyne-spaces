import { db } from '@/database/client'
import { logger } from '@/utils/logger'
import { NAMESPACE } from '@/vespa/vespaConfig'
import vespaConfig from '@/vespa/vespaConfig'
import type { Collection } from '@prisma/client'

// In xyne-spaces, collection and folder documents share the file schema.
// (xyne-search uses a dedicated 'kb_items' schema; that schema is not present here.)
const KbItemsSchema = 'file'

const KB_METADATA_SYNC_LEASE_MS = 5 * 60 * 1000
const KB_METADATA_SYNC_RETRY_BASE_MS = 30 * 1000
const KB_METADATA_SYNC_RETRY_MAX_MS = 10 * 60 * 1000
const KB_METADATA_SYNC_WRITE_TIMEOUT_MS = 30 * 1000
const KB_METADATA_SYNC_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
} as const
const REQUIRED_METADATA_SYNC_COLUMNS = [
  'vespa_metadata_sync_status',
  'vespa_metadata_sync_attempts',
  'vespa_metadata_sync_next_attempt_at',
]

type KbMetadataSyncTarget =
  | { kind: 'collection'; id: string }
  | { kind: 'folder'; id: string }

type KbMetadataSyncBatchResult = {
  collections: { claimed: number; synced: number; failed: number }
  folders: { claimed: number; synced: number; failed: number }
}

const toEpochMs = (value: Date | string | number | null | undefined): number =>
  value ? new Date(value).getTime() : Date.now()

const retryBackoffMs = (attempt: number): number =>
  Math.min(KB_METADATA_SYNC_RETRY_MAX_MS, KB_METADATA_SYNC_RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0))

let kbMetadataSyncColumnsAvailable: Promise<boolean> | null = null
let loggedMissingKbMetadataSyncColumns = false

const hasKbMetadataSyncColumns = async (): Promise<boolean> => {
  kbMetadataSyncColumnsAvailable ??= (async () => {
    const rows = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('collections', 'collection_items')
        AND column_name IN (
          'vespa_metadata_sync_status',
          'vespa_metadata_sync_attempts',
          'vespa_metadata_sync_next_attempt_at'
        )
    `
    const columnsByTable = new Map<string, Set<string>>()
    for (const row of rows) {
      const columns = columnsByTable.get(row.table_name) || new Set<string>()
      columns.add(row.column_name)
      columnsByTable.set(row.table_name, columns)
    }
    return ['collections', 'collection_items'].every((table) => {
      const columns = columnsByTable.get(table)
      return REQUIRED_METADATA_SYNC_COLUMNS.every((col) => columns?.has(col))
    })
  })()

  const available = await kbMetadataSyncColumnsAvailable
  if (!available && !loggedMissingKbMetadataSyncColumns) {
    loggedMissingKbMetadataSyncColumns = true
    logger.warn('Skipping KB metadata Vespa repair because metadata sync columns are absent', {
      requiredColumns: REQUIRED_METADATA_SYNC_COLUMNS,
    })
  }
  return available
}

// In xyne-spaces, Collection.id is used as the Vespa docId
// (xyne-search uses a dedicated vespaDocId field).
// In xyne-spaces, folders are Collection rows with parentId !== null.
export const buildCollectionVespaDocument = (collection: Collection) => {
  return {
    docId: collection.id,
    clId: collection.id,
    itemId: collection.id,
    fileName: collection.name,
    app: 'knowledge_base',
    entity: 'collection',
    description: collection.description || '',
    storagePath: '',
    chunks: [],
    image_chunks: [],
    chunks_pos: [],
    image_chunks_pos: [],
    chunks_map: [],
    image_chunks_map: [],
    metadata: JSON.stringify({
      version: '1.0',
      lastModified: toEpochMs(collection.updatedAt),
    }),
    createdBy: collection.ownerId,
    duration: 0,
    mimeType: 'knowledge_base',
    fileSize: 0,
    createdAt: toEpochMs(collection.createdAt),
    updatedAt: toEpochMs(collection.updatedAt),
    clFd: null,
  }
}

// In xyne-spaces, folders are Collection rows with parentId !== null
// (xyne-search uses CollectionItem rows with type='folder').
export const buildFolderVespaDocument = (folder: Collection) => {
  if (!folder.parentId) {
    throw new Error(`Collection ${folder.id} is not a folder (parentId is null)`)
  }
  return {
    docId: folder.id,
    clId: folder.rootCollectionId || folder.id,
    itemId: folder.id,
    app: 'knowledge_base',
    fileName: folder.name,
    entity: 'folder',
    description: folder.description || '',
    storagePath: '',
    chunks: [],
    image_chunks: [],
    chunks_pos: [],
    image_chunks_pos: [],
    chunks_map: [],
    image_chunks_map: [],
    metadata: JSON.stringify({
      version: '1.0',
      lastModified: toEpochMs(folder.updatedAt),
    }),
    createdBy: folder.ownerId,
    duration: 0,
    mimeType: 'folder',
    fileSize: 0,
    createdAt: toEpochMs(folder.createdAt),
    updatedAt: toEpochMs(folder.updatedAt),
    clFd: folder.parentId,
  }
}

const upsertKbItemInVespa = async (vespaDoc: Record<string, unknown>) => {
  const docId = String(vespaDoc.docId || '')
  if (!docId) throw new Error('Missing Vespa docId for KB metadata sync')

  const url = `${vespaConfig.vespaEndpoint.feedEndpoint}/document/v1/${NAMESPACE}/${KbItemsSchema}/docid/${encodeURIComponent(docId)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(KB_METADATA_SYNC_WRITE_TIMEOUT_MS),
    body: JSON.stringify({ fields: vespaDoc }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText)
    throw new Error(
      `Vespa KB metadata write failed: ${response.status} ${response.statusText} ${body.slice(0, 500)}`,
    )
  }
}

const claimCollectionMetadataRows = async (limit: number): Promise<Collection[]> => {
  if (limit <= 0) return []
  return db.$transaction(async (tx) => {
    const idRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM collections
      WHERE deleted_at IS NULL
        AND (
          vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PENDING}
          OR (
            vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.FAILED}
            AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
          )
          OR (
            vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
            AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
          )
        )
      ORDER BY COALESCE(vespa_metadata_sync_next_attempt_at, created_at), created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `
    const ids = idRows.map((r) => r.id).filter(Boolean)
    if (!ids.length) return []
    const leaseUntil = new Date(Date.now() + KB_METADATA_SYNC_LEASE_MS)
    return tx.$queryRaw<Collection[]>`
      UPDATE collections
      SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING},
          vespa_metadata_sync_next_attempt_at = ${leaseUntil}
      WHERE id = ANY(${ids}::text[])
      RETURNING *
    `
  })
}

const claimFolderMetadataRows = async (limit: number): Promise<Collection[]> => {
  if (limit <= 0) return []
  return db.$transaction(async (tx) => {
    const idRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM collections
      WHERE parent_id IS NOT NULL
        AND deleted_at IS NULL
        AND (
          vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PENDING}
          OR (
            vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.FAILED}
            AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
          )
          OR (
            vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
            AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
          )
        )
      ORDER BY COALESCE(vespa_metadata_sync_next_attempt_at, created_at), created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `
    const ids = idRows.map((r) => r.id).filter(Boolean)
    if (!ids.length) return []
    const leaseUntil = new Date(Date.now() + KB_METADATA_SYNC_LEASE_MS)
    return tx.$queryRaw<Collection[]>`
      UPDATE collections
      SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING},
          vespa_metadata_sync_next_attempt_at = ${leaseUntil}
      WHERE id = ANY(${ids}::text[])
        AND parent_id IS NOT NULL
      RETURNING *
    `
  })
}

const claimCollectionMetadataById = async (collectionId: string): Promise<Collection | null> => {
  const leaseUntil = new Date(Date.now() + KB_METADATA_SYNC_LEASE_MS)
  const rows = await db.$queryRaw<Collection[]>`
    UPDATE collections
    SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING},
        vespa_metadata_sync_next_attempt_at = ${leaseUntil}
    WHERE id = ${collectionId}
      AND deleted_at IS NULL
      AND (
        vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PENDING}
        OR (
          vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.FAILED}
          AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
        )
        OR (
          vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
          AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
        )
      )
    RETURNING *
  `
  return rows[0] || null
}

const claimFolderMetadataById = async (folderId: string): Promise<Collection | null> => {
  const leaseUntil = new Date(Date.now() + KB_METADATA_SYNC_LEASE_MS)
  const rows = await db.$queryRaw<Collection[]>`
    UPDATE collections
    SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING},
        vespa_metadata_sync_next_attempt_at = ${leaseUntil}
    WHERE id = ${folderId}
      AND parent_id IS NOT NULL
      AND deleted_at IS NULL
      AND (
        vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PENDING}
        OR (
          vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.FAILED}
          AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
        )
        OR (
          vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
          AND (vespa_metadata_sync_next_attempt_at IS NULL OR vespa_metadata_sync_next_attempt_at <= NOW())
        )
      )
    RETURNING *
  `
  return rows[0] || null
}

const markCollectionMetadataSyncSuccess = async (collection: Collection) => {
  await db.$executeRaw`
    UPDATE collections
    SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.SYNCED},
        vespa_metadata_sync_attempts = 0,
        vespa_metadata_sync_next_attempt_at = NULL
    WHERE id = ${collection.id}
      AND vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
  `
}

const markFolderMetadataSyncSuccess = async (folder: Collection) => {
  await db.$executeRaw`
    UPDATE collections
    SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.SYNCED},
        vespa_metadata_sync_attempts = 0,
        vespa_metadata_sync_next_attempt_at = NULL
    WHERE id = ${folder.id}
      AND vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
  `
}

const markCollectionMetadataSyncFailure = async (collection: Collection & { vespaMetadataSyncAttempts?: number }) => {
  const attempts = (collection.vespaMetadataSyncAttempts || 0) + 1
  const nextAttempt = new Date(Date.now() + retryBackoffMs(attempts))
  await db.$executeRaw`
    UPDATE collections
    SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.FAILED},
        vespa_metadata_sync_attempts = ${attempts},
        vespa_metadata_sync_next_attempt_at = ${nextAttempt}
    WHERE id = ${collection.id}
      AND vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
  `
}

const markFolderMetadataSyncFailure = async (folder: Collection & { vespaMetadataSyncAttempts?: number }) => {
  const attempts = (folder.vespaMetadataSyncAttempts || 0) + 1
  const nextAttempt = new Date(Date.now() + retryBackoffMs(attempts))
  await db.$executeRaw`
    UPDATE collections
    SET vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.FAILED},
        vespa_metadata_sync_attempts = ${attempts},
        vespa_metadata_sync_next_attempt_at = ${nextAttempt}
    WHERE id = ${folder.id}
      AND vespa_metadata_sync_status = ${KB_METADATA_SYNC_STATUS.PROCESSING}
  `
}

const syncClaimedCollection = async (collection: Collection): Promise<boolean> => {
  const startedAt = new Date()
  logger.info('KB collection metadata Vespa sync started', { collectionId: collection.id, startedAt })
  try {
    await upsertKbItemInVespa(buildCollectionVespaDocument(collection))
    await markCollectionMetadataSyncSuccess(collection)
    logger.info('KB collection metadata Vespa sync completed', { collectionId: collection.id, startedAt })
    return true
  } catch (error) {
    await markCollectionMetadataSyncFailure(collection)
    logger.warn('KB collection metadata Vespa sync failed', { err: error, collectionId: collection.id, startedAt })
    return false
  }
}

const syncClaimedFolder = async (folder: Collection): Promise<boolean> => {
  const startedAt = new Date()
  logger.info('KB folder metadata Vespa sync started', { folderId: folder.id, startedAt })
  try {
    await upsertKbItemInVespa(buildFolderVespaDocument(folder))
    await markFolderMetadataSyncSuccess(folder)
    logger.info('KB folder metadata Vespa sync completed', { folderId: folder.id, startedAt })
    return true
  } catch (error) {
    await markFolderMetadataSyncFailure(folder)
    logger.warn('KB folder metadata Vespa sync failed', { err: error, folderId: folder.id, startedAt })
    return false
  }
}

export const syncCollectionMetadataById = async (collectionId: string): Promise<boolean> => {
  const collection = await claimCollectionMetadataById(collectionId)
  if (!collection) return false
  return syncClaimedCollection(collection)
}

export const syncFolderMetadataById = async (folderId: string): Promise<boolean> => {
  const folder = await claimFolderMetadataById(folderId)
  if (!folder) return false
  return syncClaimedFolder(folder)
}

export const kickoffKbMetadataSync = (target: KbMetadataSyncTarget): void => {
  setTimeout(() => {
    const work =
      target.kind === 'collection'
        ? syncCollectionMetadataById(target.id)
        : syncFolderMetadataById(target.id)

    void work.catch((error) => {
      logger.warn('Best-effort KB metadata Vespa sync crashed', { err: error, target })
    })
  }, 0)
}

export const repairKbMetadataSyncBatch = async (
  options: { collectionLimit?: number; folderLimit?: number } = {},
): Promise<KbMetadataSyncBatchResult> => {
  const collectionLimit = options.collectionLimit ?? 50
  const folderLimit = options.folderLimit ?? 100
  const result: KbMetadataSyncBatchResult = {
    collections: { claimed: 0, synced: 0, failed: 0 },
    folders: { claimed: 0, synced: 0, failed: 0 },
  }

  if (!(await hasKbMetadataSyncColumns())) return result

  const claimedCollections = await claimCollectionMetadataRows(collectionLimit)
  result.collections.claimed = claimedCollections.length
  for (const collection of claimedCollections) {
    if (await syncClaimedCollection(collection)) result.collections.synced += 1
    else result.collections.failed += 1
  }

  const claimedFolders = await claimFolderMetadataRows(folderLimit)
  result.folders.claimed = claimedFolders.length
  for (const folder of claimedFolders) {
    if (await syncClaimedFolder(folder)) result.folders.synced += 1
    else result.folders.failed += 1
  }

  if (result.collections.claimed > 0 || result.folders.claimed > 0) {
    logger.info('Repaired due KB metadata Vespa sync rows from DB state', result)
  }

  return result
}
