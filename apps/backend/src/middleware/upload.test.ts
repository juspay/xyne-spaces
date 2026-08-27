import { Readable } from 'node:stream';
import { classifyUpload, __screenExecutableContentForTest } from './upload';

/**
 * The cases here are drawn from two places: the production extension distribution
 * (1,801,002 attachments), and the reproduction steps of the MAPT finding this
 * filter answers. A change that breaks one of the "allowed" cases is a change that
 * breaks live traffic, so they are named with their volume where it is large.
 */
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
    // Mobile builds are shared in channels — a shipped feature, and named in the report.
    expect(classifyUpload('application/octet-stream', 'app-release.apk')).toBe('allowed');
    expect(classifyUpload('application/octet-stream', 'Xyne.IPA')).toBe('allowed');
    // 45,794 HTML uploads, still ~52/day: automated reports.
    expect(classifyUpload('text/html', 'report.html')).toBe('allowed');
    // Custom emoji are SVGs. Blocking this removed emoji upload entirely once before.
    expect(classifyUpload('image/svg+xml', 'emoji.svg')).toBe('allowed');
    // 341 real DevOps scripts.
    expect(classifyUpload('application/x-sh', 'deploy.sh')).toBe('allowed');
    // 23,454 screen recordings, up to 858MB.
    expect(classifyUpload('application/octet-stream', 'demo.mov')).toBe('allowed');
    // 13,408 uploads.
    expect(classifyUpload('application/octet-stream', 'firmware.bin')).toBe('allowed');
  });

  it('allows the files the report reproduced with, which are normal usage here', () => {
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
    // 29,989 uploads (1.67%) arrive with no extension and are still arriving daily.
    // The filename cannot classify these; content screening covers them instead.
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
   * The regression this guards: a file shorter than the sniff length is fully
   * consumed while reading its head. An earlier implementation put the bytes back
   * with readable.unshift, which is a no-op once the stream has ended — every small
   * upload would have been stored as an empty file. Most attachments are small
   * (production p50 is 23kB, and plenty are under 4100 bytes), so this was the
   * common path, not an edge case.
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
});
