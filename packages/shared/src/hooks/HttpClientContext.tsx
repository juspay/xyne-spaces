import React, { createContext, useContext } from 'react';

export interface HttpClient {
  get<T>(path: string, options?: { signal?: AbortSignal; timeout?: number }): Promise<T>;
  post<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<T>;
}

const HttpClientContext = createContext<HttpClient | null>(null);

export const HttpClientProvider: React.FC<{
  client: HttpClient;
  children: React.ReactNode;
}> = ({ client, children }) => (
  <HttpClientContext.Provider value={client}>{children}</HttpClientContext.Provider>
);

export const useHttpClient = (): HttpClient => {
  const client = useContext(HttpClientContext);
  if (!client) {
    throw new Error('useHttpClient must be used within an HttpClientProvider');
  }
  return client;
};

export const useOptionalHttpClient = (): HttpClient | null => useContext(HttpClientContext);
