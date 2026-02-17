import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * CanvasRedirectPage handles generic redirect URLs (/redirected?canvasId=...&blockId=...)
 *
 * This component exists solely to support external links (shared via notifications, Slack, etc.)
 * It extracts all parameters from URL search params and redirects to the proper route.
 *
 * Supported redirect types:
 * - canvas: Requires canvasId, optional blockId
 * - Other types (ticket, etc.) can be added in the future
 */
export default function CanvasRedirectPage(): null {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirectAttempted = useRef(false);

  useEffect(() => {
    if (redirectAttempted.current) return;
    redirectAttempted.current = true;

    const type = searchParams.get('type');
    const canvasId = searchParams.get('canvasId');
    const blockId = searchParams.get('blockId');

    // Helper to preserve other query parameters
    const getOtherParams = (excludeKeys: string[]): string => {
      const otherParams = new URLSearchParams();
      searchParams.forEach((value, key) => {
        if (!excludeKeys.includes(key)) {
          otherParams.append(key, value);
        }
      });
      return otherParams.toString();
    };

    let targetRoute: string | null = null;

    switch (type) {
      case 'canvas':
        if (canvasId) {
          const otherParams = getOtherParams(['type', 'canvasId', 'blockId']);
          targetRoute = blockId
            ? `/chat/canvas/${canvasId}?blockId=${encodeURIComponent(blockId)}${otherParams ? `&${otherParams}` : ''}`
            : `/chat/canvas/${canvasId}${otherParams ? `?${otherParams}` : ''}`;
        }
        break;
      default:
        // Unknown type - will fall through to invalid redirect handling
        break;
    }

    if (targetRoute) {
      void navigate(targetRoute, { replace: true });
    } else {
      // Invalid redirect link - redirect to chat
      void navigate('/chat', { replace: true });
    }
  }, [searchParams, navigate]);

  // No UI needed - just redirects
  return null;
}
