import { Readable } from 'node:stream';
import JSZip from 'jszip';

// The screening under test never reaches storage; keep its ESM-only client out of the CJS test runtime.
jest.mock('../services/storage', () => ({
  storageService: { uploadStream: jest.fn(), deleteFile: jest.fn() },
}));
import {
  classifyUpload,
  __screenExecutableContentForTest,
  __screenArchiveContentForTest,
  __setArchiveScreeningModeForTest,
} from './upload';

describe('classifyUpload', () => {
  it('blocks executables and server-side scripts regardless of declared type', () => {
    expect(classifyUpload('application/octet-stream', 'payload.exe')).toBe('blocked');
    expect(classifyUpload('application/octet-stream', 'lib.dll')).toBe('blocked');
    expect(classifyUpload('text/plain', 'shell.php')).toBe('blocked');
    // declared MIME alone is enough, even with no telling extension
    expect(classifyUpload('application/x-httpd-php', 'harmless')).toBe('blocked');
    // MIME parameters must not defeat the comparison
    expect(classifyUpload('application/x-httpd-php; charset=utf-8', 'x')).toBe('blocked');
  });

  it('keeps allowing the types this product is actually used for', () => {
    expect(classifyUpload('application/octet-stream', 'app-release.apk')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'Xyne.IPA')).toBe('allowed');
    expect(classifyUpload('text/html', 'report.html')).toBe('allowed');
    // custom emoji are SVGs
    expect(classifyUpload('image/svg+xml', 'emoji.svg')).toBe('allowed');
    expect(classifyUpload('application/x-sh', 'deploy.sh')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'demo.mov')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'firmware.bin')).toBe('allowed');
  });

  it('allows files that look risky but are normal usage here', () => {
    expect(classifyUpload('application/zip', 'bundle.zip')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'server.crt')).toBe('allowed');
    expect(classifyUpload('text/x-python', 'analyse.py')).toBe('allowed');
  });

  it('denies dangerous types the block-list never named', () => {
    // The point of deny-by-default: none of these had to be anticipated.
    expect(classifyUpload('application/octet-stream', 'evil.hta')).toBe('not-allowlisted');
    expect(classifyUpload('application/octet-stream', 'evil.lnk')).toBe('not-allowlisted');
    expect(classifyUpload('application/octet-stream', 'evil.vbs')).toBe('not-allowlisted');
    expect(classifyUpload('application/octet-stream', 'evil.jse')).toBe('not-allowlisted');
    expect(classifyUpload('application/octet-stream', 'evil.wsf')).toBe('not-allowlisted');
    expect(classifyUpload('application/octet-stream', 'app.jar')).toBe('not-allowlisted');
  });

  it('is not fooled by case or by a trailing dot', () => {
    expect(classifyUpload('application/octet-stream', 'PAYLOAD.EXE')).toBe('blocked');
    expect(classifyUpload('application/octet-stream', 'Report.PNG')).toBe('allowed');
    // "name." has no extension to test; it is handled as extensionless rather than
    // compared against the empty string.
    expect(classifyUpload('application/octet-stream', 'name.')).toBe('allowed');
  });

  it('allows a rotated log and an extensionless file', () => {
    // report.log.1 — a numeric suffix is rotation, not a format.
    expect(classifyUpload('application/octet-stream', 'app.log.1')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'app.log.12')).toBe('allowed');
    // extensionless: the filename cannot classify it; content screening covers it
    expect(classifyUpload('application/octet-stream', 'attachment')).toBe('allowed');
  });

  it('allows .com, which is an Outlook content-id far more often than an executable', () => {
    expect(classifyUpload('application/octet-stream', 'image001@01D9F2A3.com')).toBe('allowed');
  });
});

/** Build a PE/ELF/PNG head with a real signature, delivered in several chunks. */
function streamOf(buffer: Buffer, chunkSize: number): Readable {
  const parts: Buffer[] = [];
  for (let i = 0; i < buffer.length; i += chunkSize) parts.push(buffer.subarray(i, i + chunkSize));
  return Readable.from(parts.length > 0 ? parts : [Buffer.alloc(0)]);
}

const peExecutable = (() => {
  const b = Buffer.alloc(512);
  b.write('MZ', 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80);
  return b;
})();

const elfExecutable = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]),
  Buffer.alloc(600),
]);

const pngImage = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  Buffer.alloc(900),
]);

async function drain(stream: Readable): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(chunk as Buffer);
  return Buffer.concat(out);
}

