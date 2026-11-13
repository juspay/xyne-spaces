import { describe, it, expect } from 'vitest';
import { isExecutable, extensionOf } from './executable-check.js';

describe('extensionOf', () => {
  it('extracts and lowercases the last extension', () => {
    expect(extensionOf('foo.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('report.exe.txt')).toBe('txt'); // trailing wins (what the OS shows)
  });

  it('returns empty string when there is no extension', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.bashrc')).toBe(''); // leading-dot file has no extension
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('isExecutable', () => {
  it('blocks by MIME type', () => {
    expect(isExecutable('application/x-msdownload', 'innocent.txt')).toMatch(/MIME/);
    expect(isExecutable('application/javascript', 'script.txt')).toMatch(/MIME/);
    expect(isExecutable('application/vnd.ms-excel.sheet.macroEnabled.12', 'q4.dat')).toMatch(/MIME/);
  });

  it('blocks by filename extension even with a benign MIME', () => {
    // Attacker sets mimeType to image/png but file is malware.exe
    expect(isExecutable('image/png', 'malware.exe')).toMatch(/\.exe extension/);
    expect(isExecutable('application/octet-stream', 'install.dmg')).toMatch(/\.dmg/);
    expect(isExecutable('text/plain', 'run.sh')).toMatch(/\.sh/);
    expect(isExecutable('text/plain', 'macro.docm')).toMatch(/\.docm/);
  });

  it('is case-insensitive', () => {
    expect(isExecutable('IMAGE/PNG', 'MALWARE.EXE')).toMatch(/EXE extension/i);
    expect(isExecutable('Application/X-MSDownload', 'x.txt')).toMatch(/MIME/);
  });

  it('allows common safe types', () => {
    expect(isExecutable('application/pdf', 'doc.pdf')).toBeNull();
    expect(isExecutable('image/png', 'photo.png')).toBeNull();
    expect(isExecutable('image/jpeg', 'photo.jpg')).toBeNull();
    expect(isExecutable('text/plain', 'notes.txt')).toBeNull();
    expect(isExecutable('text/csv', 'data.csv')).toBeNull();
    expect(isExecutable('application/json', 'config.json')).toBeNull();
    expect(isExecutable(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'report.docx',
    )).toBeNull();
    expect(isExecutable(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'q4.xlsx',
    )).toBeNull();
  });

  it('allows files without extensions', () => {
    expect(isExecutable('text/plain', 'README')).toBeNull();
  });
});
