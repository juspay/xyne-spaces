import { logger, Event as LogEvent } from '../utils/logger';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useDocumentOperations } from '../contexts/DocumentOperationsContext';
import {
  findHighlightMatches,
  type HighlightMatch as ClientHighlightMatch,
} from '../utils/textHighlighting';

type Options = {
  caseSensitive?: boolean;
  highlightClass?: string;
  activeClass?: string;
  debug?: boolean; // Enable debug logging
  documentId?: string | undefined; // Document ID for caching
};

// Cache duration constant - defined at module scope to prevent re-declaration on each render
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
  matches: ClientHighlightMatch[];
  timestamp: number;
};

type HighlightCache = {
  [key: string]: CacheEntry;
};

const isScrollable = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  return (
    (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight
  );
};

/** react-pdf uses 1-based `data-page-number`; chunk API uses 0-based page index. */
function findPdfPageRoot(root: HTMLElement, pageIndex0: number): HTMLElement | null {
  if (pageIndex0 < 0) return null;
  const selector = `[data-page-number="${pageIndex0 + 1}"]`;
  // Check if root itself matches the selector
  if (root.matches(selector)) {
    return root;
  }
  return root.querySelector<HTMLElement>(selector);
}

export function useScopedFind(
  containerRef: React.RefObject<HTMLElement | null>,
  opts: Options = {},
) {
  const { documentOperationsRef } = useDocumentOperations();
  const {
    caseSensitive = true,
    highlightClass = 'bg-yellow-200/60 dark:bg-yellow-200/40 rounded-sm px-0.5 py-px',
    debug = false,
    documentId,
  } = opts;

  // Cache for API responses
  const cacheRef = useRef<HighlightCache>({});

  // Cancellation token to prevent race conditions
  const callTokenRef = useRef<number>(0);

  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Generate cache key based on document ID, chunk index, page (PDF scope), and options
  const generateCacheKey = useCallback(
    (docId: string | undefined, chunkIdx: number | null | undefined, pageIdx?: number): string => {
      const keyComponents = [
        docId || 'no-doc-id',
        chunkIdx !== null && chunkIdx !== undefined ? chunkIdx.toString() : 'no-chunk-idx',
        pageIdx !== undefined && pageIdx >= 0 ? `p${pageIdx}` : 'p-na',
      ];
      return keyComponents.join('|');
    },
    [],
  );

  // Clean expired cache entries
  const cleanExpiredCache = useCallback(() => {
    const now = Date.now();
    const cache = cacheRef.current;
    Object.keys(cache).forEach(key => {
      if ((cache[key]?.timestamp ?? 0) - now < -CACHE_DURATION) {
        delete cache[key];
      }
    });
  }, []);

  // Extract text content from the container
  const extractContainerText = useCallback((container: HTMLElement): string => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = (n as Text).parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
        if (!(n as Text).nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let text = '';
    let node: Node | null;
    while ((node = walker.nextNode())) {
      text += (node as Text).nodeValue;
    }

    return text;
  }, []);

  // Detect if we're in a PDF context
  const isPDFContext = useCallback((container: HTMLElement): boolean => {
    // Check if container or any parent has PDF-specific classes
    let element: HTMLElement | null = container;
    while (element) {
      if (
        element.classList.contains('react-pdf__Page') ||
        element.classList.contains('pdf-page-wrapper') ||
        element.classList.contains('simple-pdf-viewer') ||
        element.querySelector('.react-pdf__Page') !== null
      ) {
        return true;
      }
      element = element.parentElement;
    }
    return false;
  }, []);

  // Create highlight marks using <mark> elements (for non-PDF content)
  const createMarkHighlights = useCallback(
    (container: HTMLElement, match: ClientHighlightMatch): HTMLElement[] => {
      const marks: HTMLElement[] = [];

      try {
        // Find all text nodes and their positions
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
          acceptNode(n) {
            const p = (n as Text).parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            const tag = p.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
            if (!n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });

        const textNodes: { node: Text; start: number; end: number }[] = [];
        let currentPos = 0;
        let node: Node | null;

        // Build a map of text nodes and their positions
        while ((node = walker.nextNode())) {
          const textNode = node as Text;
          const nodeLength = textNode.nodeValue!.length;
          textNodes.push({
            node: textNode,
            start: currentPos,
            end: currentPos + nodeLength,
          });
          currentPos += nodeLength;
        }

        // Find all text nodes that intersect with our match
        const intersectingNodes = textNodes.filter(
          ({ start, end }) => start < match.endIndex && end > match.startIndex,
        );

        for (const { node: textNode, start: nodeStart } of intersectingNodes) {
          const startOffset = Math.max(0, match.startIndex - nodeStart);
          const endOffset = Math.min(textNode.nodeValue!.length, match.endIndex - nodeStart);

          if (startOffset < endOffset) {
            try {
              const range = document.createRange();
              range.setStart(textNode, startOffset);
              range.setEnd(textNode, endOffset);

              // Create and insert the mark
              const mark = document.createElement('mark');
              mark.className = `${highlightClass}`;
              mark.setAttribute('data-match-index', '0');

              try {
                range.surroundContents(mark);
                marks.push(mark);
              } catch (rangeError) {
                logger.warn(LogEvent.FRONTEND_ERROR, {
                  type: 'migrated_console_warn',
                  message: String('Failed to wrap range with mark, trying alternative approach:'),
                  context: [rangeError],
                });

                // Alternative: split text node and insert mark
                const originalText = textNode.nodeValue!;
                const beforeText = textNode.nodeValue!.substring(0, startOffset);
                const matchText = textNode.nodeValue!.substring(startOffset, endOffset);
                const afterText = textNode.nodeValue!.substring(endOffset);

                try {
                  // Replace the text node content with before text
                  textNode.nodeValue = beforeText;

                  // Create and insert the mark
                  const mark = document.createElement('mark');
                  mark.className = `${highlightClass}`;
                  mark.setAttribute('data-match-index', '0');
                  mark.textContent = matchText;

                  // Insert mark after the text node
                  textNode.parentNode!.insertBefore(mark, textNode.nextSibling);
                  marks.push(mark);

                  // Insert remaining text after the mark
                  if (afterText) {
                    const afterNode = document.createTextNode(afterText);
                    mark.parentNode!.insertBefore(afterNode, mark.nextSibling);
                  }
                } catch (fallbackError) {
                  // Restore original text on error
                  textNode.nodeValue = originalText;
                  logger.error(LogEvent.FRONTEND_ERROR, {
                    type: 'migrated_console_error',
                    message: String('Fallback highlighting approach failed:'),
                    error: fallbackError,
                  });
                }
              }
            } catch (error) {
              logger.warn(LogEvent.FRONTEND_ERROR, {
                type: 'migrated_console_warn',
                message: String('Error processing text node for highlighting:'),
                context: [error],
              });
            }
          }
        }
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error creating highlight marks:'),
          error: error,
        });
      }

      return marks;
    },
    [highlightClass],
  );

  // Create highlight overlays using positioned spans (for PDF content)
  const createOverlayHighlights = useCallback(
    (container: HTMLElement, match: ClientHighlightMatch): HTMLElement[] => {
      const marks: HTMLElement[] = [];

      try {
        // Find all text nodes and their positions
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
          acceptNode(n) {
            const p = (n as Text).parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            const tag = p.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
            if (!n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });

        const textNodes: { node: Text; start: number; end: number }[] = [];
        let currentPos = 0;
        let node: Node | null;

        // Build a map of text nodes and their positions
        while ((node = walker.nextNode())) {
          const textNode = node as Text;
          const nodeLength = textNode.nodeValue!.length;
          textNodes.push({
            node: textNode,
            start: currentPos,
            end: currentPos + nodeLength,
          });
          currentPos += nodeLength;
        }

        // Find all text nodes that intersect with our match
        const intersectingNodes = textNodes.filter(
          ({ start, end }) => start < match.endIndex && end > match.startIndex,
        );

        for (const { node: textNode, start: nodeStart } of intersectingNodes) {
          const startOffset = Math.max(0, match.startIndex - nodeStart);
          const endOffset = Math.min(textNode.nodeValue!.length, match.endIndex - nodeStart);

          if (startOffset < endOffset) {
            try {
              const range = document.createRange();
              range.setStart(textNode, startOffset);
              range.setEnd(textNode, endOffset);

              const rects = range.getClientRects();

              // Find a suitable positioning context for the highlight overlay
              let pageWrapper: HTMLElement | null = textNode.parentElement;

              // Look for PDF-specific wrappers first
              while (pageWrapper && pageWrapper !== container) {
                if (
                  pageWrapper.classList.contains('pdf-page-wrapper') ||
                  pageWrapper.classList.contains('react-pdf__Page')
                ) {
                  break;
                }
                pageWrapper = pageWrapper.parentElement;
              }

              // If no PDF wrapper found, look for any positioned element
              if (!pageWrapper || pageWrapper === container) {
                pageWrapper = textNode.parentElement;
                while (pageWrapper && pageWrapper !== container) {
                  const style = window.getComputedStyle(pageWrapper);
                  if (style.position === 'relative' || style.position === 'absolute') {
                    break;
                  }
                  pageWrapper = pageWrapper.parentElement;
                }
              }

              // Fall back to container
              if (!pageWrapper || pageWrapper === container) {
                pageWrapper = container;
              }

              const pageStyle = window.getComputedStyle(pageWrapper);
              if (pageStyle.position === 'static') {
                pageWrapper.style.position = 'relative';
              }

              let overlayContainer = pageWrapper.querySelector<HTMLElement>(
                '[data-highlight-overlay]',
              );
              if (!overlayContainer) {
                overlayContainer = document.createElement('div');
                overlayContainer.setAttribute('data-highlight-overlay', 'true');
                overlayContainer.style.cssText = `
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  pointer-events: none;
                  z-index: 999;
                `;
                pageWrapper.appendChild(overlayContainer);
              }

              const pageRect = pageWrapper.getBoundingClientRect();

              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                if (!rect) continue;

                if (rect.width === 0 || rect.height === 0) continue;

                const overlay = document.createElement('span');
                overlay.className = 'pdf-highlight-overlay';
                overlay.setAttribute('data-match-index', '0');

                const left = rect.left - pageRect.left;
                const top = rect.top - pageRect.top;

                overlay.style.cssText = `
                  position: absolute;
                  left: ${left}px;
                  top: ${top}px;
                  width: ${rect.width}px;
                  height: ${rect.height}px;
                  background-color: rgba(250, 204, 21, 0.4);
                  pointer-events: none;
                  z-index: 1000;
                  border-radius: 2px;
                `;

                overlayContainer.appendChild(overlay);
                marks.push(overlay);
              }
            } catch (error) {
              logger.warn(LogEvent.FRONTEND_ERROR, {
                type: 'migrated_console_warn',
                message: String('Error creating overlay highlight:'),
                context: [error],
              });
            }
          }
        }
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error creating overlay highlights:'),
          error: error,
        });
      }

      return marks;
    },
    [],
  );

  // Main highlight creation function that chooses the right strategy
  const createHighlightMarks = useCallback(
    (container: HTMLElement, match: ClientHighlightMatch): HTMLElement[] => {
      const isPDF = isPDFContext(container);

      if (debug) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String(`Using ${isPDF ? 'overlay' : 'mark'} highlighting strategy`),
        });
      }

      return isPDF
        ? createOverlayHighlights(container, match)
        : createMarkHighlights(container, match);
    },
    [isPDFContext, createOverlayHighlights, createMarkHighlights, debug],
  );

  // Internal function to clear DOM highlights without affecting the cancellation token
  const clearHighlightsFromDOM = useCallback((root: HTMLElement) => {
    // Clear mark-based highlights
    const marks = root.querySelectorAll<HTMLElement>('mark[data-match-index]');
    marks.forEach(m => {
      const parent = m.parentNode!;
      // unwrap <mark>
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize(); // merge adjacent text nodes
    });

    // Clear overlay-based highlights (for PDFs)
    const overlayContainers = root.querySelectorAll<HTMLElement>('[data-highlight-overlay]');
    overlayContainers.forEach(container => {
      container.remove();
    });

    const individualOverlays = root.querySelectorAll<HTMLElement>('.pdf-highlight-overlay');
    individualOverlays.forEach(overlay => {
      overlay.remove();
    });
  }, []);

  // Exported function: increments token to cancel pending work, clears DOM, resets state
  const clearHighlights = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;

    // Increment token to invalidate any pending async work
    callTokenRef.current += 1;

    clearHighlightsFromDOM(root);

    setMatches([]);
    setIndex(0);
  }, [containerRef, clearHighlightsFromDOM]);

  // Wait for text layer to be fully rendered and positioned
  const waitForTextLayerReady = useCallback(
    async (
      container: HTMLElement,
      timeoutMs = 5000,
      opts?: { searchPhrase?: string; caseSensitive?: boolean },
    ): Promise<string> => {
      const searchPhrase = opts?.searchPhrase?.trim();
      const caseSensitive = opts?.caseSensitive ?? false;

      return new Promise(resolve => {
        const startTime = Date.now();
        let lastTextLength = -1;
        let text = '';
        let stableCount = 0;
        const requiredStableChecks = 4;

        const checkTextLayer = () => {
          const currentTime = Date.now();
          if (currentTime - startTime > timeoutMs) {
            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('Text layer wait timeout reached'),
              });
            }
            resolve(text);
            return;
          }

          text = extractContainerText(container);
          const currentTextLength = text.length;

          if (debug && currentTextLength !== lastTextLength) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String(
                `Text layer length changed: ${lastTextLength} -> ${currentTextLength}`,
              ),
            });
          }

          const lengthStable = currentTextLength === lastTextLength && currentTextLength > 0;

          if (lengthStable) {
            stableCount++;
          } else {
            stableCount = 0;
          }

          lastTextLength = currentTextLength;

          const stableEnough = stableCount >= requiredStableChecks;
          let matchOk = true;
          if (stableEnough && searchPhrase) {
            const result = findHighlightMatches(searchPhrase, text, {
              caseSensitive,
            });
            matchOk = !!(result.success && result.matches && result.matches.length > 0);
            if (debug && !matchOk) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('Text layer stable but chunk text not matchable yet; keep waiting'),
              });
            }
          }

          if (stableEnough && (!searchPhrase || matchOk)) {
            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String(
                  `Text layer ready (length ${currentTextLength}${searchPhrase ? ', match verified' : ''})`,
                ),
              });
            }
            resolve(text);
            return;
          }

          if (stableEnough && searchPhrase && !matchOk) {
            stableCount = 0;
          }

          requestAnimationFrame(() => {
            setTimeout(checkTextLayer, 50);
          });
        };

        requestAnimationFrame(checkTextLayer);
      });
    },
    [extractContainerText, debug],
  );

  const highlightText = useCallback(
    async (
      text: string,
      chunkIndex: number,
      pageIndex?: number,
      waitForTextLayer: boolean = false,
    ): Promise<boolean> => {
      callTokenRef.current += 1;
      const currentToken = callTokenRef.current;

      if (debug) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('highlightText called with:'),
          context: [text, 'token:', currentToken],
        });
      }

      const root = containerRef.current;
      if (!root) {
        if (debug)
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String('No container ref found'),
          });
        return false;
      }

      if (debug) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('Container found:'),
          context: [root],
        });
      }

      clearHighlightsFromDOM(root);
      if (!text) return false;

      setIsLoading(true);

      try {
        let containerText = '';
        /** Where to resolve character offsets (single PDF page vs full viewer root). */
        let highlightScope: HTMLElement = root;

        // For PDFs / spreadsheets: goToPage → waitForPageReady (PDF) → extract on page scope.
        if (documentOperationsRef?.current?.goToPage) {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('PDF or Spreadsheet detected'),
              context: [pageIndex],
            });
          }
          if (pageIndex !== undefined && pageIndex >= 0) {
            const waitForPageReadyFn = documentOperationsRef.current.waitForPageReady;

            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('Going to page or subsheet:'),
                context: [pageIndex],
              });
            }
            await documentOperationsRef.current.goToPage(pageIndex);
            if (currentToken !== callTokenRef.current) {
              if (debug) {
                logger.info(LogEvent.INFO, {
                  type: 'migrated_console_log',
                  message: String('Stale call after goToPage, aborting'),
                });
              }
              return false;
            }

            if (waitForPageReadyFn) {
              if (debug) {
                logger.info(LogEvent.INFO, {
                  type: 'migrated_console_log',
                  message: String('Waiting for page ready (canvas + text + annotations)...'),
                });
              }
              await waitForPageReadyFn(pageIndex);
            }
            if (currentToken !== callTokenRef.current) {
              if (debug) {
                logger.info(LogEvent.INFO, {
                  type: 'migrated_console_log',
                  message: String('Stale call after waitForPageReady, aborting'),
                });
              }
              return false;
            }

            if (isPDFContext(root)) {
              const pageRoot = findPdfPageRoot(root, pageIndex);
              if (!pageRoot) {
                if (debug) {
                  logger.info(LogEvent.INFO, {
                    type: 'migrated_console_log',
                    message: String(`PDF page ${pageIndex} not found, skipping highlight`),
                  });
                }
                return false;
              }
              highlightScope = pageRoot;
            }

            if (waitForPageReadyFn) {
              containerText = extractContainerText(highlightScope);
              if (debug) {
                logger.info(LogEvent.INFO, {
                  type: 'migrated_console_log',
                  message: String('Page ready; extracted text length:'),
                  context: [containerText.length],
                });
              }
            } else {
              if (debug) {
                logger.info(LogEvent.INFO, {
                  type: 'migrated_console_log',
                  message: String('Waiting for text layer (non-PDF readiness)...'),
                });
              }
              containerText = await waitForTextLayerReady(highlightScope, 5000, {
                searchPhrase: text,
                caseSensitive,
              });
              if (debug) {
                logger.info(LogEvent.INFO, {
                  type: 'migrated_console_log',
                  message: String('Text layer ready, proceeding with highlighting'),
                });
              }
            }
          } else {
            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('No page or subsheet index provided, skipping highlight'),
              });
            }
            return false;
          }
        } else {
          if (waitForTextLayer) {
            containerText = await waitForTextLayerReady(root, 5000, {
              searchPhrase: text,
              caseSensitive,
            });
          } else {
            containerText = extractContainerText(root);
          }
        }

        if (currentToken !== callTokenRef.current) {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('Stale call after text extraction, aborting'),
            });
          }
          return false;
        }

        // PDF text layer can briefly lag readiness; one retry after layout frames.
        if (
          containerText.length === 0 &&
          isPDFContext(root) &&
          pageIndex !== undefined &&
          pageIndex >= 0
        ) {
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve());
            });
          });
          if (currentToken !== callTokenRef.current) {
            return false;
          }
          containerText = extractContainerText(highlightScope);
        }

        if (currentToken !== callTokenRef.current) {
          return false;
        }

        if (containerText.length === 0) {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('No extractable text; skipping highlight and cache'),
            });
          }
          return false;
        }

        if (debug) {
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String('Container text extracted, length:'),
            context: [containerText.length],
          });
        }

        // Clean expired cache entries
        cleanExpiredCache();

        // Generate cache key (include page so PDF page-scoped offsets stay valid)
        const canUseCache = !!documentId;
        const cacheKey = canUseCache ? generateCacheKey(documentId, chunkIndex, pageIndex) : '';

        // Check cache first (only if safe)
        const cachedEntry = canUseCache ? cacheRef.current[cacheKey] : undefined;
        let matches: ClientHighlightMatch[];

        if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION) {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('Using cached result for key:'),
              context: [cacheKey],
            });
          }

          // Check if this call is still the latest before using cached results
          if (currentToken !== callTokenRef.current) {
            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('Stale call detected after cache lookup, aborting'),
              });
            }
            return false;
          }

          matches = cachedEntry.matches;
        } else {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('Cache miss, computing highlights client-side for key:'),
              context: [cacheKey],
            });
          }

          if (currentToken !== callTokenRef.current) {
            return false;
          }

          // Use client-side highlighting instead of API call
          const result = findHighlightMatches(text, containerText, {
            caseSensitive,
          });

          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('Client-side highlighting result:'),
              context: [result],
            });
          }

          if (!result.success || !result.matches || result.matches.length === 0) {
            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('No matches found:'),
                context: [result.message],
              });
            }
            return false;
          }

          // Check if this call is still the latest before processing results
          if (currentToken !== callTokenRef.current) {
            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('Stale call detected after computing matches, aborting'),
              });
            }
            return false;
          }

          matches = result.matches;

          // Only cache successful responses and only when safe
          if (canUseCache) {
            cacheRef.current[cacheKey] = {
              matches,
              timestamp: Date.now(),
            };

            if (debug) {
              logger.info(LogEvent.INFO, {
                type: 'migrated_console_log',
                message: String('Cached successful result for key:'),
                context: [cacheKey],
              });
            }
          } else if (!canUseCache && debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('Skipping cache write (no documentId or empty text)'),
            });
          }
        }

        // Check if this call is still the latest before creating DOM highlights
        if (currentToken !== callTokenRef.current) {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String('Stale call detected before creating highlights, aborting'),
            });
          }
          return false;
        }

        // Drop any stray marks from a racing call that finished after our initial clear.
        clearHighlightsFromDOM(root);

        // Create highlight marks for all matches
        const allMarks: HTMLElement[] = [];
        let longestMatchIndex = 0;
        let longestMatchLength = 0;

        matches.forEach((match, matchIndex) => {
          const marks = createHighlightMarks(highlightScope, match);

          marks.forEach(mark => {
            mark.setAttribute('data-match-index', matchIndex.toString());
          });

          allMarks.push(...marks);

          if (match.length > longestMatchLength) {
            longestMatchLength = match.length;
            longestMatchIndex = allMarks.length - marks.length;
          }
        });

        if (debug) {
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String(
              `Created ${allMarks.length} highlight marks from ${matches.length} matches`,
            ),
          });
          logger.info(LogEvent.INFO, {
            type: 'migrated_console_log',
            message: String(
              `Longest match index: ${longestMatchIndex} with length: ${longestMatchLength}`,
            ),
          });
        }

        // Final check before updating state
        if (currentToken !== callTokenRef.current) {
          if (debug) {
            logger.info(LogEvent.INFO, {
              type: 'migrated_console_log',
              message: String(
                'Stale call detected before state update, aborting and cleaning up DOM',
              ),
            });
          }
          allMarks.forEach(mark => {
            if (mark.parentNode) {
              if (mark.tagName === 'MARK') {
                while (mark.firstChild) {
                  mark.parentNode.insertBefore(mark.firstChild, mark);
                }
                mark.parentNode.removeChild(mark);
              } else {
                mark.remove();
              }
            }
          });
          return false;
        }

        setMatches(allMarks);
        setIndex(longestMatchIndex);

        return allMarks.length > 0;
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Error during client-side highlighting:'),
          error: error,
        });
        if (currentToken === callTokenRef.current) {
          clearHighlightsFromDOM(root);
        }
        return false;
      } finally {
        // Only update loading state if this is still the latest call
        if (currentToken === callTokenRef.current) {
          setIsLoading(false);
        }
      }
    },
    [
      clearHighlightsFromDOM,
      containerRef,
      extractContainerText,
      createHighlightMarks,
      caseSensitive,
      debug,
      documentId,
      generateCacheKey,
      cleanExpiredCache,
      documentOperationsRef,
      isPDFContext,
      waitForTextLayerReady,
    ],
  );

  const scrollToMatch = useCallback(
    (matchIndex: number = 0) => {
      if (!matches.length || !containerRef.current) return false;
      const bounded = ((matchIndex % matches.length) + matches.length) % matches.length;

      const container = containerRef.current;
      const target = matches[bounded];
      if (!target) return false;

      // Check if container is scrollable, if not find the scrollable parent

      let scrollParent: HTMLElement = container;

      if (!isScrollable(container)) {
        // Container is not scrollable, find the scrollable parent
        let parent = container.parentElement;
        while (parent) {
          if (isScrollable(parent)) {
            scrollParent = parent;
            break;
          }
          parent = parent.parentElement;
        }

        // If no scrollable parent found, use document element
        if (!parent) {
          scrollParent = document.documentElement;
        }
      }

      // Use custom scroll logic for proper centering
      if (scrollParent !== document.documentElement) {
        const containerRect = scrollParent.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        const targetTop = targetRect.top - containerRect.top;
        const containerHeight = scrollParent.clientHeight;
        const targetHeight = targetRect.height;

        const scrollTop =
          scrollParent.scrollTop + targetTop - containerHeight / 2 + targetHeight / 2;

        scrollParent.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'smooth',
        });
      } else {
        target.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth',
        });
      }

      setIndex(bounded);
      return true;
    },
    [matches, containerRef],
  );

  // Auto-scroll to the current index (which is set to the longest match) whenever matches update
  useEffect(() => {
    if (matches.length) {
      // Small delay to ensure DOM is fully updated, especially for mark elements
      const timeoutId = setTimeout(() => {
        scrollToMatch(index);
      }, 50);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [matches, index, scrollToMatch]);

  // Clean up when container unmounts
  useEffect(() => () => clearHighlights(), [clearHighlights]);

  // Clean up expired cache entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      cleanExpiredCache();
    }, CACHE_DURATION / 2); // Clean every 2.5 minutes

    return () => clearInterval(interval);
  }, [cleanExpiredCache]);

  return {
    highlightText,
    clearHighlights,
    scrollToMatch,
    matches,
    index,
    isLoading,
  };
}
