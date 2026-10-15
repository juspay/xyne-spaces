import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FileAttachmentCard, getFileTypeConfig } from '@/src/components/chat/file-attachment-card';

describe('getFileTypeConfig', () => {
  it('returns Image config for image mimetypes', () => {
    const config = getFileTypeConfig('image/png', 'photo.png');
    expect(config.label).toBe('Image');
    expect(config.color).toBe('#3b82f6');
  });

  it('returns Video config for video mimetypes', () => {
    const config = getFileTypeConfig('video/mp4', 'clip.mp4');
    expect(config.label).toBe('Video');
    expect(config.color).toBe('#a855f7');
  });

  it('returns Audio config for audio mimetypes', () => {
    const config = getFileTypeConfig('audio/mpeg', 'song.mp3');
    expect(config.label).toBe('Audio');
    expect(config.color).toBe('#22c55e');
  });

  it('returns PDF config for application/pdf', () => {
    const config = getFileTypeConfig('application/pdf', 'doc.pdf');
    expect(config.label).toBe('PDF');
    expect(config.color).toBe('#ef4444');
  });

  it('returns Code config for .ts files', () => {
    const config = getFileTypeConfig('text/plain', 'index.ts');
    expect(config.label).toBe('Code');
    expect(config.color).toBe('#64748b');
  });

  it('returns Archive config for zip files', () => {
    const config = getFileTypeConfig('application/zip', 'archive.zip');
    expect(config.label).toBe('Archive');
    expect(config.color).toBe('#eab308');
  });

  it('returns generic File config for unknown mimetypes', () => {
    const config = getFileTypeConfig('application/octet-stream', 'data.bin');
    expect(config.label).toBe('File');
    expect(config.color).toBe('#9ca3af');
  });
});

describe('FileAttachmentCard', () => {
  const baseAttachment = {
    id: 'att-1',
    originalFilename: 'report.pdf',
    mimetype: 'application/pdf',
    size: 2048,
  };

  it('renders the filename', () => {
    render(<FileAttachmentCard attachment={baseAttachment} />);
    expect(screen.getByText('report.pdf')).toBeTruthy();
  });

  it('renders the file type label and size', () => {
    render(<FileAttachmentCard attachment={baseAttachment} />);
    // formatFileSize(2048) = "2.0 KB" (size < 10 → 1 decimal)
    expect(screen.getByText(/PDF • 2\.0 KB/)).toBeTruthy();
  });

  it('renders the correct label for an image file', () => {
    const attachment = {
      originalFilename: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 1048576,
    };
    render(<FileAttachmentCard attachment={attachment} />);
    // formatFileSize(1048576) = "1.0 MB"
    expect(screen.getByText(/Image • 1\.0 MB/)).toBeTruthy();
  });

  it('renders the correct label for a video file', () => {
    const attachment = {
      originalFilename: 'clip.mp4',
      mimetype: 'video/mp4',
      size: 5242880,
    };
    render(<FileAttachmentCard attachment={attachment} />);
    // formatFileSize(5242880) = "5.0 MB"
    expect(screen.getByText(/Video • 5\.0 MB/)).toBeTruthy();
  });

  it('truncates long filenames while preserving the extension', () => {
    const longName = 'a'.repeat(35) + '.pdf';
    render(<FileAttachmentCard attachment={{ ...baseAttachment, originalFilename: longName }} />);
    // truncateFileName with maxLength=30 preserves .pdf extension
    const texts = screen.queryAllByText(/\.pdf$/);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('formats zero-byte files as "0 B"', () => {
    render(<FileAttachmentCard attachment={{ ...baseAttachment, size: 0 }} />);
    expect(screen.getByText(/PDF • 0 B/)).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    render(<FileAttachmentCard attachment={baseAttachment} onPress={onPress} />);
    fireEvent.press(screen.getByText('report.pdf'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
