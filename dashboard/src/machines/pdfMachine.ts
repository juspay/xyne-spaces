import { createMachine, assign, fromPromise } from 'xstate';
import { pdfjs } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

/* -------------------------- GLOBAL TYPE PATCHES -------------------------- */

declare global {
  interface Window {
    pdfjsWasmDir?: string;
  }
}

pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
(globalThis as unknown as Window).pdfjsWasmDir = '/pdfjs/wasm/';

/* -------------------------- TYPES -------------------------- */

export type PdfSource = File | ArrayBuffer | Uint8Array | string;

export interface PdfContext {
  source: PdfSource | null;
  doc: PDFDocumentProxy | null;
  numPages: number | null;
  initialPage: number;
  currentPage: number;
  scale: number;
  heightMap: number[];
  pageDimensions: { width: number; height: number } | null;
  error: string | null;
  retryCount: number;
}

export type PdfEvent =
  | { type: 'LOAD'; source: PdfSource; initialPage?: number }
  | { type: 'RETRY' }
  | { type: 'GOTO_PAGE'; page: number }
  | { type: 'NEXT_PAGE' }
  | { type: 'PREV_PAGE' }
  | { type: 'SCALE_CHANGED'; scale: number }
  | { type: 'RESIZE' };

/* -------------------------- MACHINE -------------------------- */

export const pdfMachine = createMachine(
  {
    id: 'pdfMachine',
    initial: 'idle',

    types: {
      context: {} as PdfContext,
      events: {} as PdfEvent,
    },

    context: {
      source: null,
      doc: null,
      numPages: null,
      initialPage: 1,
      currentPage: 1,
      scale: 1.2,
      heightMap: [],
      pageDimensions: null,
      error: null,
      retryCount: 0,
    },

    states: {
      /* ---------------- idle -------------------- */
      idle: {
        on: {
          LOAD: {
            target: 'loading',
            actions: assign(({ event }) => ({
              source: event.source,
              initialPage: event.initialPage ?? 1,
              error: null,
            })),
          },
        },
      },

      /* ---------------- loading PDF -------------------- */
      loading: {
        invoke: {
          src: 'loadPdfFile',
          input: ({ context }) => ({
            source: context.source as File, // safe because load only accepts File
          }),
          onDone: {
            target: 'calculatingScale',
            actions: assign(({ event, context }) => {
              const doc = event.output as PDFDocumentProxy;
              return {
                doc,
                numPages: doc.numPages,
                currentPage: context.initialPage,
                error: null,
              };
            }),
          },
          onError: {
            target: 'error',
            actions: assign(({ event }) => ({
              error: String(event.error),
            })),
          },
        },
      },

      /* ---------------- compute scale -------------------- */
      calculatingScale: {
        invoke: {
          src: 'computeScale',
          input: ({ context }) => ({
            doc: context.doc as PDFDocumentProxy,
          }),
          onDone: {
            target: 'computingHeights',
            actions: assign(({ event }) => {
              const out = event.output as {
                scale: number;
                pageDimensions: { width: number; height: number };
              };
              return {
                scale: out.scale,
                pageDimensions: out.pageDimensions,
              };
            }),
          },
          onError: {
            target: 'computingHeights',
          },
        },
      },

      /* ---------------- compute per-page heights -------------------- */
      computingHeights: {
        invoke: {
          src: 'computeHeightMap',
          input: ({ context }) => ({
            doc: context.doc as PDFDocumentProxy,
            scale: context.scale,
          }),
          onDone: {
            target: 'ready',
            actions: assign(({ event }) => ({
              heightMap: event.output as number[],
            })),
          },
          onError: {
            target: 'ready',
          },
        },
      },

      /* ---------------- ready -------------------- */
      ready: {
        on: {
          NEXT_PAGE: {
            actions: assign(({ context }) => ({
              currentPage: Math.min(context.numPages ?? 1, context.currentPage + 1),
            })),
          },

          PREV_PAGE: {
            actions: assign(({ context }) => ({
              currentPage: Math.max(1, context.currentPage - 1),
            })),
          },

          GOTO_PAGE: {
            actions: assign(({ context, event }) => ({
              currentPage: Math.min(Math.max(event.page, 1), context.numPages ?? event.page),
            })),
          },

          SCALE_CHANGED: {
            target: 'recomputingHeights',
            actions: assign(({ event }) => ({
              scale: event.scale,
            })),
          },

          RESIZE: 'calculatingScale',

          RETRY: {
            target: 'loading',
            actions: assign(({ context }) => ({
              retryCount: context.retryCount + 1,
              error: null,
            })),
          },

          LOAD: {
            target: 'loading',
            actions: assign(({ event }) => ({
              source: event.source,
              initialPage: event.initialPage ?? 1,
              error: null,
            })),
          },
        },
      },

      /* ---------------- recompute heights after scale -------------------- */
      recomputingHeights: {
        invoke: {
          src: 'computeHeightMap',
          input: ({ context }) => ({
            doc: context.doc as PDFDocumentProxy,
            scale: context.scale,
          }),
          onDone: {
            target: 'ready',
            actions: assign(({ event }) => ({
              heightMap: event.output as number[],
            })),
          },
          onError: {
            target: 'ready',
          },
        },
      },

      /* ---------------- error -------------------- */
      error: {
        on: {
          RETRY: {
            target: 'loading',
            actions: assign(({ context }) => ({
              retryCount: context.retryCount + 1,
              error: null,
            })),
          },
          LOAD: {
            target: 'loading',
            actions: assign(({ event }) => ({
              source: event.source,
              initialPage: event.initialPage ?? 1,
              error: null,
            })),
          },
        },
      },
    },
  },

  /* ---------------------------------- ACTOR IMPLEMENTATIONS ---------------------------------- */
  {
    actors: {
      loadPdfFile: fromPromise<PDFDocumentProxy, { source: File }>(async ({ input }) => {
        if (!input?.source) throw new Error('Missing source file');

        const arrayBuffer = await input.source.arrayBuffer();
        const task = pdfjs.getDocument({ data: arrayBuffer });

        return task.promise;
      }),

      computeScale: fromPromise<
        { scale: number; pageDimensions: { width: number; height: number } },
        { doc: PDFDocumentProxy }
      >(async ({ input }) => {
        const page = await input.doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });

        const containerWidth = Math.max(document.documentElement.clientWidth - 32, 320);

        const scale = Math.min(Math.max(containerWidth / vp.width, 0.5), 2.0);

        return {
          scale,
          pageDimensions: { width: vp.width, height: vp.height },
        };
      }),

      computeHeightMap: fromPromise<number[], { doc: PDFDocumentProxy; scale: number }>(
        async ({ input }) => {
          const pages = input.doc.numPages;
          const heights: Array<number> = new Array<number>(pages);

          for (let i = 1; i <= pages; i++) {
            try {
              const page = await input.doc.getPage(i);
              const vp = page.getViewport({ scale: input.scale });
              heights[i - 1] = vp.height;
            } catch {
              heights[i - 1] = Math.round(792 * input.scale);
            }
          }

          return heights;
        },
      ),
    },
  },
);

export default pdfMachine;
