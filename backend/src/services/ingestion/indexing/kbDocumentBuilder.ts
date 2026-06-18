export type MappedChunkMeta = {
  chunk_index: number
  page_numbers: number[]
  block_labels: string[]
  width: number
  height: number
  bbox_l: number | null
  bbox_t: number | null
  bbox_r: number | null
  bbox_b: number | null
  bboxes_json: string | null
  headings?: string[]
}

type ChunkMetadata = {
  chunk_index: number
  page_numbers?: number[]
  block_labels?: string[]
  width?: number
  height?: number
  bbox?: { l?: number; t?: number; r?: number; b?: number }
  bboxes?: Array<{ page_no?: number; [key: string]: unknown }>
  headings?: string[]
}

export const mapChunkMeta = (meta: ChunkMetadata, includeHeadings = false): MappedChunkMeta => {
  const result: MappedChunkMeta = {
    chunk_index: meta.chunk_index,
    page_numbers: meta.page_numbers || [],
    block_labels: meta.block_labels || [],
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bbox_l: null,
    bbox_t: null,
    bbox_r: null,
    bbox_b: null,
    bboxes_json: null,
  }

  if (
    meta.bbox &&
    typeof meta.bbox.l === 'number' &&
    typeof meta.bbox.t === 'number' &&
    typeof meta.bbox.r === 'number' &&
    typeof meta.bbox.b === 'number'
  ) {
    result.bbox_l = meta.bbox.l
    result.bbox_t = meta.bbox.t
    result.bbox_r = meta.bbox.r
    result.bbox_b = meta.bbox.b
  }

  if (Array.isArray(meta.bboxes) && meta.bboxes.length > 0) {
    try { result.bboxes_json = JSON.stringify(meta.bboxes) } catch { result.bboxes_json = null }
  }

  if (includeHeadings) {
    result.headings = meta.headings || []
  }

  return result
}

export function buildVespaFileName(file: {
  path: string
  fileName: string
  collectionName: string
}): string {
  const targetPath = file.path
  const reconstructedFilePath =
    targetPath === '/' ? file.fileName : targetPath.substring(1) + file.fileName
  return targetPath === '/'
    ? file.collectionName + targetPath + reconstructedFilePath
    : file.collectionName + targetPath + file.fileName
}

export function offsetChunkMetadata(meta: ChunkMetadata, chunkIndex: number, pageOffset: number): ChunkMetadata {
  return {
    ...meta,
    chunk_index: chunkIndex,
    page_numbers: (meta.page_numbers || []).map((page) => page + pageOffset),
    bboxes: meta.bboxes?.map((bbox) =>
      typeof bbox.page_no === 'number' ? { ...bbox, page_no: bbox.page_no + pageOffset } : bbox,
    ),
  }
}
