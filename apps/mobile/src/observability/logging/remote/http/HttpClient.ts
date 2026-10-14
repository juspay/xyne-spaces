export type HttpPostRequest = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
  signal?: AbortSignal;
}>;

export type HttpPostResponse = Readonly<{
  statusCode: number;
}>;

export interface HttpClient {
  post(request: HttpPostRequest): Promise<HttpPostResponse>;
}

export class HttpRequestError extends Error {
  constructor(cause: unknown) {
    super('HTTP request could not be completed.', {
      cause,
    });

    this.name = 'HttpRequestError';
  }
}
