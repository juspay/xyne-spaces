import { logger, Event as LogEvent } from '../../../utils/logger';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { v4 as uuidv4 } from 'uuid';
import { loadMermaidDiagram, saveMermaidDiagram } from '../../../machines/xyneAIMachine';

/**
 * Sanitize a mermaid-rendered SVG before it is injected via dangerouslySetInnerHTML.
 *
 * Fresh renders are already sanitized by mermaid itself (securityLevel:'antiscript'),
 * but SVGs served from the IndexedDB cache may have been produced under the previous
 * 'loose' setting, which skipped sanitization — so we re-sanitize at the sink to
 * neutralize any poisoned/legacy cache entries and as defense-in-depth.
 *
 * The config mirrors mermaid's own pass (see mermaid.core.mjs): foreignObject +
 * dominant-baseline are re-allowed and foreignObject is treated as an HTML
 * integration point so HTML labels are preserved, while <script>, on* event-handler
 * attributes and javascript: URLs are stripped.
 */
export const sanitizeMermaidSvg = (svg: string): string =>
  DOMPurify.sanitize(svg, {
    ADD_TAGS: ['foreignobject'],
    ADD_ATTR: ['dominant-baseline'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });

/**
 * Validates if a Mermaid diagram syntax is complete
 */
export const isValidMermaidSyntax = (chart: string): boolean => {
  const trimmed = chart.trim();
  if (!trimmed) return false;

  // Check for common Mermaid diagram types
  const validStarts = [
    'graph',
    'flowchart',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'gantt',
    'pie',
    'journey',
    'gitGraph',
  ];

  return validStarts.some(start => trimmed.startsWith(start));
};

/**
 * Generate a unique ID for mermaid diagram rendering
 */
export const generateMermaidId = (): string => {
  return `mermaid-${uuidv4()}`;
};

interface RenderDiagramParams {
  chart: string;
  messageId: string | undefined;
  isDark: boolean;
  lastRenderedChart: string;
  onSuccess: (svg: string, chart: string) => void;
  onError: (error: string) => void;
  onLoading: (isLoading: boolean) => void;
}

/**
 * Renders a mermaid diagram with caching support
 */
export const renderMermaidDiagram = async ({
  chart,
  messageId,
  isDark,
  lastRenderedChart,
  onSuccess,
  onError,
  onLoading,
}: RenderDiagramParams): Promise<void> => {
  if (!chart.trim()) {
    onSuccess('', '');
    onError('');
    return;
  }

  // Theme is part of the render identity; switching themes must replace the
  // SVG even when the diagram source is unchanged.
  if (lastRenderedChart === `${isDark ? 'dark' : 'light'}:${chart}`) return;

  // Validate Mermaid syntax
  const hasValidSyntax = isValidMermaidSyntax(chart);

  if (!hasValidSyntax) {
    // Chart is likely still streaming, wait for more content
    // Don't clear existing SVG - keep showing the old diagram
    return;
  }

  // Try to load from cache first if messageId is provided
  const themedMessageId = messageId ? `${messageId}:${isDark ? 'dark' : 'light'}` : undefined;
  if (themedMessageId) {
    try {
      const cached = await loadMermaidDiagram(themedMessageId);
      if (cached && cached.diagram === chart && cached.renderedSvg) {
        // Re-sanitize: cache entries may predate the securityLevel fix.
        onSuccess(sanitizeMermaidSvg(cached.renderedSvg), chart);
        onError('');
        onLoading(false);
        return; // Use cached version, skip rendering
      }
    } catch (err) {
      // Cache load failed, continue with rendering
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('Failed to load cached mermaid diagram:'),
        context: [err],
      });
    }
  }

  onLoading(true);

  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'antiscript',
      fontFamily: 'Inter, sans-serif',
      suppressErrorRendering: true,
    });
    // Generate unique ID for each diagram
    const id = generateMermaidId();

    // Render the diagram, then sanitize before it is injected / cached.
    const { svg: renderedSvg } = await mermaid.render(id, chart);
    const safeSvg = sanitizeMermaidSvg(renderedSvg);
    onSuccess(safeSvg, chart);
    onError('');

    // Save the sanitized SVG so cached entries are clean going forward
    if (themedMessageId) {
      void saveMermaidDiagram(themedMessageId, chart, safeSvg);
    }
  } catch (err) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Mermaid rendering error:'),
      error: err,
    });
    // Only set error if it looks like a complete diagram
    if (chart.split('\n').length > 2) {
      onError('Failed to render diagram');
    }
  } finally {
    onLoading(false);
  }
};

/**
 * Copy text to clipboard
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to copy code:'),
      error: err,
    });
    return false;
  }
};

/**
 * Download SVG as PNG image
 */
export const downloadDiagramAsPng = (svgElement: SVGElement): void => {
  try {
    // Get SVG dimensions
    const svgGraphicsElement = svgElement as SVGGraphicsElement;
    const bbox = svgGraphicsElement.getBBox();
    const width = bbox.width || svgElement.clientWidth || 800;
    const height = bbox.height || svgElement.clientHeight || 600;

    // Clone the SVG to avoid modifying the original
    const clonedSvg = svgElement.cloneNode(true) as SVGElement;
    clonedSvg.setAttribute('width', String(width));
    clonedSvg.setAttribute('height', String(height));

    // Serialize the SVG
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clonedSvg);

    // Create a data URL instead of blob URL to avoid CORS issues
    // Using btoa with proper UTF-8 encoding
    const svgDataUrl = `data:image/svg+xml;base64,${btoa(
      String.fromCharCode(...new TextEncoder().encode(svgString)),
    )}`;

    // Create an image and canvas for conversion
    const img = new Image();
    img.onload = (): void => {
      const canvas = document.createElement('canvas');
      const scale = 2; // 2x scale for better quality
      canvas.width = width * scale;
      canvas.height = height * scale;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Set white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Scale for better quality
        ctx.scale(scale, scale);

        // Draw the image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to PNG and download
        canvas.toBlob(
          blob => {
            if (blob) {
              const pngUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = pngUrl;
              link.download = `mermaid-diagram-${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(pngUrl);
            }
          },
          'image/png',
          1.0,
        );
      }
    };

    img.onerror = (): void => {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to load SVG image'),
      });
    };

    img.src = svgDataUrl;
  } catch (err) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to download diagram:'),
      error: err,
    });
  }
};