describe('executable content screening', () => {
  it('rejects a Windows executable renamed to look like an image', async () => {
    await expect(
      __screenExecutableContentForTest(streamOf(peExecutable, 100), 'holiday.png', 'image/png'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('rejects an ELF binary with no extension at all', async () => {
    await expect(
      __screenExecutableContentForTest(streamOf(elfExecutable, 256), 'attachment', 'application/octet-stream'),
    ).rejects.toThrow(/not permitted/i);
  });

  /**
   * Regression guard: a file shorter than the sniff length is fully consumed while
   * reading its head, and putting the bytes back with readable.unshift is a no-op
   * once the stream has ended — small uploads would store as empty files.
   */
  it.each([
    ['smaller than the sniff length', pngImage, 300],
    ['larger than the sniff length', Buffer.concat([pngImage, Buffer.alloc(60_000, 7)]), 8192],
    ['two bytes', Buffer.from('hi'), 1],
    ['delivered in one chunk', pngImage, pngImage.length],
  ])('passes the whole file through when it is %s', async (_label, payload, chunkSize) => {
    const body = await __screenExecutableContentForTest(
      streamOf(payload as Buffer, chunkSize as number),
      'image.png',
      'image/png',
    );
    expect(await drain(body)).toEqual(payload);
  });

  it('allows text, which has no signature to detect', async () => {
    const csv = Buffer.from('id,name\n1,alpha\n'.repeat(30));
    const body = await __screenExecutableContentForTest(streamOf(csv, 64), 'export.csv', 'text/csv');
    expect(await drain(body)).toEqual(csv);
  });

  it('allows an empty file rather than failing on it', async () => {
    const body = await __screenExecutableContentForTest(
      Readable.from([]),
      'empty.txt',
      'text/plain',
    );
    expect((await drain(body)).length).toBe(0);
  });

  it('rejects rather than hanging when the upload errors mid-stream', async () => {
    // A client disconnecting before the head is read must fail the request, not
    // leave it pending: 'readable' and 'end' never fire after an error.
    const stream = new Readable({ read() {} });
    stream.on('error', () => {}); // the storage engine attaches this for logging
    stream.push(Buffer.alloc(50)); // shorter than the sniff length, so more is awaited
    setTimeout(() => stream.destroy(new Error('ECONNRESET')), 20);

    await expect(
      __screenExecutableContentForTest(stream, 'partial.bin', 'application/octet-stream'),
    ).rejects.toThrow(/ECONNRESET/);
  });
});

/** The EICAR test file: what an assessor uploads to check that screening is live. */
const eicarTestFile = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'latin1',
);

async function zipOf(entries: Record<string, Buffer | string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('EICAR test file', () => {
  it('is refused as a plain upload', async () => {
    await expect(
      __screenExecutableContentForTest(streamOf(eicarTestFile, 16), 'eicar.com', 'application/octet-stream'),
    ).rejects.toThrow(/not permitted/i);
  });
});

describe('archive content screening', () => {
  beforeAll(() => __setArchiveScreeningModeForTest('enforce'));
  it('refuses a zip carrying the EICAR test file', async () => {
    const archive = await zipOf({ 'eicar.com': eicarTestFile });
    await expect(
      __screenArchiveContentForTest(streamOf(archive, 64), 'eicar.com.zip'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('refuses a zip whose entry is an executable renamed to look like an image', async () => {
    const archive = await zipOf({ 'holiday.png': peExecutable, 'notes.txt': 'hello' });
    await expect(
      __screenArchiveContentForTest(streamOf(archive, 64), 'photos.zip'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('refuses a zip with an entry of a blocked type, whatever its bytes', async () => {
    const archive = await zipOf({ 'tools/installer.exe': 'echo not really a program' });
    await expect(
      __screenArchiveContentForTest(streamOf(archive, 64), 'tools.zip'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('passes an ordinary archive through to storage intact', async () => {
    const archive = await zipOf({
      'report.csv': 'a,b,c\n1,2,3\n',
      'images/chart.png': pngImage,
      'docs/': '',
    });
    const stored = await __screenArchiveContentForTest(streamOf(archive, 100), 'bundle.zip');
    expect(stored.equals(archive)).toBe(true);
  });

  it('refuses a zip entry of a non-allowlisted type even without executable bytes (.jar/.hta/.vbs)', async () => {
    const archive = await zipOf({ 'app.jar': 'not really a program', 'notes.txt': 'ok' });
    await expect(
      __screenArchiveContentForTest(streamOf(archive, 64), 'lib.zip'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('opens a zip inside a zip and refuses what it finds there', async () => {
    const inner = await zipOf({ 'eicar.com': eicarTestFile });
    const outer = await zipOf({ 'readme.txt': 'see inside', 'inner.zip': inner });
    await expect(
      __screenArchiveContentForTest(streamOf(outer, 64), 'outer.zip'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('refuses nesting deeper than it will inspect', async () => {
    const level3 = await zipOf({ 'plain.txt': 'nothing here' });
    const level2 = await zipOf({ 'l3.zip': level3 });
    const level1 = await zipOf({ 'l2.zip': level2 });
    await expect(
      __screenArchiveContentForTest(streamOf(level1, 64), 'deep.zip'),
    ).rejects.toThrow(/not permitted/i);
  });

  it('refuses a .zip that is not a zip rather than storing it uninspected', async () => {
    await expect(
      __screenArchiveContentForTest(streamOf(Buffer.from('this is not an archive'), 8), 'fake.zip'),
    ).rejects.toThrow(/not permitted|could not be inspected/i);
  });

  it('in shadow mode logs the violation but stores the file untouched', async () => {
    __setArchiveScreeningModeForTest('shadow');
    try {
      const archive = await zipOf({ 'eicar.com': eicarTestFile, 'notes.txt': 'hello' });
      const stored = await __screenArchiveContentForTest(streamOf(archive, 64), 'eicar.com.zip');
      expect(stored.equals(archive)).toBe(true);
    } finally {
      __setArchiveScreeningModeForTest('enforce');
    }
  });
});
