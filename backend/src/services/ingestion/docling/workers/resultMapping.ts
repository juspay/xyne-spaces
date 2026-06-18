/**
 * Converts the OCR wrapper's Docling-style response into the per-part
 * `ProcessingResult` the writer aggregates. Ported (focused) from xyne-search
 * `processingResultFromDoclingResponse`.
 *
 * Phase 1: text chunks + page/block metadata + TOC. Saving the base64 `images`
 * map to GCS and richer bbox metadata are deferred (xyne-spaces' VespaChunkMeta
 * only carries chunk_index/page_numbers/block_labels anyway).
 */
import type { ProcessingResult, SchedulerChunkMeta } from '../types';

export interface DoclingChunk {
  text?: string;
  content?: string;
  headings?: string[];
  page_numbers?: number[];
  block_labels?: string[];
}

export interface DoclingResponse {
  metadata?: { filename?: string; num_pages?: number; processing_time?: number };
  toc?: { entries?: { section_number?: string; section_title?: string }[] };
  chunks?: DoclingChunk[];
  image_chunks?: DoclingChunk[];
  images?: Record<string, string>;
}

const chunkText = (chunk: DoclingChunk): string => chunk.text ?? chunk.content ?? '';

const toMeta = (chunk: DoclingChunk, index: number): SchedulerChunkMeta => ({
  chunk_index: index,
  page_numbers: Array.isArray(chunk.page_numbers) ? chunk.page_numbers : [],
  block_labels: Array.isArray(chunk.block_labels) ? chunk.block_labels : [],
});

/** Split a blob of text into ~maxChars pieces on paragraph boundaries. */
const splitToc = (text: string, maxChars = 512): string[] => {
  if (!text.trim()) return [];
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const para of paras) {
    if (buf && buf.length + para.length + 1 > maxChars) {
      out.push(buf);
      buf = '';
    }
    buf = buf ? `${buf}\n${para}` : para;
  }
  if (buf) out.push(buf);
  return out.length > 0 ? out : [text.slice(0, maxChars)];
};

export const processingResultFromDoclingResponse = (
  response: DoclingResponse,
): ProcessingResult => {
  const rawChunks = response.chunks || [];
  const rawImageChunks = response.image_chunks || [];

  const chunks = rawChunks.map(chunkText);
  const chunksMap = rawChunks.map(toMeta);
  const imageChunks = rawImageChunks.map(chunkText);
  const imageChunksMap = rawImageChunks.map(toMeta);

  const tocText = (response.toc?.entries || [])
    .map((e) => `${e.section_number ?? ''} ${e.section_title ?? ''}`.trim())
    .filter(Boolean)
    .join('\n');
  const tocChunks = splitToc(tocText);

  return {
    chunks,
    chunks_pos: chunks.map((_, i) => i),
    image_chunks: imageChunks,
    image_chunks_pos: imageChunks.map((_, i) => i),
    toc_chunks: tocChunks,
    chunks_map: chunksMap,
    image_chunks_map: imageChunksMap,
    processingMethod: 'docling',
  };
};
