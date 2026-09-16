/**
 * Unit tests for the docling scheduler staging storage.
 *
 * Staging always lives in the default storage bucket (via the storage-service
 * factory) under a fixed prefix; rows written by the old pod-local code carry
 * absolute filesystem paths and must still be readable from local disk
 * (rollout compatibility for in-flight files).
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/services/storage/storageServiceFactory', () => {
  const store = new Map<string, Buffer>()
  const service = {
    uploadFileV2: jest.fn(async (buffer: Buffer, options: { path: string; contentType: string }) => {
      if (!buffer || buffer.length === 0) throw new Error('File buffer is empty or invalid')
      if (!options.path) throw new Error('Path is required')
      store.set(options.path, buffer)
      return { filename: options.path, path: options.path, size: buffer.length }
    }),
    getFileBuffer: jest.fn(async (key: string) => {
      const buffer = store.get(key)
      if (!buffer) throw new Error(`File does not exist in GCS: ${key}`)
      return buffer
    }),
    listFiles: jest.fn(async (prefix: string) =>
      Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name })),
    ),
    deleteFile: jest.fn(async (filename: string) => ({ filename, deleted: store.delete(filename) })),
  }
  return { getStorageService: () => service, __store: store, __service: service }
})

import {
  partKey,
  resultKey,
  stagingPaths,
  writePartBuffer,
  writeJson,
  readBuffer,
  readJson,
  cleanupStage,
  isMissingObjectError,
} from '../storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storageFactory = jest.requireMock('@/services/storage/storageServiceFactory') as any

const fileBufferOf = (key: string): Buffer => storageFactory.__store.get(key) as Buffer

const legacyRoot = path.join(os.tmpdir(), `docling-legacy-stage-${process.pid}-${Date.now()}`)

describe('docling scheduler staging storage', () => {
  beforeEach(() => {
    storageFactory.__store.clear()
    storageFactory.__service.uploadFileV2.mockClear()
    storageFactory.__service.getFileBuffer.mockClear()
    storageFactory.__service.listFiles.mockClear()
    storageFactory.__service.deleteFile.mockClear()
  })

  afterAll(async () => {
    await fs.rm(legacyRoot, { recursive: true, force: true })
  })

  describe('staging key layout', () => {
    it('builds relative object keys for parts, results and manifest', () => {
      expect(partKey('f1', 0)).toBe('docling-staging/f1/parts/00000.pdf')
      expect(partKey('f1', 12)).toBe('docling-staging/f1/parts/00012.pdf')
      expect(resultKey('f1', 3)).toBe('docling-staging/f1/results/00003.json')

      const paths = stagingPaths('f1')
      expect(paths.stageDir).toBe('docling-staging/f1')
      expect(paths.partsDir).toBe('docling-staging/f1/parts')
      expect(paths.resultsDir).toBe('docling-staging/f1/results')
      expect(paths.manifestPath).toBe('docling-staging/f1/manifest.json')
    })

    it('never produces keys with a leading slash', () => {
      expect(partKey('f1', 0).startsWith('/')).toBe(false)
      expect(resultKey('f1', 0).startsWith('/')).toBe(false)
      expect(stagingPaths('f1').manifestPath.startsWith('/')).toBe(false)
    })
  })

  describe('object-storage staging (new rows)', () => {
    it('writes result JSON to the storage service and reads it back', async () => {
      const result = { chunks: ['a', 'b'], chunks_pos: ['0', '1'] }
      const key = resultKey('f1', 0)
      await writeJson(key, result)

      expect(storageFactory.__service.uploadFileV2).toHaveBeenCalledTimes(1)
      expect(storageFactory.__service.uploadFileV2).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ path: key, contentType: 'application/json' }),
      )

      const roundTripped = await readJson<typeof result>(key)
      expect(roundTripped).toEqual(result)
    })

    it('writes part PDFs with the pdf content type and reads them back', async () => {
      const bytes = Buffer.from('%PDF-1.4 fake-part-bytes')
      const key = partKey('f1', 1)
      await writePartBuffer(key, bytes)

      expect(storageFactory.__service.uploadFileV2).toHaveBeenCalledWith(
        bytes,
        expect.objectContaining({ path: key, contentType: 'application/pdf' }),
      )
      expect(await readBuffer(key)).toEqual(bytes)
    })

    it('reads through the storage service for relative keys', async () => {
      await writeJson(resultKey('f2', 0), { ok: true })
      storageFactory.__service.getFileBuffer.mockClear()
      await readJson(resultKey('f2', 0))
      expect(storageFactory.__service.getFileBuffer).toHaveBeenCalledWith('docling-staging/f2/results/00000.json')
    })
  })

  describe('legacy pod-local paths (in-flight rows)', () => {
    it('reads absolute local paths from the filesystem', async () => {
      const legacyDir = path.join(legacyRoot, 'legacy-file', 'results')
      await fs.mkdir(legacyDir, { recursive: true })
      const legacyPath = path.join(legacyDir, '00000.json')
      await fs.writeFile(legacyPath, JSON.stringify({ chunks: ['legacy'] }), 'utf-8')

      const parsed = await readJson<{ chunks: string[] }>(legacyPath)
      expect(parsed).toEqual({ chunks: ['legacy'] })
      expect(storageFactory.__service.getFileBuffer).not.toHaveBeenCalled()
    })

    it('reads raw buffers from absolute local paths', async () => {
      const legacyDir = path.join(legacyRoot, 'legacy-file', 'parts')
      await fs.mkdir(legacyDir, { recursive: true })
      const legacyPath = path.join(legacyDir, '00000.pdf')
      const bytes = Buffer.from('%PDF-legacy')
      await fs.writeFile(legacyPath, bytes)

      expect(await readBuffer(legacyPath)).toEqual(bytes)
    })
  })

  describe('isMissingObjectError', () => {
    it('recognises a missing object from every storage provider and from disk', () => {
      expect(isMissingObjectError(new Error('File does not exist in GCS: docling-staging/f1/parts/00000.pdf'))).toBe(true)
      expect(isMissingObjectError(new Error('S3 file read failed after 3 attempts: NoSuchKey: ...'))).toBe(true)
      expect(isMissingObjectError(new Error('Azure Blob read failed after 3 attempts: BlobNotFound'))).toBe(true)
      expect(isMissingObjectError(new Error("ENOENT: no such file or directory, open '/tmp/x'"))).toBe(true)
    })

    it('leaves other failures alone so they keep retrying', () => {
      expect(isMissingObjectError(new Error('GCS upload failed: socket hang up'))).toBe(false)
      expect(isMissingObjectError(new Error('403 Forbidden'))).toBe(false)
      // A DB failure inside the splitter must not be mistaken for a missing part
      // and fail the file terminally.
      expect(isMissingObjectError(new Error('relation "docling_async_parts" does not exist'))).toBe(false)
    })
  })

  describe('cleanupStage', () => {
    it("deletes every staged object under the file prefix and leaves other files' staging alone", async () => {
      await writePartBuffer(partKey('f3', 0), Buffer.from('p0'))
      await writePartBuffer(partKey('f3', 1), Buffer.from('p1'))
      await writeJson(resultKey('f3', 0), { chunks: [] })
      await writeJson(resultKey('other-file', 0), { chunks: [] })

      await cleanupStage('f3')

      expect(fileBufferOf('docling-staging/f3/parts/00000.pdf')).toBeUndefined()
      expect(fileBufferOf('docling-staging/f3/parts/00001.pdf')).toBeUndefined()
      expect(fileBufferOf('docling-staging/f3/results/00000.json')).toBeUndefined()
      expect(fileBufferOf('docling-staging/other-file/results/00000.json')).toBeDefined()
    })

    it('deletes objects in batches and swallows individual delete failures', async () => {
      for (let i = 0; i < 40; i += 1) {
        await writePartBuffer(partKey('f4', i), Buffer.from(`p${i}`))
      }
      storageFactory.__service.deleteFile.mockImplementationOnce(async () => {
        throw new Error('transient delete failure')
      })

      await expect(cleanupStage('f4')).resolves.toBeUndefined()
      expect(storageFactory.__service.deleteFile).toHaveBeenCalledTimes(40)
    })
  })
})
