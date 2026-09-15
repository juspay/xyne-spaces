const GOOGLE_DOCS_BASE_URL = 'https://docs.googleapis.com/v1/documents';

interface GoogleDocsErrorBody {
  error?: {
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
}

export class GoogleDocsApiError extends Error {
  constructor(
    readonly status: number,
    readonly reasons: string[] = [],
    message: string = 'Google Docs request failed',
  ) {
    super(message);
  }
}

const googleDocsHeaders = (accessToken: string): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

async function parseGoogleDocsError(response: Response): Promise<GoogleDocsApiError> {
  const body = (await response.json().catch(() => null)) as GoogleDocsErrorBody | null;
  const error = body?.error;
  return new GoogleDocsApiError(
    response.status,
    error?.errors?.flatMap((item) => (item.reason ? [item.reason] : [])) ?? [],
    error?.message ?? 'Google Docs request failed',
  );
}

export class GoogleDocsService {
  async createDocument(accessToken: string, title: string): Promise<string> {
    const response = await fetch(GOOGLE_DOCS_BASE_URL, {
      method: 'POST',
      headers: googleDocsHeaders(accessToken),
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => null)) as
      | (GoogleDocsErrorBody & { documentId?: string })
      | null;

    if (!response.ok || !body?.documentId) {
      const error = body?.error;
      throw new GoogleDocsApiError(
        response.status,
        error?.errors?.flatMap((item) => (item.reason ? [item.reason] : [])) ?? [],
        error?.message ?? 'Failed to create Google Doc',
      );
    }

    return body.documentId;
  }

  async insertText(accessToken: string, documentId: string, text: string): Promise<void> {
    const response = await fetch(
      `${GOOGLE_DOCS_BASE_URL}/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: googleDocsHeaders(accessToken),
        body: JSON.stringify({
          requests: [{ insertText: { location: { index: 1 }, text } }],
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) throw await parseGoogleDocsError(response);
  }
}

export const googleDocsService = new GoogleDocsService();
