import { randomUUID } from 'node:crypto'
import { promises as fsPromises } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { config } from '@/config/env'
import { logger } from '@/utils/logger'
import {
  isAppSyncPdfLibSemaphoreTimeoutError,
  withAppSyncPdfLibPermit,
} from './pdfLibSemaphore'
import { DoclingService } from '@/services/fileProcessor/DoclingService'
import { PdfJsStrategy } from '@/services/fileProcessor/strategies/PdfJsStrategy'
import type { ProcessingResult, ChunkMetadata } from '@/services/fileProcessor/types'

// ─── Constants ───────────────────────────────────────────────────────────────

export const PDF_PROCESSING_METHOD = {
  OCR: 'lightonocr-sync',
  DOCLING: 'docling',
  PDFJS: 'pdfjs',
} as const

export type PdfProcessingMethod =
  (typeof PDF_PROCESSING_METHOD)[keyof typeof PDF_PROCESSING_METHOD]

const DEFAULT_DOCLING_TIMEOUT_FALLBACK_MS = 30 * 60 * 1000
const DOCLING_TIMEOUT_PER_PAGE_MS = 15 * 1000
const DOCLING_TIMEOUT_PER_100KB_MS = 10 * 1000
const ONE_HUNDRED_KB_BYTES = 100 * 1024

// ─── Types ───────────────────────────────────────────────────────────────────

type DoclingPreflight = {
  pageCount: number | null
  timeoutMs: number
  usedFallbackTimeout: boolean
}

export type DoclingPageChunkResult = {
  result: ProcessingResult
  partIndex: number
  startPage: number
  endPage: number
  totalPages: number
}

export type DoclingPageChunk = {
  buffer: Buffer
  partIndex: number
  startPage: number
  endPage: number
  totalPages: number
  partDocId: string
  partFileName: string
}

export type DoclingStagedPart = Omit<DoclingPageChunk, 'buffer'> & {
  partPath: string
  partSizeBytes: number
}

export type DoclingStagedParts = {
  fileId: string
  vespaDocId: string
  sourcePath: string
  sourceSize: number | null
  sourceMtimeMs: number | null
  fileName: string
  totalPages: number
  pageChunkSize: number
  partsTotal: number
  stageDir: string
  partsDir: string
  manifestPath: string
  parts: DoclingStagedPart[]
}

export type LoadedPdfDocument = {
  document: PDFDocument
  pageCount: number
}

type PdfLoadContext = {
  fileId?: string
  fileName?: string
}

type PdfMetadata = {
  pageCount: number
  fileSizeBytes: number
}

/** Thrown when a PDF exceeds the configured page count limit. */
export class PdfPageCountExceededError extends Error {
  constructor(
    public readonly pageCount: number,
    public readonly maxPageCount: number,
  ) {
    super(`PDF page count ${pageCount} exceeds maximum ${maxPageCount}`)
    this.name = 'PdfPageCountExceededError'
  }
}

// ─── LightOnOCR sync client (xyne-spaces OCR engine) ────────────────────────

interface LightOnOcrChunk {
  text?: string
  content?: string
  page_numbers?: number[]
  block_labels?: string[]
}
interface LightOnOcrResponse {
  toc?: { entries?: { section_number?: string; section_title?: string }[] }
  chunks?: LightOnOcrChunk[]
  image_chunks?: LightOnOcrChunk[]
}

