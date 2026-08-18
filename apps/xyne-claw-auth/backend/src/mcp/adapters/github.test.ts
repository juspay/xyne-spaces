import { describe, expect, it, vi, afterEach } from 'vitest';
import { GITHUB_CUSTOM_TOOLS, embedMarkdown, handleUploadPrAttachment } from './github.js';

const creds = { token: 'ghp_test' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embedMarkdown', () => {
  it('leaves a video URL bare so GitHub renders a player', () => {
    expect(embedMarkdown('demo', 'https://github.com/user-attachments/assets/a', 'video/mp4'))
      .toBe('https://github.com/user-attachments/assets/a');
  });

  it('uses image syntax for images and a link for everything else', () => {
    expect(embedMarkdown('shot', 'https://x/1', 'image/png')).toBe('![shot](https://x/1)');
    expect(embedMarkdown('run.log', 'https://x/2', 'text/plain')).toBe('[run.log](https://x/2)');
  });
});

describe('upload-pr-attachment validation', () => {
  it('is exposed as a custom tool with owner/repo/fileData/fileName required', () => {
    const tool = GITHUB_CUSTOM_TOOLS.find((t) => t.name === 'upload-pr-attachment');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema['required']).toEqual(['owner', 'repo', 'fileData', 'fileName']);
  });

  // Verified against the live endpoint 2026-08-15: only image/* and video/*
  // are accepted. pdf/zip/txt/json/csv all 422, so a non-media artifact has no
  // container that gets it through — the error must point elsewhere, not at zip.
  it.each(['trace.har', 'run.log', 'report.pdf', 'bundle.zip', 'data.json'])(
    'rejects %s locally and points at a route that actually works',
    async (fileName) => {
      await expect(handleUploadPrAttachment(creds, {
        owner: 'juspay', repo: 'xyne-spaces', fileData: 'AAAA', fileName,
      })).rejects.toThrow(/images and video only/i);
    },
  );

  it('rejects fileData that decodes to nothing', async () => {
    await expect(handleUploadPrAttachment(creds, {
      owner: 'juspay', repo: 'xyne-spaces', fileData: '', fileName: 'shot.png',
    })).rejects.toThrow(/fileData/);
  });

  it('rejects an oversized upload before touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const big = Buffer.alloc(101 * 1024 * 1024).toString('base64');
    await expect(handleUploadPrAttachment(creds, {
      owner: 'juspay', repo: 'xyne-spaces', fileData: big, fileName: 'long.mp4',
    })).rejects.toThrow(/100 MB/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects owner/repo values that would escape the API path', async () => {
    await expect(handleUploadPrAttachment(creds, {
      owner: 'juspay/../evil', repo: 'xyne-spaces', fileData: 'AAAA', fileName: 'shot.png',
    })).rejects.toThrow(/unsupported characters/);
  });

  it('explains a 404 as a push-access problem rather than leaking the status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(handleUploadPrAttachment(creds, {
      owner: 'juspay', repo: 'xyne-spaces', fileData: 'AAAA', fileName: 'shot.png',
    })).rejects.toThrow(/push access/);
  });
});

describe('upload-pr-attachment happy path', () => {
  function stubUpload(assetUrl: string) {
    return vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 4242 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: assetUrl }), { status: 200 }));
  }

  it('uploads against the numeric repository id and returns bare-line video markdown', async () => {
    const assetUrl = 'https://github.com/user-attachments/assets/abc';
    const fetchSpy = stubUpload(assetUrl);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await handleUploadPrAttachment(creds, {
      owner: 'juspay', repo: 'xyne-spaces', fileData: Buffer.from('video').toString('base64'), fileName: 'login.mp4',
    });

    const uploadUrl = fetchSpy.mock.calls[1]![0] as string;
    expect(uploadUrl).toContain('https://uploads.github.com/user-attachments/assets');
    expect(uploadUrl).toContain('repository_id=4242');
    expect(uploadUrl).toContain('content_type=video%2Fmp4');
    expect(result.content).toContain(assetUrl);
    expect(result.content).not.toContain(`![login.mp4](${assetUrl})`);
    expect(result.citations).toBeUndefined();
  });

  it('comments on the PR when prNumber is given and cites it', async () => {
    const assetUrl = 'https://github.com/user-attachments/assets/def';
    const fetchSpy = stubUpload(assetUrl).mockResolvedValueOnce(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await handleUploadPrAttachment(creds, {
      owner: 'juspay', repo: 'xyne-spaces', fileData: Buffer.from('png').toString('base64'),
      fileName: 'shot.png', prNumber: 81,
    });

    expect(fetchSpy.mock.calls[2]![0]).toBe('https://api.github.com/repos/juspay/xyne-spaces/issues/81/comments');
    expect(result.content).toContain(`![shot.png](${assetUrl})`);
    expect(result.citations?.[0]?.url).toBe('https://github.com/juspay/xyne-spaces/pull/81');
  });

  it('still returns the asset URL when the PR comment fails', async () => {
    const assetUrl = 'https://github.com/user-attachments/assets/ghi';
    const fetchSpy = stubUpload(assetUrl).mockResolvedValueOnce(new Response('no', { status: 403 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await handleUploadPrAttachment(creds, {
      owner: 'juspay', repo: 'xyne-spaces', fileData: Buffer.from('png').toString('base64'),
      fileName: 'shot.png', prNumber: 81,
    });

    expect(result.content).toContain(assetUrl);
    expect(result.content).toMatch(/could not comment/i);
  });
});
