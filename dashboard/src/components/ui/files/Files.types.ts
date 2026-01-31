export interface AttachmentsProps {
  files: File[];
  onRemove: (index: number) => void;
  onPreview: (file: File) => void;
  isUploading?: boolean;
  showDownload?: boolean;
  onThumbnailGenerated?: (file: File, thumbnailBlob: Blob) => void;
}

export interface UploadedFile {
  id: string;
  originalName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AttachmentPreviewProps {
  file: File | UploadedFile;
  onRemove: () => void;
  onPreview?: () => void;
  isUploading?: boolean;
  onThumbnailGenerated?: (file: File, thumbnailBlob: Blob) => void;
  variant?: 'compact' | 'detailed';
}

export interface MediaViewerProps {
  file: File;
  isOpen: boolean;
  onClose: () => void;
  showDownload?: boolean;
}
