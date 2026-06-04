import React, { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { FlowComponent } from '@xyne/shared';
import { DownloadButton } from '../../Chat/MessageAttachment/DownloadButton';
import { useClipboard } from '../../../hooks/useClipboard';
import { usePlatform } from '../../../hooks/usePlatform';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { attachmentViewerActor } from '../../../machines/attachmentViewerMachine';

interface ImageNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const ImageNode: React.FC<ImageNodeProps> = ({ node }) => {
  const [errored, setErrored] = useState(false);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const { isMobile } = usePlatform();
  const { copyImage } = useClipboard();

  const props = node.props as
    | {
        src?: string;
        alt?: string;
        width?: string | number;
        height?: string | number;
        objectFit?: 'cover' | 'contain' | 'fill';
        xyne_file_id?: string;
      }
    | undefined;

  const src = props?.src;
  const alt = props?.alt ?? '';
  const objectFit = props?.objectFit ?? 'contain';
  const xyne_file_id = props?.xyne_file_id;

  const widthStyle =
    props?.width !== null && props?.width !== undefined ? { width: props.width } : {};
  const heightStyle =
    props?.height !== null && props?.height !== undefined ? { height: props.height } : {};

  // Fetch blob for copy-to-clipboard and viewer when xyne_file_id is present
  useEffect(() => {
    if (!xyne_file_id) return;

    let blobUrl: string | null = null;

    const fetchBlob = async (): Promise<void> => {
      try {
        const blob = await createPreviewUrl(xyne_file_id);
        blobRef.current = blob;
        blobUrl = URL.createObjectURL(blob);
        setImageBlobUrl(blobUrl);
      } catch {
        // fall back to src directly
      }
    };

    void fetchBlob();

    return (): void => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [xyne_file_id]);

  const handleCopyImage = async (): Promise<void> => {
    if (!blobRef.current) return;
    try {
      await copyImage(blobRef.current);
    } catch {
      toast.error('Failed to copy image');
    }
  };

  const deriveMimeType = (fileSrc: string): string => {
    const ext = (fileSrc.split('?')[0] ?? '').split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      png: 'image/png',
    };
    return map[ext ?? ''] ?? 'image/*';
  };

  const handleClick = (): void => {
    if (!xyne_file_id) return;
    attachmentViewerActor.send({
      type: 'OPEN',
      attachments: [
        {
          attachmentId: xyne_file_id,
          fileName: alt || 'image',
          fileUrl: `/api/attachments/${xyne_file_id}/download`,
          mimeType: deriveMimeType(src ?? ''),
          fileSize: 0,
        },
      ],
      startIndex: 0,
    });
  };

  const displaySrc = imageBlobUrl ?? src;

  if (!displaySrc || errored) {
    return (
      <div
        className='flex items-center justify-center rounded-md bg-muted text-muted-foreground text-sm'
        style={{ minHeight: 80, ...widthStyle, ...heightStyle, ...node.style }}
      >
        {alt || 'Image unavailable'}
      </div>
    );
  }

  return (
    <div
      className='relative group/attachment inline-block'
      style={{ ...widthStyle, ...heightStyle }}
    >
      {xyne_file_id ? (
        <button
          type='button'
          onClick={handleClick}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleClick()}
          className='p-0 border-0 bg-transparent cursor-pointer'
          data-track-category='FLOW_IMAGE'
          data-track-name='OpenImageViewer'
        >
          <img
            src={displaySrc}
            alt={alt}
            onError={() => setErrored(true)}
            className='rounded-md block'
            style={{
              objectFit,
              maxHeight: 256,
              maxWidth: 300,
              height: 'auto',
              width: 'auto',
              ...widthStyle,
              ...heightStyle,
              ...(node.style as React.CSSProperties | undefined),
            }}
          />
        </button>
      ) : (
        <img
          src={displaySrc}
          alt={alt}
          onError={() => setErrored(true)}
          className='rounded-md block'
          style={{
            objectFit,
            maxHeight: 256,
            maxWidth: 300,
            height: 'auto',
            width: 'auto',
            ...widthStyle,
            ...heightStyle,
            ...(node.style as React.CSSProperties | undefined),
          }}
        />
      )}
      {xyne_file_id && !isMobile && (
        <div className='absolute top-2 right-2 z-10 opacity-0 group-hover/attachment:opacity-100 transition-opacity duration-200'>
          <div className='flex items-center gap-0.5 bg-background/90 backdrop-blur-sm rounded-lg p-1 shadow-lg border border-border'>
            {imageBlobUrl && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  void handleCopyImage();
                }}
                className='p-2 rounded-md text-foreground hover:bg-muted transition-colors'
                title='Copy Image'
                data-track-category='FLOW_IMAGE'
                data-track-name='CopyImage'
              >
                <Copy className='h-[18px] w-[18px]' />
              </button>
            )}
            <DownloadButton
              attachmentId={xyne_file_id}
              fileName={alt || 'image'}
              variant='overlay'
            />
          </div>
        </div>
      )}
    </div>
  );
};