const mapLightOnOcrResponse = (data: LightOnOcrResponse): ProcessingResult => {
  const raw = data.chunks || []
  const chunks = raw.map((c) => c.text ?? c.content ?? '')
  const chunks_map: ChunkMetadata[] = raw.map((c, i) => ({
    chunk_index: i,
    page_numbers: Array.isArray(c.page_numbers) ? c.page_numbers : [],
    block_labels: Array.isArray(c.block_labels) ? c.block_labels : [],
  }))
  const image_chunks = (data.image_chunks || []).map((c) => c.text ?? c.content ?? '')
  const tocText = (data.toc?.entries || [])
    .map((e) => `${e.section_number ?? ''} ${e.section_title ?? ''}`.trim())
    .filter(Boolean)
    .join('\n')
  return {
    chunks,
    chunks_pos: chunks.map((_, i) => i),
    chunks_map,
    image_chunks,
    image_chunks_pos: image_chunks.map((_, i) => i),
    documentOutline: tocText || undefined,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function getConfiguredDoclingBaseTimeoutMs(): number {
  const raw = process.env.DOCLING_TIMEOUT_MS
  if (!raw) return DEFAULT_DOCLING_TIMEOUT_FALLBACK_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DOCLING_TIMEOUT_FALLBACK_MS
}

const DOCLING_BASE_TIMEOUT_MS = getConfiguredDoclingBaseTimeoutMs()

const getDoclingTempRoot = (): string => {
  const dir = process.env.DOCLING_TEMP_RESULTS_DIR || config.doclingScheduler.storageRoot
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
}

const writeJsonAtomically = async (targetPath: string, payload: unknown) => {
  const tmpPath = `${targetPath}.tmp`
  await fsPromises.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`)
  await fsPromises.rename(tmpPath, targetPath)
}

const getQpdfTimeoutMs = (): number => {
  const parsed = Number.parseInt(process.env.QPDF_TIMEOUT_MS || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000
}

const QPDF_OUTPUT_LOG_LIMIT = 4000

const truncateOutput = (value: string | null): string | null => {
  if (value === null || value.length <= QPDF_OUTPUT_LOG_LIMIT) return value
  return `${value.slice(0, QPDF_OUTPUT_LOG_LIMIT)}\n... truncated ${value.length - QPDF_OUTPUT_LOG_LIMIT} chars`
}

const runQpdfCommand = async (
  operation: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> => {
  const timeoutMs = getQpdfTimeoutMs()
  const startedAt = Date.now()

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const proc = spawn('qpdf', ['--no-warn', '--warning-exit-0', ...args])
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, timeoutMs)

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('error', (err) => {
      clearTimeout(timer)
      logger.error(`[PdfProcessor] qpdf ${operation} error: ${getErrorMessage(err)}`)
      reject(err)
    })

    proc.on('close', (exitCode) => {
      clearTimeout(timer)
      const elapsedMs = Date.now() - startedAt

      if (timedOut) {
        logger.error(`[PdfProcessor] qpdf ${operation} timed out after ${timeoutMs}ms`)
        return reject(new Error(`qpdf timed out after ${timeoutMs}ms for ${operation}`))
      }

      if (exitCode !== 0) {
        const output = truncateOutput(stderr || stdout)
        logger.error(`[PdfProcessor] qpdf ${operation} failed (exit ${exitCode}) elapsedMs=${elapsedMs}: ${output ?? ''}`)
        return reject(new Error(`qpdf exited with code ${exitCode} for ${operation}: ${output ?? ''}`))
      }

      logger.info(`[PdfProcessor] qpdf ${operation} completed in ${elapsedMs}ms`)
      resolve({ stdout, stderr })
    })
  })
}

const getQpdfPageCount = async (sourcePath: string): Promise<number> => {
  const { stdout } = await runQpdfCommand('page_count', ['--show-npages', sourcePath])
  const pageCount = Number.parseInt(stdout.trim(), 10)
  if (!Number.isFinite(pageCount) || pageCount <= 0) {
    throw new Error(`Invalid qpdf page count: ${stdout}`)
  }
  return pageCount
}

const extractQpdfPart = async (options: {
  sourcePath: string
  partPath: string
  startPage: number
  endPage: number
}): Promise<number> => {
  const tmpPartPath = `${options.partPath}.tmp`
  const qpdfStartPage = options.startPage + 1
  const qpdfEndPage = options.endPage
  await fsPromises.rm(tmpPartPath, { force: true }).catch(() => undefined)
  try {
    await runQpdfCommand('extract_part', [
      '--empty', '--pages', options.sourcePath,
      `${qpdfStartPage}-${qpdfEndPage}`, '--', tmpPartPath,
    ])
    await fsPromises.rename(tmpPartPath, options.partPath)
    const stats = await fsPromises.stat(options.partPath)
    return stats.size
  } catch (error) {
    await fsPromises.rm(tmpPartPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export function calculateDoclingTimeoutMs(
  fileSizeBytes: number,
  pageCount: number | null,
  baseTimeoutMs: number = DOCLING_BASE_TIMEOUT_MS,
): DoclingPreflight {
  if (
    !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 ||
    !Number.isFinite(pageCount) || (pageCount as number) <= 0
  ) {
    return { pageCount: pageCount ?? null, timeoutMs: DEFAULT_DOCLING_TIMEOUT_FALLBACK_MS, usedFallbackTimeout: true }
  }
  const sizeUnits = Math.ceil(fileSizeBytes / ONE_HUNDRED_KB_BYTES)
  const timeoutMs =
    baseTimeoutMs +
    (pageCount as number) * DOCLING_TIMEOUT_PER_PAGE_MS +
    sizeUnits * DOCLING_TIMEOUT_PER_100KB_MS
  return { pageCount: pageCount as number, timeoutMs, usedFallbackTimeout: false }
}

// ─── PdfProcessor ────────────────────────────────────────────────────────────

export class PdfProcessor {
  private static normalizeChunkMetadata(
    metadata: ChunkMetadata[] | undefined,
    totalCount: number,
  ): ChunkMetadata[] {
    if (Array.isArray(metadata) && metadata.length === totalCount) {
      return metadata.map((entry, index) => ({
        chunk_index:
          typeof entry?.chunk_index === 'number' && entry.chunk_index >= 0
            ? entry.chunk_index
            : index,
        page_numbers: Array.isArray(entry?.page_numbers) ? entry.page_numbers : [],
        block_labels: Array.isArray(entry?.block_labels) ? entry.block_labels : [],
      }))
    }
    return Array.from({ length: totalCount }, (_, index) => ({
      chunk_index: index,
      page_numbers: [],
      block_labels: [],
    }))
  }

  private static ensurePositions(items: unknown[], positions?: number[]): number[] {
    if (Array.isArray(positions) && positions.length === items.length) return positions
    return items.map((_, index) => index)
  }

  private static finalizeResult(
    payload: ProcessingResult,
    method: PdfProcessingMethod,
  ): ProcessingResult {
    const chunks = payload.chunks ?? []
    const image_chunks = payload.image_chunks ?? []
    return {
      chunks,
      chunks_pos: this.ensurePositions(chunks, payload.chunks_pos),
      image_chunks,
      image_chunks_pos: this.ensurePositions(image_chunks, payload.image_chunks_pos),
      chunks_map: this.normalizeChunkMetadata(payload.chunks_map, chunks.length),
      image_chunks_map: this.normalizeChunkMetadata(payload.image_chunks_map, image_chunks.length),
      processingMethod: method,
      documentOutline: payload.documentOutline,
    }
  }

  // ── OCR engine: LightOnOCR sync (xyne-spaces) ─────────────────────────────

  private static async processWithLightOnOcr(
    buffer: Buffer,
    fileName: string,
    vespaDocId: string,
  ): Promise<ProcessingResult> {
    const { url, timeoutMs } = config.pdf.lightOnOcr
    if (!url) throw new Error('LightOnOCR sync URL not configured')

    const form = new FormData()
    form.append(
      'file',
      new Blob([buffer as unknown as Uint8Array], { type: 'application/pdf' }),
      fileName,
    )
    form.append('doc_id', vespaDocId)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let resp: Response
    try {
      resp = await fetch(`${url.replace(/\/+$/, '')}/process`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`LightOnOCR /process failed: ${resp.status} ${body.slice(0, 200)}`)
    }
    return this.finalizeResult(
      mapLightOnOcrResponse((await resp.json()) as LightOnOcrResponse),
      PDF_PROCESSING_METHOD.OCR,
    )
  }

  // ── Docling engine ─────────────────────────────────────────────────────────

  private static async processWithDocling(
    buffer: Buffer,
    fileName: string,
    _vespaDocId: string,
    preflight: DoclingPreflight,
  ): Promise<ProcessingResult> {
    logger.info(
      `[PdfProcessor] Docling preflight timeoutMs=${preflight.timeoutMs} pageCount=${preflight.pageCount ?? 'unknown'} fallback=${preflight.usedFallbackTimeout} fileSizeBytes=${buffer.length} fileName=${fileName}`,
    )
    const docling = new DoclingService()
    const health = await docling.checkHealth()
    if (!health.healthy) throw new Error(`Docling unhealthy: ${health.error ?? 'unknown'}`)
    return this.finalizeResult(await docling.processDocument(buffer, fileName), PDF_PROCESSING_METHOD.DOCLING)
  }

  // ── PdfJs engine ──────────────────────────────────────────────────────────

  private static async processWithPdfJs(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
    return this.finalizeResult(await new PdfJsStrategy().parse(buffer, vespaDocId), PDF_PROCESSING_METHOD.PDFJS)
  }

  // ── PDF-lib load ───────────────────────────────────────────────────────────

  static async loadDocument(
    buffer: Buffer,
    context: PdfLoadContext = {},
  ): Promise<LoadedPdfDocument | null> {
    const startedAt = Date.now()
    try {
      return await withAppSyncPdfLibPermit(
        { operation: 'load_document', fileSizeBytes: buffer.length, ...context },
        async () => {
          const document = await PDFDocument.load(buffer, { ignoreEncryption: true })
          const pageCount = document.getPageCount()
          logger.info(`[PdfProcessor] PDF-lib load_document completed pageCount=${pageCount} elapsedMs=${Date.now() - startedAt} fileId=${context.fileId ?? ''}`)
          return { document, pageCount }
        },
      )
    } catch (error) {
      if (isAppSyncPdfLibSemaphoreTimeoutError(error)) throw error
      logger.error(`[PdfProcessor] PDF-lib load_document failed elapsedMs=${Date.now() - startedAt}: ${getErrorMessage(error)}`)
      return null
    }
  }

  static async loadDocumentMetadataFromFile(
    sourcePath: string,
    context: PdfLoadContext = {},
  ): Promise<PdfMetadata | null> {
    const startedAt = Date.now()
    try {
      return await withAppSyncPdfLibPermit(
        { operation: 'qpdf_page_count', sourcePath, ...context },
        async () => {
          const sourceStats = await fsPromises.stat(sourcePath)
          const pageCount = await getQpdfPageCount(sourcePath)
          const metadata = { pageCount, fileSizeBytes: sourceStats.size }
          logger.info(`[PdfProcessor] qpdf page count completed pageCount=${pageCount} fileSizeBytes=${sourceStats.size} elapsedMs=${Date.now() - startedAt}`)
          return metadata
        },
      )
    } catch (error) {
      if (isAppSyncPdfLibSemaphoreTimeoutError(error)) throw error
      logger.error(`[PdfProcessor] qpdf page count failed sourcePath=${sourcePath} elapsedMs=${Date.now() - startedAt}: ${getErrorMessage(error)}`)
      throw error
    }
  }

  private static async getPdfPageCount(buffer: Buffer): Promise<number | null> {
    const loaded = await this.loadDocument(buffer)
    return loaded?.pageCount ?? null
  }

  // ── processWithFallback ────────────────────────────────────────────────────

  /**
   * Processes a PDF using the fallback ladder:
   * 1. OCR — LightOnOCR sync (if configured), else Docling (if configured)
   * 2. PdfJs (final, always available)
   *
   * Set PDF_PROCESSING_DISABLE_FALLBACKS=true to fail on the first engine error.
   * Set useOCR=false to skip step 1 (used by async→sync recovery when OCR already failed).
   */
  static async processWithFallback(
    buffer: Buffer,
    fileName: string,
    vespaDocId: string,
    useOCR: boolean = true,
  ): Promise<ProcessingResult> {
    const pageCount = await this.getPdfPageCount(buffer)
    if (pageCount !== null && pageCount > config.pdf.maxPdfPageCount) {
      throw new PdfPageCountExceededError(pageCount, config.pdf.maxPdfPageCount)
    }
    const disableFallbacks = config.pdf.disableFallbacks

    // Step 1: OCR (LightOnOCR sync → Docling)
    if (useOCR) {
      try {
        if (config.pdf.lightOnOcr.enabled) {
          logger.info(`[PdfProcessor] Trying LightOnOCR (sync) for ${fileName}`)
          return await this.processWithLightOnOcr(buffer, fileName, vespaDocId)
        }
        if (config.docling.enabled && config.docling.baseUrl) {
          logger.info(`[PdfProcessor] Trying Docling for ${fileName}`)
          const preflight = calculateDoclingTimeoutMs(buffer.length, pageCount)
          return await this.processWithDocling(buffer, fileName, vespaDocId, preflight)
        }
      } catch (error) {
        if (disableFallbacks) throw error
        logger.warn(`[PdfProcessor] OCR step failed for ${fileName}, falling back to PdfJs: ${getErrorMessage(error)}`)
      }
    } else {
      logger.info(`[PdfProcessor] OCR disabled for ${fileName}, using PdfJs directly`)
    }

    // Step 2: PdfJs (final)
    try {
      logger.info(`[PdfProcessor] Trying PdfJs for ${fileName}`)
      return await this.processWithPdfJs(buffer, vespaDocId)
    } catch (error) {
      logger.error(`[PdfProcessor] All PDF strategies failed for ${fileName}: ${getErrorMessage(error)}`)
      throw error
    }
  }

  static async getPageCount(buffer: Buffer): Promise<number | null> {
    return this.getPdfPageCount(buffer)
  }

  static getMaxPdfPageCount(): number {
    return config.pdf.maxPdfPageCount
  }

  // ── Staging utilities (pdf-lib, in-memory) ─────────────────────────────────

  private static formatPartIndex(partIndex: number): string {
    return String(partIndex).padStart(5, '0')
  }

  static async stageDoclingPageParts(options: {
    fileId: string
    source: LoadedPdfDocument
    sourcePath: string
    fileName: string
    vespaDocId: string
    pageChunkSize?: number
    knownTotalPages?: number | null
  }): Promise<DoclingStagedParts> {
    const pageChunkSize = options.pageChunkSize ?? config.doclingScheduler.pageChunkSize
    if (!Number.isFinite(pageChunkSize) || pageChunkSize <= 0) {
      throw new Error('Docling page chunk size must be greater than zero')
    }

    const totalPages =
      typeof options.knownTotalPages === 'number' &&
      Number.isFinite(options.knownTotalPages) &&
      options.knownTotalPages > 0
        ? options.knownTotalPages
        : options.source.pageCount

    if (totalPages > config.pdf.maxPdfPageCount) {
      throw new PdfPageCountExceededError(totalPages, config.pdf.maxPdfPageCount)
    }

    const stageDir = path.join(getDoclingTempRoot(), options.fileId, randomUUID())
    const partsDir = path.join(stageDir, 'parts')
    const manifestPath = path.join(stageDir, 'manifest.json')
    await fsPromises.mkdir(partsDir, { recursive: true })

    try {
      const sourceStats = await fsPromises.stat(options.sourcePath).catch(() => null)
      const parts: DoclingStagedPart[] = []

      logger.info(`[PdfProcessor] pdf-lib staging starting fileId=${options.fileId} totalPages=${totalPages} pageChunkSize=${pageChunkSize} stageDir=${stageDir}`)

      let partIndex = 0
      for (let startPage = 0; startPage < totalPages; startPage += pageChunkSize) {
        const endPage = Math.min(startPage + pageChunkSize, totalPages)
        const pageIndexes = Array.from({ length: endPage - startPage }, (_, i) => startPage + i)
        const partFileStem = this.formatPartIndex(partIndex)
        const partPath = path.join(partsDir, `${partFileStem}.pdf`)
        const tmpPartPath = `${partPath}.tmp`

        const partBuffer = await withAppSyncPdfLibPermit(
          { operation: 'stage_part', fileId: options.fileId, partIndex, startPage, endPage, totalPages },
          async () => {
            const partDoc = await PDFDocument.create()
            const copiedPages = await partDoc.copyPages(options.source.document, pageIndexes)
            for (const page of copiedPages) partDoc.addPage(page)
            return Buffer.from(await partDoc.save())
          },
        )

        await fsPromises.writeFile(tmpPartPath, partBuffer)
        await fsPromises.rename(tmpPartPath, partPath)

        parts.push({
          partIndex,
          startPage,
          endPage,
          totalPages,
          partDocId: `${options.vespaDocId}__docling_part_${partIndex}`,
          partFileName: `${options.fileName}.pages-${startPage + 1}-${endPage}.pdf`,
          partPath,
          partSizeBytes: partBuffer.length,
        })

        logger.info(`[PdfProcessor] staged part partIndex=${partIndex} pages=${startPage + 1}-${endPage} sizeBytes=${partBuffer.length}`)
        partIndex += 1
      }

      const stagedParts: DoclingStagedParts = {
        fileId: options.fileId,
        vespaDocId: options.vespaDocId,
        sourcePath: options.sourcePath,
        sourceSize: sourceStats?.size ?? null,
        sourceMtimeMs: sourceStats?.mtimeMs ?? null,
        fileName: options.fileName,
        totalPages,
        pageChunkSize,
        partsTotal: parts.length,
        stageDir,
        partsDir,
        manifestPath,
        parts,
      }

      await writeJsonAtomically(manifestPath, {
        ...stagedParts,
        parts: stagedParts.parts.map((p) => ({ ...p, partPath: path.relative(stageDir, p.partPath) })),
      })

      logger.info(`[PdfProcessor] pdf-lib staging completed fileId=${options.fileId} partsTotal=${parts.length}`)
      return stagedParts
    } catch (error) {
      logger.error(`[PdfProcessor] pdf-lib staging failed fileId=${options.fileId}: ${getErrorMessage(error)}`)
      if (!config.doclingScheduler.keepTempResults) {
        await fsPromises.rm(stageDir, { recursive: true, force: true }).catch(() => undefined)
      }
      throw error
    }
  }

  // ── Staging utilities (qpdf CLI, file-based) ───────────────────────────────

  static async stageDoclingPagePartsFromFile(options: {
    fileId: string
    sourcePath: string
    fileName: string
    vespaDocId: string
    pageChunkSize?: number
    knownTotalPages?: number | null
    stageRootPath?: string
  }): Promise<DoclingStagedParts> {
    const pageChunkSize = options.pageChunkSize ?? config.doclingScheduler.pageChunkSize
    if (!Number.isFinite(pageChunkSize) || pageChunkSize <= 0) {
      throw new Error('Docling page chunk size must be greater than zero')
    }

    const startedAt = Date.now()
    try {
      const stagedParts = await withAppSyncPdfLibPermit(
        { operation: 'qpdf_stage_file', fileId: options.fileId, fileName: options.fileName },
        async () => {
          const sourceStats = await fsPromises.stat(options.sourcePath).catch(() => null)
          const totalPages =
            typeof options.knownTotalPages === 'number' &&
            Number.isFinite(options.knownTotalPages) &&
            options.knownTotalPages > 0
              ? options.knownTotalPages
              : await getQpdfPageCount(options.sourcePath)

          if (totalPages > config.pdf.maxPdfPageCount) {
            throw new PdfPageCountExceededError(totalPages, config.pdf.maxPdfPageCount)
          }

          const stageDir = path.join(
            options.stageRootPath || getDoclingTempRoot(),
            options.fileId,
            randomUUID(),
          )
          const partsDir = path.join(stageDir, 'parts')
          const manifestPath = path.join(stageDir, 'manifest.json')
          await fsPromises.mkdir(partsDir, { recursive: true })
          const parts: DoclingStagedPart[] = []

          logger.info(`[PdfProcessor] qpdf staging starting fileId=${options.fileId} totalPages=${totalPages} pageChunkSize=${pageChunkSize} stageDir=${stageDir}`)

          try {
            let partIndex = 0
            for (let startPage = 0; startPage < totalPages; startPage += pageChunkSize) {
              const endPage = Math.min(startPage + pageChunkSize, totalPages)
              const partFileStem = this.formatPartIndex(partIndex)
              const partPath = path.join(partsDir, `${partFileStem}.pdf`)
              const partSizeBytes = await extractQpdfPart({
                sourcePath: options.sourcePath,
                partPath,
                startPage,
                endPage,
              })

              parts.push({
                partIndex,
                startPage,
                endPage,
                totalPages,
                partDocId: `${options.vespaDocId}__docling_part_${partIndex}`,
                partFileName: `${options.fileName}.pages-${startPage + 1}-${endPage}.pdf`,
                partPath,
                partSizeBytes,
              })

              logger.info(`[PdfProcessor] qpdf staged part partIndex=${partIndex} pages=${startPage + 1}-${endPage} sizeBytes=${partSizeBytes}`)
              partIndex += 1
            }

            const result: DoclingStagedParts = {
              fileId: options.fileId,
              vespaDocId: options.vespaDocId,
              sourcePath: options.sourcePath,
              sourceSize: sourceStats?.size ?? null,
              sourceMtimeMs: sourceStats?.mtimeMs ?? null,
              fileName: options.fileName,
              totalPages,
              pageChunkSize,
              partsTotal: parts.length,
              stageDir,
              partsDir,
              manifestPath,
              parts,
            }

            await writeJsonAtomically(manifestPath, {
              ...result,
              parts: result.parts.map((p) => ({ ...p, partPath: path.relative(stageDir, p.partPath) })),
            })

            return result
          } catch (error) {
            if (!config.doclingScheduler.keepTempResults) {
              await fsPromises.rm(stageDir, { recursive: true, force: true }).catch(() => undefined)
              await fsPromises.rmdir(path.dirname(stageDir)).catch(() => undefined)
            }
            throw error
          }
        },
      )

      logger.info(`[PdfProcessor] qpdf staging completed fileId=${options.fileId} partsTotal=${stagedParts.partsTotal} elapsedMs=${Date.now() - startedAt}`)
      return stagedParts
    } catch (error) {
      logger.error(`[PdfProcessor] qpdf staging failed fileId=${options.fileId} elapsedMs=${Date.now() - startedAt}: ${getErrorMessage(error)}`)
      throw error
    }
  }

  // ── Read / delete staged parts ─────────────────────────────────────────────

  static async readStagedPartBuffer(part: DoclingStagedPart): Promise<Buffer> {
    logger.info(`[PdfProcessor] reading staged part partIndex=${part.partIndex} pages=${part.startPage + 1}-${part.endPage} partPath=${part.partPath}`)
    return fsPromises.readFile(part.partPath)
  }

  static async deleteStagedPart(part: DoclingStagedPart): Promise<void> {
    return this.deleteStagedPartPath(part.partPath)
  }

  static async deleteStagedPartPath(partPath?: string | null): Promise<void> {
    if (config.doclingScheduler.keepTempResults || !partPath) return
    await fsPromises.rm(partPath, { force: true })
  }

  static async cleanupStagedDoclingParts(stagedParts: DoclingStagedParts | null | undefined): Promise<void> {
    return this.cleanupStagedDoclingDir(stagedParts?.stageDir, {
      fileId: stagedParts?.fileId,
      fileName: stagedParts?.fileName,
    })
  }

  static async cleanupStagedDoclingDir(
    stageDir?: string | null,
    context?: { fileId?: string; fileName?: string },
  ): Promise<void> {
    if (config.doclingScheduler.keepTempResults || !stageDir) return
    try {
      await fsPromises.rm(stageDir, { recursive: true, force: true })
    } catch (error) {
      logger.warn(`[PdfProcessor] Failed to cleanup staged parts stageDir=${stageDir} fileId=${context?.fileId ?? ''}: ${getErrorMessage(error)}`)
    }
  }

  // ── Streaming page chunk generator (pdf-lib) ───────────────────────────────

  static async *splitIntoPageChunks(
    source: Buffer | LoadedPdfDocument,
    fileName: string,
    vespaDocId: string,
    pageChunkSize: number = config.doclingScheduler.pageChunkSize,
    knownTotalPages?: number | null,
  ): AsyncGenerator<DoclingPageChunk> {
    if (!Number.isFinite(pageChunkSize) || pageChunkSize <= 0) {
      throw new Error('Docling page chunk size must be greater than zero')
    }

    const loadedDocument = Buffer.isBuffer(source) ? await this.loadDocument(source) : source
    if (!loadedDocument) throw new Error('Failed to load PDF for Docling page chunk processing')

    const totalPages =
      typeof knownTotalPages === 'number' && Number.isFinite(knownTotalPages) && knownTotalPages > 0
        ? knownTotalPages
        : loadedDocument.pageCount

    if (totalPages > config.pdf.maxPdfPageCount) {
      throw new PdfPageCountExceededError(totalPages, config.pdf.maxPdfPageCount)
    }

    let partIndex = 0
    for (let startPage = 0; startPage < totalPages; startPage += pageChunkSize) {
      const endPage = Math.min(startPage + pageChunkSize, totalPages)
      const pageIndexes = Array.from({ length: endPage - startPage }, (_, i) => startPage + i)

      const partBuffer = await withAppSyncPdfLibPermit(
        { operation: 'split_part', fileName, vespaDocId, partIndex, startPage, endPage, totalPages },
        async () => {
          const partDoc = await PDFDocument.create()
          const copiedPages = await partDoc.copyPages(loadedDocument.document, pageIndexes)
          for (const page of copiedPages) partDoc.addPage(page)
          return Buffer.from(await partDoc.save())
        },
      )

      const partDocId = `${vespaDocId}__docling_part_${partIndex}`
      const partFileName = `${fileName}.pages-${startPage + 1}-${endPage}.pdf`

      logger.info(`[PdfProcessor] page chunk partIndex=${partIndex} pages=${startPage + 1}-${endPage} sizeBytes=${partBuffer.length} fileName=${fileName}`)

      yield { buffer: partBuffer, partIndex, startPage, endPage, totalPages, partDocId, partFileName }
      partIndex += 1
    }
  }

  static async processStagedDoclingPart(part: DoclingStagedPart): Promise<DoclingPageChunkResult> {
    logger.info(`[PdfProcessor] processing staged part partIndex=${part.partIndex} pages=${part.startPage + 1}-${part.endPage} partPath=${part.partPath}`)
    const partBuffer = await fsPromises.readFile(part.partPath)
    const preflight = calculateDoclingTimeoutMs(partBuffer.length, part.endPage - part.startPage)
    const result = await this.processWithDocling(partBuffer, part.partFileName, part.partDocId, preflight)
    return { result, partIndex: part.partIndex, startPage: part.startPage, endPage: part.endPage, totalPages: part.totalPages }
  }
}
