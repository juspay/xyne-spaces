// Backward-compat shim — the implementation moved to src/common/pdf/pdfProcessor.ts
// (mirrors xyne-search's server/common/pdf/pdfProcessor.ts structure).
export {
  PdfProcessor as PdfFallbackProcessor,
  PdfPageCountExceededError,
  PDF_PROCESSING_METHOD,
} from '@/common/pdf/pdfProcessor'
export type {
  PdfProcessingMethod,
  DoclingStagedPart,
  DoclingStagedParts,
  DoclingPageChunk,
  DoclingPageChunkResult,
  LoadedPdfDocument,
} from '@/common/pdf/pdfProcessor'
