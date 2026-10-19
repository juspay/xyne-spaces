import {
  HttpRequestError,
  type HttpClient,
  type HttpPostRequest,
  type HttpPostResponse,
} from './HttpClient';

export class FetchHttpClient implements HttpClient {
  async post(request: HttpPostRequest): Promise<HttpPostResponse> {
    try {
      const requestOptions: RequestInit = {
        method: 'POST',
        headers: {
          ...request.headers,
        },
        body: request.body,
      };

      if (request.signal !== undefined) {
        requestOptions.signal = request.signal;
      }

      // This class is the fetch-backed HttpClient implementation, so fetch is intentional.
      // eslint-disable-next-line local-rules/no-fetch-use-axios
      const response = await fetch(request.url, requestOptions);

      return {
        statusCode: response.status,
      };
    } catch (error: unknown) {
      throw new HttpRequestError(error);
    }
  }
}
