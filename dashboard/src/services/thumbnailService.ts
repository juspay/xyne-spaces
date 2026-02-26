/**
 * Frontend Video Thumbnail Generation Service
 * Generates thumbnails from video files using HTML5 Canvas API
 */

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  timeOffset?: number; // Time in seconds to extract frame from
}

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
}

/**
 * Generate a thumbnail from a video file
 * @param videoFile - The video file to generate thumbnail from
 * @param options - Thumbnail generation options
 * @returns Promise with thumbnail blob and metadata
 */
export async function generateVideoThumbnail(
  videoFile: File,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  const { width = 640, height = 360, quality = 1, timeOffset = 1.0 } = options;

  return new Promise((resolve, reject) => {
    // Create video element
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    // Create object URL for the video file
    const videoUrl = URL.createObjectURL(videoFile);

    // Set up timeout to prevent memory leaks from hanging promises
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail generation timed out after 10 seconds.'));
    }, 10000);

    // Cleanup function
    const cleanup = (): void => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(videoUrl);
      video.remove();
    };

    // Handle video load error
    video.onerror = (): void => {
      cleanup();
      reject(new Error(`Failed to load video file: ${video.error?.message || 'Unknown error'}`));
    };

    // Handle video metadata loaded
    video.onloadedmetadata = (): void => {
      // Ensure timeOffset is within video duration
      const seekTime = Math.min(timeOffset, video.duration || 0);

      // Seek to the desired timestamp
      video.currentTime = seekTime;
    };

    // Handle seeking complete
    video.onseeked = (): void => {
      try {
        // Create canvas element
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw the video frame to canvas
        ctx.drawImage(video, 0, 0, width, height);

        // Convert canvas to blob
        canvas.toBlob(
          blob => {
            if (!blob) {
              cleanup();
              reject(new Error('Failed to generate thumbnail blob'));
              return;
            }

            // Get data URL for preview
            const dataUrl = canvas.toDataURL('image/jpeg', quality);

            cleanup();
            resolve({
              blob,
              width,
              height,
              dataUrl,
            });
          },
          'image/jpeg',
          quality,
        );
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error('Failed to generate thumbnail'));
      }
    };

    // Start loading the video
    video.src = videoUrl;
  });
}

/**
 * Check if a file is a video file
 */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

/**
 * Get video dimensions by loading metadata
 */
async function getVideoDimensions(videoFile: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const videoUrl = URL.createObjectURL(videoFile);

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Failed to load video metadata'));
    }, 5000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      URL.revokeObjectURL(videoUrl);
      video.remove();
    };

    video.onerror = (): void => {
      cleanup();
      reject(new Error('Failed to load video'));
    };

    video.onloadedmetadata = (): void => {
      const dimensions = {
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(dimensions);
    };

    video.src = videoUrl;
  });
}

/**
 * Calculate thumbnail dimensions with clamped width/height to prevent extreme aspect ratios
 */
function calculateThumbnailDimensions(
  videoWidth: number,
  videoHeight: number,
): { width: number; height: number } {
  const maxWidth = 1280;
  const maxHeight = 720;
  const minWidth = 200;

  if (!videoWidth || !videoHeight) {
    return { width: maxWidth, height: maxHeight };
  }

  const scale = Math.min(maxWidth / videoWidth, maxHeight / videoHeight);

  let finalWidth = Math.round(videoWidth * scale);
  let finalHeight = Math.round(videoHeight * scale);

  if (finalWidth < minWidth) {
    finalWidth = minWidth;
    finalHeight = Math.round(videoHeight * (minWidth / videoWidth));
  }

  return { width: finalWidth, height: finalHeight };
}

/**
 * Generate web-optimized thumbnail with aspect-ratio-aware dimensions
 */
export async function generateWebThumbnail(videoFile: File): Promise<ThumbnailResult> {
  // Get actual video dimensions first
  const videoDimensions = await getVideoDimensions(videoFile);

  // Calculate optimal thumbnail size
  const thumbnailDimensions = calculateThumbnailDimensions(
    videoDimensions.width,
    videoDimensions.height,
  );

  return generateVideoThumbnail(videoFile, {
    width: thumbnailDimensions.width,
    height: thumbnailDimensions.height,
    quality: 1,
    timeOffset: 1.0,
  });
}
