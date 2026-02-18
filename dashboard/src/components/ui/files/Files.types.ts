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
  variant?: 'compact' | 'detailed';
}

export interface MediaViewerProps {
  file: File;
  isOpen: boolean;
  onClose: () => void;
  showDownload?: boolean;
}
